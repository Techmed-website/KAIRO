-- Founder Intelligence: contact details for follow-ups (admin only). Most phone numbers were captured at TECHMED
-- sign-up (auth user metadata), not in the KAIRO profile, so fall back to those. Read-only; nothing is copied.
create or replace function cbt._fi_contact(p_user uuid)
returns table (full_name text, email text, phone text)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(nullif(p.full_name, ''), nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', '')),
         coalesce(nullif(p.email, ''), nullif(u.email, '')),
         coalesce(nullif(p.phone, ''), nullif(u.raw_user_meta_data ->> 'phone', ''), nullif(u.raw_user_meta_data ->> 'whatsapp_phone', ''))
  from cbt.profiles p left join auth.users u on u.id = p.id
  where p.id = p_user
$$;
revoke execute on function cbt._fi_contact(uuid) from public, anon, authenticated;

-- The three admin reports that show people, now using _fi_contact().
create or replace function cbt.fi_feed(p_before timestamptz default null, p_limit int default 50, p_kinds text[] default null,
                                       p_feature text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  v_before timestamptz := coalesce(p_before, now() + interval '1 minute');
  v_after timestamptz := coalesce(cbt._fi_ts(p_from), '-infinity');
  v_upto timestamptz := least(v_before, coalesce(cbt._fi_ts(p_to + 1), 'infinity'));
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  r jsonb;
begin
  perform cbt._require_admin();
  with pp as (select * from cbt._fi_people()),
  items as (
    (select p.registered_at at, 'registered'::text kind, 'user_registered'::text name, 'onboarding'::text feature, null::text subject,
            null::int qcount, p.user_id, p.is_guest, null::uuid ref, '{}'::jsonb props
       from pp p where not p.is_guest and p.registered_at >= v_after and p.registered_at < v_upto
        and (p_kinds is null or 'registered' = any(p_kinds)) and (p_feature is null or p_feature = 'onboarding')
      order by 1 desc limit v_limit)
    union all
    (select t.started_at, 'started', case cbt._fi_category(f.feature) when 'practice' then 'practice_started' when 'quiz' then 'quiz_started' else 'mock_started' end,
            f.feature, coalesce(s.code, substring(a.title from '^(?:(?:Retry|Review): )*([A-Z]{3}) ')), null, t.user_id, p.is_guest, t.assessment_id, '{}'::jsonb
       from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id join pp p on p.user_id = t.user_id
       left join cbt.subjects s on s.id = a.subject_id
       cross join lateral (select cbt._fi_feature(a.type, a.personal, a.title) feature) f
      where t.started_at >= v_after and t.started_at < v_upto
        and (p_kinds is null or 'started' = any(p_kinds)) and (p_feature is null or p_feature = f.feature)
      order by 1 desc limit v_limit)
    union all
    (select t.submitted_at, 'completed', case cbt._fi_category(f.feature) when 'practice' then 'practice_completed' when 'quiz' then 'quiz_completed' else 'mock_completed' end,
            f.feature, coalesce(s.code, substring(a.title from '^(?:(?:Retry|Review): )*([A-Z]{3}) ')), null, t.user_id, p.is_guest, t.assessment_id, '{}'::jsonb
       from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id join pp p on p.user_id = t.user_id
       left join cbt.subjects s on s.id = a.subject_id
       cross join lateral (select cbt._fi_feature(a.type, a.personal, a.title) feature) f
      where t.status = 'final' and t.submitted_at >= v_after and t.submitted_at < v_upto
        and (p_kinds is null or 'completed' = any(p_kinds)) and (p_feature is null or p_feature = f.feature)
      order by 1 desc limit v_limit)
    union all
    (select e.created_at, case when e.name = 'page_viewed' then 'opened' else 'event' end, e.name, e.feature, e.subject, null,
            e.user_id, p.is_guest, null, e.props
       from cbt.events e join pp p on p.user_id = e.user_id
      where e.created_at >= v_after and e.created_at < v_upto
        and e.name not in ('user_session_started','user_session_ended')
        and (p_kinds is null or (case when e.name = 'page_viewed' then 'opened' else 'event' end) = any(p_kinds))
        and (p_feature is null or p_feature = e.feature)
      order by 1 desc limit v_limit)
  ),
  top as (select * from items order by at desc limit v_limit)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'at', at, 'kind', kind, 'name', name, 'feature', feature, 'subject', subject,
        'questions', case when ref is not null then (select count(*) from cbt.assessment_questions aq where aq.assessment_id = top.ref) end,
        'student', cbt._fi_code(user_id, is_guest), 'user_id', user_id, 'props', props,
        'student_name', case when not is_guest then (select full_name from cbt._fi_contact(top.user_id)) end) order by at desc), '[]'::jsonb),
    'generated_at', now())
  into r from top;
  return r;
end $$;

