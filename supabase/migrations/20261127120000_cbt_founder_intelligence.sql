-- KAIRO 2.0 Founder Intelligence (additive only: one new table, new functions; nothing existing is altered).
--
--   cbt.events            first-party product events (navigation, feature opens, a few explicit actions). Written only
--                         through cbt.track_events(); read only by admins. Learning activity is NOT taken from here: practice,
--                         quizzes, mocks and answers come from cbt.attempts / cbt.attempt_answers, which the server owns.
--   cbt.track_events(jsonb)      batched, idempotent (client event id = primary key), allow-listed, rate limited, never raises.
--   cbt.is_admin()        founder check (profiles.role = 'admin'). Editors are staff but do NOT see founder analytics.
--   cbt.fi_*()            admin-only reporting RPCs (overview, live feed, engagement & retention, features, funnel,
--                         student explorer). Each one raises 42501 for anyone who is not an admin.
--
-- Definitions (the dashboard shows the same text):
--   Student          a cbt.profiles row with role 'student' whose auth user is not anonymous. Guests (anonymous
--                    sign-in from a shared quiz link) are reported separately. Staff are always excluded.
--   Registration     the moment the student's KAIRO profile was created (first KAIRO sign-in; accounts are shared with
--                    techmedng.com, so this is "joined KAIRO", not "created a TECHMED account").
--   Qualifying       starting or finishing a practice session, quiz or mock (cbt.attempts), or one of the meaningful
--   activity         product events (offline pack downloaded, study plan saved, answer review opened).
--                    Logins and page views alone never make a student active.
--   Lagos day        all days are calendar days in Africa/Lagos.

-- ───────────────────────── admin check ─────────────────────────
create or replace function cbt.is_admin()
returns boolean language sql stable security definer set search_path = cbt, pg_temp as
$$ select cbt.my_role() = 'admin' $$;
revoke execute on function cbt.is_admin() from public, anon;
grant execute on function cbt.is_admin() to authenticated;

create or replace function cbt._require_admin()
returns uuid language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  if auth.uid() is null or not cbt.is_admin() then raise exception 'founder analytics: admins only' using errcode = '42501'; end if;
  return auth.uid();
end $$;
revoke execute on function cbt._require_admin() from public, anon, authenticated;

-- ───────────────────────── events ─────────────────────────
create table if not exists cbt.events (
  id           uuid primary key,                 -- generated on the phone: a resent batch is ignored, not double counted
  user_id      uuid,                             -- auth.uid() at insert time (never taken from the payload)
  anon_id      text,                             -- the phone's random install id, for signed-out → signed-in attribution
  session_id   text,                             -- app session (30 minutes of inactivity starts a new one)
  name         text not null,
  feature      text,
  entity_id    text,
  subject      text,
  props        jsonb not null default '{}'::jsonb,
  device       text,                             -- mobile | tablet | desktop
  app_version  text,
  path         text,                             -- route pattern, ids removed (e.g. /practice/:code/topics)
  client_at    timestamptz,                      -- informational only; reports use created_at
  created_at   timestamptz not null default now()
);
create index if not exists events_created_at_idx on cbt.events (created_at desc);
create index if not exists events_user_created_idx on cbt.events (user_id, created_at) where user_id is not null;
create index if not exists events_name_created_idx on cbt.events (name, created_at);
alter table cbt.events enable row level security;
drop policy if exists admin_read_events on cbt.events;
create policy admin_read_events on cbt.events for select to authenticated using (cbt.is_admin());
revoke all on cbt.events from anon, authenticated;
grant select on cbt.events to authenticated;   -- RLS above limits this to admins (needed for the Realtime live feed)

-- Live Activity listens for new rows (Supabase Realtime applies the RLS policy above to each subscriber).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cbt' and tablename = 'events') then
    execute 'alter publication supabase_realtime add table cbt.events';
  end if;
end $$;

-- Helpful for the reporting windows (attempts are only indexed by user and by receipt time today).
create index if not exists attempts_started_at_idx on cbt.attempts (started_at);
create index if not exists profiles_created_at_idx on cbt.profiles (created_at);

create or replace function cbt._fi_event_names() returns text[] language sql immutable as $$ select array[
  'user_registered','user_login','user_logout','user_session_started','user_session_ended',
  'page_viewed','feature_opened','navigation_clicked','search_performed',
  'practice_started','question_viewed','question_answered','practice_paused','practice_resumed','practice_completed','practice_abandoned',
  'question_bank_opened','subject_selected','topic_selected','year_filter_selected','question_search_performed',
  'daily_builder_quiz_viewed','daily_builder_quiz_started','quiz_started','quiz_answered','quiz_completed','quiz_abandoned',
  'mock_started','mock_question_answered','mock_submitted','mock_completed','result_viewed','answer_review_opened',
  'offline_pack_viewed','offline_pack_downloaded','leaderboard_viewed','profile_viewed','achievement_viewed',
  'study_planner_opened','study_plan_saved','share_clicked'] $$;

create or replace function cbt._fi_features() returns text[] language sql immutable as $$ select array[
  'home','quiz_hub','daily_quiz','challenge','practice_hub','question_bank','topic_practice','year_practice','custom_practice',
  'mock','review_retry','offline','results','leaderboard','profile','planner','syllabus','onboarding','landing'] $$;

-- Events that count as qualifying activity (the rest are navigation context only).
create or replace function cbt._fi_meaningful() returns text[] language sql immutable as
$$ select array['offline_pack_downloaded','study_plan_saved','answer_review_opened'] $$;