create or replace function cbt.fi_students(p_segment text default 'all', p_search text default null,
                                           p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_today date := cbt._fi_day(now()); r jsonb;
begin
  perform cbt._require_admin();
  with stu as (select * from cbt._fi_people() where not is_guest),
  act as (select * from cbt._fi_activity('-infinity', 'infinity')),
  att as (select * from cbt._fi_attempts('-infinity', 'infinity') where not is_guest),
  ev as (select e.user_id, count(distinct e.session_id) sessions, max(e.created_at) last_ev, array_agg(distinct e.feature) filter (where e.feature is not null) feats
           from cbt.events e join stu on stu.user_id = e.user_id group by 1),
  rows as (
    select s.user_id, s.registered_at, c.full_name, c.email, c.phone, pr.exam_year,
           greatest((select max(at) from act where act.user_id = s.user_id), ev.last_ev) last_seen,
           (select max(at) from act where act.user_id = s.user_id) last_active,
           (select count(distinct day) from act where act.user_id = s.user_id) active_days,
           (select count(distinct day) from act where act.user_id = s.user_id and act.day > v_today - 14) active_days_14,
           ev.sessions,
           (select coalesce(sum(answered) filter (where status <> 'rejected'), 0) from att where att.user_id = s.user_id) questions,
           (select count(*) from att where att.user_id = s.user_id) starts,
           (select count(*) from att where att.user_id = s.user_id and status = 'final') completions,
           (select count(*) from att where att.user_id = s.user_id and category = 'practice' and status = 'final') practice_done,
           (select count(*) from att where att.user_id = s.user_id and category = 'quiz' and status = 'final') quizzes_done,
           (select count(*) from att where att.user_id = s.user_id and category = 'mock' and status = 'final') mocks_done,
           (select array(select distinct x from unnest(coalesce(ev.feats, '{}') || array(select distinct feature from att where att.user_id = s.user_id)) x order by 1)) features
    from stu s left join ev on ev.user_id = s.user_id
    join cbt.profiles pr on pr.id = s.user_id cross join lateral cbt._fi_contact(s.user_id) c),
  seg as (
    select * from rows where
      (p_search is null or cbt._fi_code(user_id) ilike '%' || p_search || '%' or full_name ilike '%' || p_search || '%'
                        or email ilike '%' || p_search || '%' or phone ilike '%' || p_search || '%') and
      case coalesce(p_segment, 'all')
        when 'new' then registered_at >= cbt._fi_ts(v_today - 6)
        when 'active' then last_active >= cbt._fi_ts(v_today - 6)
        when 'inactive' then last_active is null or last_active < cbt._fi_ts(v_today - 6)
        when 'engaged' then active_days_14 >= 3 and completions >= 3
        when 'never_practised' then starts = 0
        when 'started_not_completed' then starts > 0 and completions = 0
        else true end)
  select jsonb_build_object(
    'total', (select count(*) from seg),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'student', cbt._fi_code(user_id), 'full_name', full_name, 'email', email, 'phone', phone,
        'exam_year', exam_year, 'registered_at', registered_at, 'last_active', last_active,
        'last_seen', last_seen, 'active_days', active_days, 'sessions', sessions, 'questions', questions,
        'practice_completed', practice_done, 'quizzes_completed', quizzes_done, 'mocks_completed', mocks_done,
        'starts', starts, 'completions', completions, 'features', to_jsonb(features)) order by last_seen desc nulls last, registered_at desc)
      from (select * from seg order by last_seen desc nulls last, registered_at desc
            limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) pg), '[]'::jsonb),
    'coverage', cbt._fi_coverage())
  into r;
  return r;
end $$;

create or replace function cbt.fi_student(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare r jsonb;
begin
  perform cbt._require_admin();
  if not exists (select 1 from cbt._fi_people() where user_id = p_user and not is_guest) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'student', cbt._fi_code(p_user),
    'full_name', (select full_name from cbt._fi_contact(p_user)),
    'email', (select email from cbt._fi_contact(p_user)),
    'phone', (select phone from cbt._fi_contact(p_user)),
    'registered_at', (select created_at from cbt.profiles where id = p_user),
    'exam_year', (select exam_year from cbt.profiles where id = p_user),
    'subject_count', (select coalesce(array_length(subjects, 1), 0) from cbt.profiles where id = p_user),
    'by_feature', (select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'starts', n, 'completed', d, 'questions', q) order by n desc), '[]'::jsonb)
                     from (select feature, count(*) n, count(*) filter (where status = 'final') d,
                                  coalesce(sum(answered) filter (where status <> 'rejected'), 0) q
                             from cbt._fi_attempts('-infinity', 'infinity') where user_id = p_user group by 1) x),
    'timeline', (select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) from (
        select jsonb_build_object('at', at, 'kind', kind, 'name', name, 'feature', feature, 'subject', subject, 'questions', qn) x from (
          (select a.started_at at, 'started' kind, null name, a.feature, a.subject, a.answered qn
             from cbt._fi_attempts('-infinity', 'infinity') a where a.user_id = p_user order by 1 desc limit 60)
          union all
          (select a.submitted_at, 'completed', null, a.feature, a.subject, a.answered
             from cbt._fi_attempts('-infinity', 'infinity') a where a.user_id = p_user and a.status = 'final' order by 1 desc limit 60)
          union all
          (select e.created_at, case when e.name = 'page_viewed' then 'opened' else 'event' end, e.name, e.feature, e.subject, null
             from cbt.events e where e.user_id = p_user and e.name not in ('user_session_started','user_session_ended')
            order by 1 desc limit 60)) y order by at desc limit 100) z))
  into r;
  return r;
end $$;