-- Only these property keys are kept; values are cut to 80 characters. No free text, answers, emails or tokens.
create or replace function cbt._fi_clean_props(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) in ('number','boolean') then v else to_jsonb(left(v #>> '{}', 80)) end), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as x(k, v)
  where k = any(array['count','mode','topic_id','year','from','tab','size','query_length','results','source','quiz_type','level'])
    and jsonb_typeof(v) in ('number','boolean','string')
$$;

create or replace function cbt.track_events(p_events jsonb)
returns integer language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); n int := 0; v_recent int; v_anon text;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  v_anon := left(p_events -> 0 ->> 'anon_id', 64);
  -- Rate limit: 600 events per 10 minutes per user (or per install for signed-out visitors). Excess is dropped quietly.
  select count(*) into v_recent from cbt.events
   where created_at > now() - interval '10 minutes'
     and (case when uid is not null then user_id = uid else user_id is null and anon_id = v_anon end);
  if v_recent >= 600 then return 0; end if;

  insert into cbt.events (id, user_id, anon_id, session_id, name, feature, entity_id, subject, props, device, app_version, path, client_at)
  select (e ->> 'id')::uuid, uid, left(e ->> 'anon_id', 64), left(e ->> 'session_id', 64), e ->> 'name',
         case when e ->> 'feature' = any(cbt._fi_features()) then e ->> 'feature' end,
         left(e ->> 'entity_id', 64),
         case when e ->> 'subject' ~ '^[A-Z]{3}$' then e ->> 'subject' end,
         cbt._fi_clean_props(e -> 'props'),
         case when e ->> 'device' in ('mobile','tablet','desktop') then e ->> 'device' end,
         left(e ->> 'app_version', 32), left(e ->> 'path', 80),
         case when (e ->> 'client_at') ~ '^\d{4}-\d\d-\d\dT' then (e ->> 'client_at')::timestamptz end
  from (select e from jsonb_array_elements(p_events) e limit 50) x
  where (e ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and e ->> 'name' = any(cbt._fi_event_names())
    and (uid is not null or e ->> 'name' = 'page_viewed')   -- signed-out visitors: landing/sign-in page views only
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
exception when others then
  return 0;   -- analytics must never surface an error in the student's app
end $$;
revoke execute on function cbt.track_events(jsonb) from public;
grant execute on function cbt.track_events(jsonb) to anon, authenticated;

-- ───────────────────────── shared building blocks ─────────────────────────
create or replace function cbt._fi_day(p timestamptz) returns date language sql immutable as
$$ select (p at time zone 'Africa/Lagos')::date $$;
create or replace function cbt._fi_ts(p date) returns timestamptz language sql immutable as
$$ select (p::timestamp) at time zone 'Africa/Lagos' $$;

-- Which product feature an attempt belongs to (practice modes are told apart by the titles create_practice gives them).
create or replace function cbt._fi_feature(p_type cbt.assessment_type, p_personal boolean, p_title text)
returns text language sql immutable as $$
  select case
    when not p_personal then case when p_type = 'daily_quiz' then 'daily_quiz' else 'challenge' end
    when p_type = 'mock' then 'mock'
    when p_title ~ '^(Retry|Review):' then 'review_retry'
    when p_title ~ '^[A-Z]{3} \d{4}$' then 'year_practice'
    when p_title ~ ' topic practice$' then 'topic_practice'
    else 'custom_practice' end $$;
-- practice = personal sessions other than mocks; quiz = published quizzes (daily, challenge, drills); mock = full JAMB mock.
create or replace function cbt._fi_category(p_feature text) returns text language sql immutable as $$
  select case when p_feature in ('daily_quiz','challenge') then 'quiz' when p_feature = 'mock' then 'mock' else 'practice' end $$;

create or replace function cbt._fi_code(p uuid, p_guest boolean default false) returns text language sql immutable as
$$ select (case when p_guest then 'G-' else 'S-' end) || upper(substr(md5(p::text), 1, 6)) $$;

-- Students (not staff), with whether they are still an anonymous guest.
create or replace function cbt._fi_people()
returns table (user_id uuid, registered_at timestamptz, is_guest boolean)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select p.id, p.created_at, coalesce(u.is_anonymous, false)
  from cbt.profiles p left join auth.users u on u.id = p.id
  where p.role = 'student'
$$;

-- Every attempt by a student or guest, with its feature and outcome.
create or replace function cbt._fi_attempts(p_from timestamptz, p_to timestamptz)
returns table (attempt_id uuid, user_id uuid, is_guest boolean, feature text, category text, subject text,
               started_at timestamptz, submitted_at timestamptz, status text, abandoned boolean, answered int)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select t.id, t.user_id, pp.is_guest, f.feature, cbt._fi_category(f.feature),
         coalesce(s.code, substring(a.title from '^(?:(?:Retry|Review): )*([A-Z]{3}) ')),
         t.started_at, t.submitted_at, t.status::text,
         (t.status = 'in_progress' and coalesce(t.deadline_at, t.started_at + interval '24 hours') < now()
                                   and t.started_at < now() - interval '24 hours'),
         (select count(*)::int from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null)
  from cbt.attempts t
  join cbt.assessments a on a.id = t.assessment_id
  join cbt._fi_people() pp on pp.user_id = t.user_id
  left join cbt.subjects s on s.id = a.subject_id
  cross join lateral (select cbt._fi_feature(a.type, a.personal, a.title) as feature) f
  where t.started_at >= p_from and t.started_at < p_to
$$;

-- Qualifying activity of registered students (guests and staff excluded), one row per action.
create or replace function cbt._fi_activity(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, at timestamptz, day date, kind text, feature text)
language sql stable security definer set search_path = cbt, pg_temp as $$
  with s as (select user_id from cbt._fi_people() where not is_guest)
  select x.user_id, x.at, cbt._fi_day(x.at), x.kind, x.feature from (
    select t.user_id, t.started_at as at, 'start' as kind, cbt._fi_feature(a.type, a.personal, a.title) as feature
      from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
     where t.started_at >= p_from and t.started_at < p_to
    union all
    select t.user_id, t.submitted_at, 'finish', cbt._fi_feature(a.type, a.personal, a.title)
      from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
     where t.status = 'final' and t.submitted_at >= p_from and t.submitted_at < p_to
    union all
    select e.user_id, e.created_at, e.name, e.feature
      from cbt.events e
     where e.user_id is not null and e.name = any(cbt._fi_meaningful()) and e.created_at >= p_from and e.created_at < p_to
  ) x join s on s.user_id = x.user_id
$$;

revoke execute on function cbt._fi_people(), cbt._fi_attempts(timestamptz, timestamptz), cbt._fi_activity(timestamptz, timestamptz)
  from public, anon, authenticated;

-- Period numbers used for both the current and the previous period.
create or replace function cbt._fi_kpis(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
  v_end date := least(p_to, cbt._fi_day(now()));
  r jsonb;
begin
  with act as (select * from cbt._fi_activity('-infinity', greatest(t, cbt._fi_ts(v_end + 1)))),
       first_day as (select user_id, min(day) d from act group by 1),
       inp as (select * from act where at >= f and at < t),
       daily as (select d::date as day, (select count(distinct user_id) from inp where inp.day = d::date) n
                   from generate_series(p_from, v_end, interval '1 day') d),
       att as (select * from cbt._fi_attempts(f, t) where not is_guest)
  select jsonb_build_object(
    'registrations', (select count(*) from cbt._fi_people() where not is_guest and registered_at >= f and registered_at < t),
    'active_users', (select count(distinct user_id) from inp),
    'dau_avg', (select round(avg(n), 1) from daily),
    'dau_last', (select n from daily where day = v_end),
    'wau', (select count(distinct user_id) from act where day between v_end - 6 and v_end),
    'mau', (select count(distinct user_id) from act where day between v_end - 29 and v_end),
    'returning_users', (select count(distinct i.user_id) from inp i join first_day fd on fd.user_id = i.user_id where i.day > fd.d),
    'new_active_users', (select count(distinct i.user_id) from inp i join first_day fd on fd.user_id = i.user_id where fd.d >= p_from),
    'questions', (select coalesce(sum(answered), 0) from att where status <> 'rejected'),
    'practice_started', (select count(*) from att where category = 'practice'),
    'practice_completed', (select count(*) from att where category = 'practice' and status = 'final'),
    'practice_abandoned', (select count(*) from att where category = 'practice' and abandoned),
    'quiz_started', (select count(*) from att where category = 'quiz'),
    'quiz_completed', (select count(*) from att where category = 'quiz' and status = 'final'),
    'mock_started', (select count(*) from att where category = 'mock'),
    'mock_completed', (select count(*) from att where category = 'mock' and status = 'final'),
    'guest_plays', (select count(*) from cbt._fi_attempts(f, t) where is_guest),
    'guests', (select count(*) from cbt._fi_people() where is_guest and registered_at >= f and registered_at < t),
    -- questions per active student, split by whether they had been active on an earlier day
    'q_returning', (select round(avg(q), 1) from (
        select a.user_id, coalesce(sum(a.answered) filter (where a.status <> 'rejected'), 0) q from att a
        where a.user_id in (select i.user_id from inp i join first_day fd on fd.user_id = i.user_id where i.day > fd.d) group by 1) x),
    'q_first_time', (select round(avg(q), 1) from (
        select a.user_id, coalesce(sum(a.answered) filter (where a.status <> 'rejected'), 0) q from att a
        where a.user_id in (select distinct user_id from inp) and a.user_id not in
              (select i.user_id from inp i join first_day fd on fd.user_id = i.user_id where i.day > fd.d) group by 1) x),
    'n_returning_with_q', (select count(distinct a.user_id) from att a where a.user_id in
              (select i.user_id from inp i join first_day fd on fd.user_id = i.user_id where i.day > fd.d)),
    'n_first_time_with_q', (select count(distinct a.user_id) from att a where a.user_id in (select distinct user_id from inp)
              and a.user_id not in (select i.user_id from inp i join first_day fd on fd.user_id = i.user_id where i.day > fd.d))
  ) into r;
  return r;
end $$;
revoke execute on function cbt._fi_kpis(date, date) from public, anon, authenticated;

-- What data exists, so the dashboard can say "unavailable" or "collecting since" instead of showing a false zero.
create or replace function cbt._fi_coverage() returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object(
    'relaunch', '2026-11-24',
    'attempts_since', (select cbt._fi_day(min(started_at)) from cbt.attempts),
    'profiles_since', (select cbt._fi_day(min(created_at)) from cbt.profiles),
    'events_since', (select cbt._fi_day(min(created_at)) from cbt.events),
    'today', cbt._fi_day(now()),
    'generated_at', now())
$$;
revoke execute on function cbt._fi_coverage() from public, anon, authenticated;

create or replace function cbt._fi_check_range(p_from date, p_to date) returns void language plpgsql immutable as $$
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'invalid date range' using errcode = '22023'; end if;
  if p_to - p_from > 400 then raise exception 'date range is limited to 400 days' using errcode = '22023'; end if;
end $$;

-- ───────────────────────── Overview ─────────────────────────
create or replace function cbt.fi_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  v_len int := p_to - p_from + 1; v_pf date := p_from - (p_to - p_from + 1); v_pt date := p_from - 1;
  f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
  v_grain text := case when p_to - p_from > 62 then 'week' else 'day' end;
  v_series jsonb;
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);
  with act as (select * from cbt._fi_activity('-infinity', t)),
       first_day as (select user_id, min(day) d from act group by 1),
       buckets as (select b::date b from generate_series(
                     case when v_grain = 'week' then date_trunc('week', p_from) else p_from end,
                     least(p_to, cbt._fi_day(now())), case when v_grain = 'week' then interval '1 week' else interval '1 day' end) b),
       reg as (select case when v_grain = 'week' then date_trunc('week', cbt._fi_day(registered_at))::date else cbt._fi_day(registered_at) end b, count(*) n
                 from cbt._fi_people() where not is_guest and registered_at >= f and registered_at < t group by 1),
       inp as (select a.*, case when v_grain = 'week' then date_trunc('week', a.day)::date else a.day end b
                 from act a where a.at >= f and a.at < t)
  select jsonb_agg(jsonb_build_object(
           'bucket', bk.b,
           'registrations', coalesce((select n from reg where reg.b = bk.b), 0),
           'active', (select count(distinct user_id) from inp where inp.b = bk.b),
           'returning', (select count(distinct i.user_id) from inp i join first_day fd on fd.user_id = i.user_id where i.b = bk.b and i.day > fd.d))
         order by bk.b)
    into v_series from buckets bk;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len, 'prev_from', v_pf, 'prev_to', v_pt, 'grain', v_grain),
    'coverage', cbt._fi_coverage(),
    'current', cbt._fi_kpis(p_from, p_to),
    'previous', cbt._fi_kpis(v_pf, v_pt),
    'lifetime', jsonb_build_object(
      'students', (select count(*) from cbt._fi_people() where not is_guest),
      'guests', (select count(*) from cbt._fi_people() where is_guest)),
    'series', coalesce(v_series, '[]'::jsonb));
end $$;

-- ───────────────────────── Live activity ─────────────────────────
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
        'student', cbt._fi_code(user_id, is_guest), 'user_id', user_id, 'props', props) order by at desc), '[]'::jsonb),
    'generated_at', now())
  into r from top;
  return r;
end $$;

-- ───────────────────────── Engagement & retention ─────────────────────────
create or replace function cbt.fi_engagement(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
  v_today date := cbt._fi_day(now()); v_end date := least(p_to, cbt._fi_day(now()));
  v_daily jsonb; v_sessions jsonb; v_cohorts jsonb; v_summary jsonb;
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);

  -- Daily activity with rolling 7- and 30-day unique actives ending on each day.
  with act as (select * from cbt._fi_activity(cbt._fi_ts(p_from - 30), cbt._fi_ts(v_end + 1))),
       all_first as (select user_id, min(day) d from cbt._fi_activity('-infinity', cbt._fi_ts(v_end + 1)) group by 1),
       days as (select d::date as day from generate_series(p_from, v_end, interval '1 day') d),
       att as (select * from cbt._fi_attempts(f, t) where not is_guest)
  select jsonb_agg(jsonb_build_object(
      'day', d.day,
      'dau', (select count(distinct user_id) from act where act.day = d.day),
      'wau', (select count(distinct user_id) from act where act.day between d.day - 6 and d.day),
      'mau', (select count(distinct user_id) from act where act.day between d.day - 29 and d.day),
      'new', (select count(*) from cbt._fi_people() pp where not pp.is_guest and cbt._fi_day(pp.registered_at) = d.day),
      'returning', (select count(distinct a.user_id) from act a join all_first fd on fd.user_id = a.user_id where a.day = d.day and a.day > fd.d),
      'questions', (select coalesce(sum(answered), 0) from att where cbt._fi_day(att.started_at) = d.day and att.status <> 'rejected'))
    order by d.day) into v_daily from days d;

  -- Sessions only exist where the app reported them (cbt.events): say so rather than infer.
  with ev as (select e.user_id, e.session_id, min(e.created_at) s, max(e.created_at) l
                from cbt.events e join cbt._fi_people() pp on pp.user_id = e.user_id and not pp.is_guest
               where e.created_at >= f and e.created_at < t and e.session_id is not null group by 1, 2)
  select jsonb_build_object(
      'sessions', count(*), 'users', count(distinct user_id),
      'per_user', round(count(*)::numeric / nullif(count(distinct user_id), 0), 2),
      'avg_minutes', round((avg(extract(epoch from l - s)) filter (where l > s) / 60)::numeric, 1),
      'measured_sessions', count(*) filter (where l > s))
    into v_sessions from ev;

  -- Summary for the period.
  with inp as (select * from cbt._fi_activity(f, t)),
       att as (select * from cbt._fi_attempts(f, t) where not is_guest),
       per as (select user_id, coalesce(sum(answered) filter (where status <> 'rejected'), 0) q,
                      count(*) filter (where status = 'final') done from att group by 1)
  select jsonb_build_object(
      'active_users', (select count(distinct user_id) from inp),
      'active_days_per_user', (select round(avg(n), 2) from (select user_id, count(distinct day) n from inp group by 1) x),
      'engaged', (select count(*) from per where done >= 1 and q >= 10),
      'questions_per_active', (select round(sum(q)::numeric / nullif((select count(distinct user_id) from inp), 0), 1) from per),
      'practice_started', (select count(*) from att where category = 'practice'),
      'practice_completed', (select count(*) from att where category = 'practice' and status = 'final'))
    into v_summary;

  -- Registration cohorts (Lagos day). Day-N = active on exactly the Nth calendar day after the registration day.
  -- "within 7" = active on any of days 1..7 (a rolling window, reported separately). Immature cells are null.
  with coh as (select user_id, cbt._fi_day(registered_at) d0 from cbt._fi_people()
                where not is_guest and registered_at >= f and registered_at < t),
       act as (select distinct user_id, day from cbt._fi_activity(f, cbt._fi_ts(v_today + 1))),
       per as (select c.d0, c.user_id,
                      bool_or(a.day = c.d0 + 1) r1, bool_or(a.day = c.d0 + 7) r7, bool_or(a.day = c.d0 + 30) r30,
                      bool_or(a.day between c.d0 + 1 and c.d0 + 7) w7
                 from coh c left join act a on a.user_id = c.user_id group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object(
      'cohort', d0, 'size', n,
      'd1', case when d0 + 1 < v_today then r1 end, 'd7', case when d0 + 7 < v_today then r7 end,
      'd30', case when d0 + 30 < v_today then r30 end, 'w7', case when d0 + 7 < v_today then w7 end,
      'd1_mature', d0 + 1 < v_today, 'd7_mature', d0 + 7 < v_today, 'd30_mature', d0 + 30 < v_today) order by d0), '[]'::jsonb)
    into v_cohorts
    from (select d0, count(*) n, count(*) filter (where r1) r1, count(*) filter (where r7) r7,
                 count(*) filter (where r30) r30, count(*) filter (where w7) w7 from per group by d0) x;

  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'coverage', cbt._fi_coverage(),
    'daily', coalesce(v_daily, '[]'::jsonb), 'sessions', v_sessions, 'summary', v_summary, 'cohorts', v_cohorts);
end $$;

-- ───────────────────────── Feature performance ─────────────────────────
create or replace function cbt._fi_feature_usage(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1); r jsonb;
begin
  with stu as (select user_id from cbt._fi_people() where not is_guest),
  cat(feature, label, primary_kind, primary_event, ord) as (values
    ('home','Home dashboard','view',null,1), ('quiz_hub','Quizzes tab','view',null,2),
    ('daily_quiz','Daily Builder Quiz','attempt',null,3), ('challenge','Challenges and other quizzes','attempt',null,4),
    ('practice_hub','Practice hub','view',null,5), ('question_bank','Question bank (subject)','view',null,6),
    ('topic_practice','Topic practice','attempt',null,7), ('year_practice','Year practice','attempt',null,8),
    ('custom_practice','Custom (mixed) practice','attempt',null,9), ('mock','Full JAMB mock','attempt',null,10),
    ('review_retry','Retry and review missed','attempt',null,11), ('offline','Offline packs','event','offline_pack_downloaded',12),
    ('results','Results and performance','event','answer_review_opened',13), ('leaderboard','Leaderboard','view',null,14),
    ('profile','Profile and achievements','view',null,15), ('planner','Study planner','event','study_plan_saved',16),
    ('syllabus','JAMB syllabus','view',null,17)),
  att as (select * from cbt._fi_attempts(f, t) where not is_guest),
  ev as (select e.* from cbt.events e join stu on stu.user_id = e.user_id where e.created_at >= f and e.created_at < t),
  uses as (  -- any touch of a feature: page view, attempt start or a primary event
    select feature, user_id, cbt._fi_day(started_at) as day, started_at at from att
    union all select feature, user_id, cbt._fi_day(created_at), created_at from ev where feature is not null),
  later as (select user_id, max(day) last_day from cbt._fi_activity(f, cbt._fi_ts(cbt._fi_day(now()) + 1)) group by 1),
  firstuse as (select feature, user_id, min(day) d from uses group by 1, 2)
  select jsonb_agg(jsonb_build_object(
    'feature', c.feature, 'label', c.label, 'primary_kind', c.primary_kind,
    'users', (select count(distinct user_id) from uses u where u.feature = c.feature),
    'opens', (select count(*) from ev where ev.feature = c.feature and ev.name = 'page_viewed'),
    'openers', (select count(distinct user_id) from ev where ev.feature = c.feature and ev.name = 'page_viewed'),
    'starts', case c.primary_kind when 'attempt' then (select count(*) from att where att.feature = c.feature)
                                  when 'event' then (select count(*) from ev where ev.name = c.primary_event) end,
    'starters', case c.primary_kind when 'attempt' then (select count(distinct user_id) from att where att.feature = c.feature)
                                    when 'event' then (select count(distinct user_id) from ev where ev.name = c.primary_event) end,
    'completions', case when c.primary_kind = 'attempt' then (select count(*) from att where att.feature = c.feature and status = 'final') end,
    'completers', case when c.primary_kind = 'attempt' then (select count(distinct user_id) from att where att.feature = c.feature and status = 'final') end,
    'abandoned', case when c.primary_kind = 'attempt' then (select count(*) from att where att.feature = c.feature and abandoned) end,
    'repeat_users', (select count(*) from (select user_id from uses u where u.feature = c.feature group by 1 having count(distinct day) >= 2) x),
    'returned_users', (select count(*) from firstuse fu join later l on l.user_id = fu.user_id where fu.feature = c.feature and l.last_day > fu.d),
    'primary_event', c.primary_event) order by c.ord)
  into r from cat c;
  return r;
end $$;
revoke execute on function cbt._fi_feature_usage(date, date) from public, anon, authenticated;

create or replace function cbt.fi_features(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_pf date := p_from - (p_to - p_from + 1); v_pt date := p_from - 1;
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_pf, 'prev_to', v_pt),
    'coverage', cbt._fi_coverage(), 'current', cbt._fi_feature_usage(p_from, p_to), 'previous', cbt._fi_feature_usage(v_pf, v_pt));
end $$;

-- ───────────────────────── Conversion funnel ─────────────────────────
-- Cohort: students who registered in the period. Each stage must happen after the previous stage and within
-- p_window days of registration. A stage reached out of order does not count.
create or replace function cbt.fi_funnel(p_from date, p_to date, p_window int default 14)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
  w int := least(greatest(coalesce(p_window, 14), 1), 60); r jsonb;
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);
  with coh as (select user_id, registered_at r0, cbt._fi_day(registered_at) d0 from cbt._fi_people()
                where not is_guest and registered_at >= f and registered_at < t),
  att as (select a.* from cbt.attempts a join coh on coh.user_id = a.user_id
           where a.started_at >= coh.r0 - interval '1 hour' and a.started_at < coh.r0 + make_interval(days => w)),
  act as (select x.* from cbt._fi_activity(f, t + make_interval(days => w)) x join coh on coh.user_id = x.user_id
           where x.at >= coh.r0 - interval '1 hour' and x.at < coh.r0 + make_interval(days => w)),
  views as (select e.user_id, e.created_at at from cbt.events e join coh on coh.user_id = e.user_id
             where e.name = 'page_viewed' and e.feature is not null and e.feature not in ('home','onboarding','landing')
               and e.created_at >= coh.r0 and e.created_at < coh.r0 + make_interval(days => w)),
  s2 as (select c.user_id, least((select min(at) from act where act.user_id = c.user_id), (select min(at) from views v where v.user_id = c.user_id)) t2 from coh c),
  s3 as (select s2.user_id, (select min(a.started_at) from att a where a.user_id = s2.user_id and a.started_at >= s2.t2 - interval '1 second') t3 from s2 where t2 is not null),
  s4 as (select s3.user_id, (select min(a.submitted_at) from att a where a.user_id = s3.user_id and a.status = 'final' and a.started_at >= s3.t3) t4 from s3 where t3 is not null),
  s5 as (select s4.user_id, (select min(x.at) from act x join coh on coh.user_id = x.user_id where x.user_id = s4.user_id and x.at > s4.t4 and x.day > coh.d0) t5 from s4 where t4 is not null),
  s6 as (select s5.user_id, (select count(distinct x.day) from act x where x.user_id = s5.user_id) >= 3 ok from s5 where t5 is not null)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to), 'window_days', w, 'coverage', cbt._fi_coverage(),
    'immature', (select count(*) from coh where coh.r0 > now() - make_interval(days => w)),
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'registered', 'label', 'Registered', 'n', (select count(*) from coh)),
      jsonb_build_object('key', 'first_interaction', 'label', 'First meaningful feature interaction', 'n', (select count(*) from s2 where t2 is not null)),
      jsonb_build_object('key', 'first_start', 'label', 'First practice or quiz started', 'n', (select count(*) from s3 where t3 is not null)),
      jsonb_build_object('key', 'first_complete', 'label', 'First practice or quiz completed', 'n', (select count(*) from s4 where t4 is not null)),
      jsonb_build_object('key', 'returned', 'label', 'Returned on a later day', 'n', (select count(*) from s5 where t5 is not null)),
      jsonb_build_object('key', 'consistent', 'label', 'Consistent: active on 3+ days', 'n', (select count(*) from s6 where ok))))
  into r;
  return r;
end $$;

-- ───────────────────────── Student explorer ─────────────────────────
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
    select s.user_id, s.registered_at,
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
    from stu s left join ev on ev.user_id = s.user_id),
  seg as (
    select * from rows where
      (p_search is null or cbt._fi_code(user_id) ilike '%' || p_search || '%') and
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
        'user_id', user_id, 'student', cbt._fi_code(user_id), 'registered_at', registered_at, 'last_active', last_active,
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

-- Only signed-in users can even call these; each one also checks for an admin inside.
do $$ declare fn text; begin
  foreach fn in array array['cbt.fi_overview(date, date)', 'cbt.fi_feed(timestamptz, int, text[], text, date, date)',
                            'cbt.fi_engagement(date, date)', 'cbt.fi_features(date, date)', 'cbt.fi_funnel(date, date, int)',
                            'cbt.fi_students(text, text, int, int)', 'cbt.fi_student(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
