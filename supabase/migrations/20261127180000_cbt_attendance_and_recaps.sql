-- TECHMED attendance + staff portal + weekly/monthly recaps. Additive.
-- (The 'tutor' role value is added by 20261127175900_cbt_tutor_role.sql.)
--
-- ATTENDANCE
--   Live classes: Monday–Saturday, 7–11 PM Lagos, from 30 Nov 2026. A session row is created automatically every class day
--   (18:00 Lagos) with a fresh 6-character check-in code. The tutor posts the code in the Telegram class; paid students
--   enter it on the TECHMED dashboard. Window: 6:45 PM – 11:00 PM; after 7:15 PM it counts as late. Staff can mark
--   anyone present / late / absent / excused, and add short reviews of a student.
--   Staff = tutor, editor or admin. Only the admin can make someone a tutor.
-- RECAPS
--   Weekly (Monday–Sunday) and monthly snapshots per student, built from attempts and answers, stored once, then emailed
--   and pushed once each (cbt.recaps.emailed_at / pushed_at) and shown in KAIRO for 3 days (then kept in history).

-- ───────────────────────── staff ─────────────────────────
create or replace function cbt.is_class_staff() returns boolean
language sql stable security definer set search_path = cbt, pg_temp as
$$ select cbt.my_role()::text in ('tutor', 'editor', 'admin') $$;
revoke execute on function cbt.is_class_staff() from public, anon;
grant execute on function cbt.is_class_staff() to authenticated;

create or replace function cbt._require_class_staff() returns uuid
language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  if auth.uid() is null or not cbt.is_class_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return auth.uid();
end $$;
revoke execute on function cbt._require_class_staff() from public, anon, authenticated;

-- ───────────────────────── tables ─────────────────────────
create table if not exists cbt.class_sessions (
  id          uuid primary key default gen_random_uuid(),
  class_date  date not null,
  title       text not null default 'Live class',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  code        text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (class_date, title)
);
create table if not exists cbt.class_attendance (
  session_id  uuid not null references cbt.class_sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null check (status in ('present', 'late', 'absent', 'excused')),
  method      text not null check (method in ('code', 'staff')),
  marked_by   uuid,
  at          timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists class_attendance_user_idx on cbt.class_attendance (user_id);
create table if not exists cbt.checkin_tries (user_id uuid not null, session_id uuid not null, at timestamptz not null default now());
create index if not exists checkin_tries_idx on cbt.checkin_tries (user_id, session_id);
create table if not exists cbt.student_reviews (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references auth.users(id) on delete cascade,
  staff_id    uuid not null,
  body        text not null check (length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists student_reviews_student_idx on cbt.student_reviews (student_id, created_at desc);
alter table cbt.class_sessions enable row level security;
alter table cbt.class_attendance enable row level security;
alter table cbt.checkin_tries enable row level security;
alter table cbt.student_reviews enable row level security;
revoke all on cbt.class_sessions, cbt.class_attendance, cbt.checkin_tries, cbt.student_reviews from anon, authenticated;

create or replace function cbt._class_code() returns text language plpgsql volatile set search_path = cbt, pg_temp as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop; return c; end $$;

-- Today's class (Mon–Sat from 30 Nov 2026), created once. Called by cron at 18:00 Lagos and by staff screens.
create or replace function cbt.ensure_class_session(p_date date default (now() at time zone 'Africa/Lagos')::date)
returns cbt.class_sessions language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare s cbt.class_sessions;
begin
  select * into s from cbt.class_sessions where class_date = p_date and title = 'Live class';
  if found then return s; end if;
  if p_date < date '2026-11-30' or extract(isodow from p_date) = 7 then return null; end if;
  insert into cbt.class_sessions (class_date, starts_at, ends_at, code)
  values (p_date, (p_date + time '19:00') at time zone 'Africa/Lagos', (p_date + time '23:00') at time zone 'Africa/Lagos', cbt._class_code())
  on conflict (class_date, title) do nothing returning * into s;
  if s.id is null then select * into s from cbt.class_sessions where class_date = p_date and title = 'Live class'; end if;
  return s;
end $$;
revoke execute on function cbt.ensure_class_session(date) from public, anon, authenticated;

-- When a student's class plan started (for "classes held since you joined").
create or replace function cbt._plan_start(p_user uuid) returns timestamptz
language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v timestamptz;
begin
  select min(coalesce(e.starts_at, e.granted_at, e.created_at)) into v from public.entitlements e
  where e.user_id = p_user and e.resource_id like 'cohort-%' and e.is_active and e.revoked_at is null;
  return v;
end $$;
create or replace function cbt._plan_name(p_user uuid) returns text
language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v text;
begin
  select initcap(replace(e.resource_id, 'cohort-', '')) into v from public.entitlements e
  where e.user_id = p_user and e.resource_id like 'cohort-%' and e.is_active and e.revoked_at is null
    and (e.expires_at is null or e.expires_at > now())
  order by case e.resource_id when 'cohort-ultimate' then 1 when 'cohort-mastery' then 2 else 3 end limit 1;
  return v;
end $$;
revoke execute on function cbt._plan_start(uuid), cbt._plan_name(uuid) from public, anon, authenticated;

-- Attendance numbers for one student between two moments (sessions that had started).
create or replace function cbt._attendance(p_user uuid, p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with s as (select * from cbt.class_sessions where starts_at <= now() and starts_at >= greatest(p_from, coalesce((((cbt._plan_start(p_user) at time zone 'Africa/Lagos')::date)::timestamp at time zone 'Africa/Lagos'), '-infinity'))
                                                and starts_at < p_to),
       a as (select s.id, s.class_date, at.status from s left join cbt.class_attendance at on at.session_id = s.id and at.user_id = p_user)
  select jsonb_build_object(
    'held', (select count(*) from a where status is distinct from 'excused'),
    'attended', (select count(*) from a where status in ('present', 'late')),
    'late', (select count(*) from a where status = 'late'),
    'excused', (select count(*) from a where status = 'excused'),
    'rate', (select round(100.0 * count(*) filter (where status in ('present','late')) / nullif(count(*) filter (where status is distinct from 'excused'), 0)) from a),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('date', class_date, 'status', coalesce(status, 'absent')) order by class_date desc), '[]'::jsonb)
                 from (select * from a order by class_date desc limit 12) r)) $$;
revoke execute on function cbt._attendance(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ───────────────────────── student ─────────────────────────
create or replace function cbt.my_attendance()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); s cbt.class_sessions; mine cbt.class_attendance; v_now timestamptz := now();
begin
  if uid is null or cbt.is_guest() then return null; end if;
  if not cbt._is_paid_student(uid) then return jsonb_build_object('paid', false); end if;
  s := cbt.ensure_class_session();
  if s.id is not null then select * into mine from cbt.class_attendance where session_id = s.id and user_id = uid; end if;
  return jsonb_build_object('paid', true, 'plan', cbt._plan_name(uid),
    'today', case when s.id is null then null else jsonb_build_object(
      'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'open', v_now between s.starts_at - interval '15 minutes' and s.ends_at,
      'status', mine.status, 'at', mine.at) end,
    'stats', cbt._attendance(uid));
end $$;
revoke execute on function cbt.my_attendance() from public, anon;
grant execute on function cbt.my_attendance() to authenticated;

create or replace function cbt.class_checkin(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); s cbt.class_sessions; v_now timestamptz := now(); v_status text; v_tries int;
begin
  if uid is null or cbt.is_guest() then return jsonb_build_object('ok', false, 'reason', 'sign_in'); end if;
  if not cbt._is_paid_student(uid) then return jsonb_build_object('ok', false, 'reason', 'not_enrolled'); end if;
  s := cbt.ensure_class_session();
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'no_class_today'); end if;
  if v_now < s.starts_at - interval '15 minutes' then return jsonb_build_object('ok', false, 'reason', 'too_early', 'opens_at', s.starts_at - interval '15 minutes'); end if;
  if v_now > s.ends_at then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if exists (select 1 from cbt.class_attendance where session_id = s.id and user_id = uid and status in ('present', 'late')) then
    return jsonb_build_object('ok', true, 'already', true, 'status', (select status from cbt.class_attendance where session_id = s.id and user_id = uid));
  end if;
  select count(*) into v_tries from cbt.checkin_tries where user_id = uid and session_id = s.id;
  if v_tries >= 8 then return jsonb_build_object('ok', false, 'reason', 'too_many_tries'); end if;
  if upper(btrim(coalesce(p_code, ''))) <> s.code then
    insert into cbt.checkin_tries (user_id, session_id) values (uid, s.id);
    return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'tries_left', 7 - v_tries);
  end if;
  v_status := case when v_now > s.starts_at + interval '15 minutes' then 'late' else 'present' end;
  insert into cbt.class_attendance (session_id, user_id, status, method) values (s.id, uid, v_status, 'code')
  on conflict (session_id, user_id) do update set status = excluded.status, method = 'code', at = now(), marked_by = null;
  return jsonb_build_object('ok', true, 'status', v_status, 'stats', cbt._attendance(uid));
end $$;
revoke execute on function cbt.class_checkin(text) from public, anon;
grant execute on function cbt.class_checkin(text) to authenticated;

-- ───────────────────────── staff portal ─────────────────────────
create or replace function cbt.staff_today()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare s cbt.class_sessions;
begin
  perform cbt._require_class_staff();
  s := cbt.ensure_class_session();
  return jsonb_build_object('role', cbt.my_role(),
    'session', case when s.id is null then null else jsonb_build_object('id', s.id, 'date', s.class_date, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'code', s.code) end,
    'checked_in', (select count(*) from cbt.class_attendance where session_id = s.id and status in ('present','late')),
    'enrolled', (select count(distinct e.user_id) from public.entitlements e where e.resource_id like 'cohort-%' and e.is_active and e.revoked_at is null
                   and (e.expires_at is null or e.expires_at > now()) and e.user_id is not null),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'date', class_date, 'title', title,
                   'present', (select count(*) from cbt.class_attendance a where a.session_id = cs.id and a.status in ('present','late')))
                   order by class_date desc), '[]'::jsonb) from (select * from cbt.class_sessions order by class_date desc limit 30) cs));
end $$;

create or replace function cbt.staff_new_code(p_session uuid)
returns text language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v text := cbt._class_code();
begin
  perform cbt._require_class_staff();
  update cbt.class_sessions set code = v where id = p_session;
  return v;
end $$;

create or replace function cbt.staff_roster(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_class_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', c.full_name, 'email', c.email, 'phone', c.phone,
            'plan', cbt._plan_name(x.user_id), 'status', a.status, 'method', a.method, 'at', a.at) order by a.status nulls last, c.full_name), '[]'::jsonb)
          from (select distinct e.user_id from public.entitlements e where e.resource_id like 'cohort-%' and e.is_active and e.revoked_at is null
                  and (e.expires_at is null or e.expires_at > now()) and e.user_id is not null) x
          cross join lateral cbt._fi_contact(x.user_id) c
          left join cbt.class_attendance a on a.session_id = p_session and a.user_id = x.user_id);
end $$;

create or replace function cbt.staff_mark(p_session uuid, p_user uuid, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_class_staff();
begin
  if p_status not in ('present', 'late', 'absent', 'excused') then raise exception 'bad status' using errcode = '22023'; end if;
  insert into cbt.class_attendance (session_id, user_id, status, method, marked_by) values (p_session, p_user, p_status, 'staff', uid)
  on conflict (session_id, user_id) do update set status = excluded.status, method = 'staff', marked_by = uid, at = now();
  perform cbt._audit('attendance_mark', 'class_attendance', p_session::text || ':' || p_user::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('status', p_status);
end $$;

-- Every paid student with attendance, KAIRO practice and test performance (drills, challenges, mocks), last review.
create or replace function cbt.staff_students()
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_class_staff();
  return (select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.name), '[]'::jsonb) from (
    select x.user_id, c.full_name name, c.email, c.phone, cbt._plan_name(x.user_id) plan,
           cbt._attendance(x.user_id) attendance,
           (select coalesce(sum((select count(*) from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null)), 0)
              from cbt.attempts t where t.user_id = x.user_id and t.started_at > now() - interval '7 days' and t.status <> 'rejected') questions_7d,
           (select max(t.started_at) from cbt.attempts t where t.user_id = x.user_id) last_practice,
           (select round(avg(100.0 * t.score / nullif(t.total, 0))) from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
              where t.user_id = x.user_id and t.status = 'final' and (a.type in ('weekly_drill', 'challenge', 'mock') or (not a.personal))
                and t.submitted_at > now() - interval '30 days') test_avg_30d,
           (select coalesce(jsonb_agg(jsonb_build_object('at', t.submitted_at, 'title', a.title, 'type', a.type, 'score', t.score, 'total', t.total) order by t.submitted_at desc), '[]'::jsonb)
              from (select t.* from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
                    where t.user_id = x.user_id and t.status = 'final' and (a.type in ('weekly_drill', 'challenge', 'mock') or (not a.personal))
                    order by t.submitted_at desc limit 8) t join cbt.assessments a on a.id = t.assessment_id) tests,
           (select jsonb_build_object('body', body, 'at', created_at) from cbt.student_reviews sr where sr.student_id = x.user_id order by created_at desc limit 1) last_review
    from (select distinct e.user_id from public.entitlements e where e.resource_id like 'cohort-%' and e.is_active and e.revoked_at is null
            and (e.expires_at is null or e.expires_at > now()) and e.user_id is not null) x
    cross join lateral cbt._fi_contact(x.user_id) c) r);
end $$;

create or replace function cbt.staff_reviews(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_class_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'body', body, 'at', created_at,
            'by', (select full_name from cbt.profiles where id = staff_id)) order by created_at desc), '[]'::jsonb)
          from cbt.student_reviews where student_id = p_student);
end $$;

create or replace function cbt.staff_add_review(p_student uuid, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_class_staff();
begin
  insert into cbt.student_reviews (student_id, staff_id, body) values (p_student, uid, btrim(p_body));
  return cbt.staff_reviews(p_student);
end $$;

-- Founder: give or remove tutor access by email (the person must have signed up first).
create or replace function cbt.admin_set_tutor(p_email text, p_tutor boolean)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v uuid; v_role cbt.user_role;
begin
  perform cbt._require_admin();
  select id into v from auth.users where lower(email) = lower(btrim(p_email)) and not coalesce(is_anonymous, false);
  if v is null then return jsonb_build_object('ok', false, 'reason', 'This email has no TECHMED account yet. Ask them to sign up first.'); end if;
  insert into cbt.profiles (id, full_name, email) values (v, '', lower(btrim(p_email))) on conflict (id) do nothing;
  select role into v_role from cbt.profiles where id = v;
  if v_role in ('admin', 'editor') then return jsonb_build_object('ok', false, 'reason', 'This account is already an editor or admin.'); end if;
  update cbt.profiles set role = case when p_tutor then 'tutor'::cbt.user_role else 'student'::cbt.user_role end where id = v;
  perform cbt._audit('set_tutor', 'profiles', v::text, jsonb_build_object('tutor', p_tutor));
  return jsonb_build_object('ok', true, 'tutor', p_tutor);
end $$;

create or replace function cbt.admin_staff_list()
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', c.full_name, 'email', c.email, 'role', p.role) order by p.role, c.full_name), '[]'::jsonb)
          from cbt.profiles p cross join lateral cbt._fi_contact(p.id) c where p.role::text in ('tutor', 'editor', 'admin'));
end $$;

do $$ declare fn text; begin
  foreach fn in array array['cbt.staff_today()', 'cbt.staff_new_code(uuid)', 'cbt.staff_roster(uuid)', 'cbt.staff_mark(uuid, uuid, text)',
                            'cbt.staff_students()', 'cbt.staff_reviews(uuid)', 'cbt.staff_add_review(uuid, text)',
                            'cbt.admin_set_tutor(text, boolean)', 'cbt.admin_staff_list()'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ───────────────────────── recaps ─────────────────────────
create table if not exists cbt.recaps (
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('week', 'month')),
  period_start  date not null,
  period_end    date not null,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz,
  pushed_at     timestamptz,
  primary key (user_id, kind, period_start)
);
alter table cbt.recaps enable row level security;
revoke all on cbt.recaps from anon, authenticated;

-- One student's numbers for a Lagos date range [p_from, p_to].
create or replace function cbt._recap(p_uid uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  v_f timestamptz := (p_from::timestamp) at time zone 'Africa/Lagos'; v_t timestamptz := ((p_to + 1)::timestamp) at time zone 'Africa/Lagos';
  len int := p_to - p_from + 1; v_pf timestamptz := v_f - make_interval(days => len);
  r jsonb;
begin
  with att as (select t.* from cbt.attempts t where t.user_id = p_uid and t.status <> 'rejected' and t.started_at >= v_pf and t.started_at < v_t),
  ans as (select aa.*, (t.started_at >= v_f) cur, v.topic_id, q.subject_id, t.started_at
          from att t join cbt.attempt_answers aa on aa.attempt_id = t.id
          join cbt.questions q on q.id = aa.question_id
          left join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
          where aa.selected_option is not null),
  cur as (select * from ans where cur),
  subj as (select s.code, s.name, count(*) n, round(100.0 * count(*) filter (where c.is_correct) / count(*)) acc
           from cur c join cbt.subjects s on s.id = c.subject_id group by 1, 2),
  top as (select c.topic_id, tp.name, s.code, count(*) n, round(100.0 * count(*) filter (where c.is_correct) / count(*)) acc
          from cur c join cbt.topics tp on tp.id = c.topic_id join cbt.subjects s on s.id = tp.subject_id where c.topic_id is not null group by 1, 2, 3),
  days as (select distinct (started_at at time zone 'Africa/Lagos')::date d from att where started_at >= v_f),
  others as (select t.user_id, count(*) n from cbt.attempts t join cbt.attempt_answers aa on aa.attempt_id = t.id
             join auth.users u on u.id = t.user_id
             where aa.selected_option is not null and t.started_at >= v_f and t.started_at < v_t and t.status <> 'rejected' and not coalesce(u.is_anonymous, false)
             group by 1)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days_in_period', len,
    'questions', (select count(*) from cur),
    'prev_questions', (select count(*) from ans where not cur),
    'correct', (select count(*) filter (where is_correct) from cur),
    'accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0)) from cur),
    'prev_accuracy', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0)) from ans where not cur),
    'minutes', (select round(coalesce(sum(time_ms), 0) / 60000.0) from cur),
    'active_days', (select count(*) from days),
    'day_map', case when len <= 7 then (select jsonb_agg((d::date) in (select d from days) order by d) from generate_series(p_from, p_to, interval '1 day') d) end,
    'sessions', (select count(*) from att where status = 'final' and started_at >= v_f),
    'daily_quizzes', (select count(*) from att t join cbt.assessments a on a.id = t.assessment_id where t.started_at >= v_f and t.status = 'final' and a.type = 'daily_quiz'),
    'mocks', (select count(*) from att t join cbt.assessments a on a.id = t.assessment_id where t.started_at >= v_f and t.status = 'final' and a.type = 'mock'),
    'best_subject', (select jsonb_build_object('code', code, 'name', name, 'accuracy', acc, 'n', n) from subj where n >= 10 order by acc desc, n desc limit 1),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'accuracy', acc, 'n', n) order by n desc), '[]'::jsonb) from subj),
    'focus_topic', (select jsonb_build_object('topic_id', topic_id, 'name', name, 'code', code, 'accuracy', acc, 'n', n) from top where n >= 5 order by acc asc, n desc limit 1),
    'strong_topic', (select jsonb_build_object('topic_id', topic_id, 'name', name, 'code', code, 'accuracy', acc, 'n', n) from top where n >= 5 order by acc desc, n desc limit 1),
    'streak', cbt._streak(p_uid, least(v_t, now())),
    'xp', (select coalesce(sum(xp), 0) from cbt._xp_events(p_uid) where at >= v_f and at < v_t),
    'badges', (select coalesce(jsonb_agg(b.title order by ub.earned_at), '[]'::jsonb) from cbt.user_badges ub join cbt.badges b on b.code = ub.badge_code
               where ub.user_id = p_uid and ub.earned_at >= v_f and ub.earned_at < v_t),
    'beat_pct', (select case when count(*) >= 5 and (select count(*) from cur) > 0
                         then round(100.0 * count(*) filter (where n < (select count(*) from cur)) / count(*)) end from others),
    'active_students', (select count(*) from others),
    'attendance', case when cbt._is_paid_student(p_uid) then cbt._attendance(p_uid, v_f, v_t) end)
  into r;
  return r;
end $$;
revoke execute on function cbt._recap(uuid, date, date) from public, anon, authenticated;

-- Build snapshots for every signed-up student with any KAIRO activity before the period ended. Once per period.
create or replace function cbt.build_recaps(p_kind text, p_from date, p_to date)
returns int language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare n int;
begin
  insert into cbt.recaps (user_id, kind, period_start, period_end, data)
  select p.id, p_kind, p_from, p_to, cbt._recap(p.id, p_from, p_to)
  from cbt.profiles p join auth.users u on u.id = p.id
  where p.role = 'student' and not coalesce(u.is_anonymous, false)
    and exists (select 1 from cbt.attempts t where t.user_id = p.id and t.started_at < ((p_to + 1)::timestamp) at time zone 'Africa/Lagos')
  on conflict (user_id, kind, period_start) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Last full Monday–Sunday week / last full month in Lagos.
create or replace function cbt.build_last_week_recaps() returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare d date := (now() at time zone 'Africa/Lagos')::date; s date := date_trunc('week', d)::date - 7;
begin return jsonb_build_object('kind', 'week', 'from', s, 'to', s + 6, 'built', cbt.build_recaps('week', s, s + 6)); end $$;
create or replace function cbt.build_last_month_recaps() returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare d date := (now() at time zone 'Africa/Lagos')::date; s date := (date_trunc('month', d) - interval '1 month')::date;
begin return jsonb_build_object('kind', 'month', 'from', s, 'to', (date_trunc('month', d) - interval '1 day')::date,
                                'built', cbt.build_recaps('month', s, (date_trunc('month', d) - interval '1 day')::date)); end $$;

-- Delivery queues for the kairo-mail function (service role).
create or replace function cbt.recap_queue(p_kind text, p_channel text, p_limit int default 100)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('user_id', r.user_id, 'kind', r.kind, 'period_start', r.period_start, 'period_end', r.period_end, 'data', r.data,
             'email', lower(u.email), 'first_name', nullif(split_part(btrim(coalesce(c.full_name, '')), ' ', 1), ''),
             'unsub', cbt._unsub_token(r.user_id, 'recaps'), 'unsub_all', cbt._unsub_token(r.user_id, 'all'),
             'paid', cbt._is_paid_student(r.user_id), 'kairo', true) x
    from cbt.recaps r join auth.users u on u.id = r.user_id cross join lateral cbt._fi_contact(r.user_id) c
    where r.kind = p_kind and r.created_at > now() - interval '4 days'
      and case p_channel
            when 'email' then r.emailed_at is null and u.email is not null and u.email_confirmed_at is not null
                              and lower(u.email) !~ '@(example\.(com|org|net)|test\.com|mailinator\.com)$' and cbt._email_ok(r.user_id, 'recaps')
            when 'push' then r.pushed_at is null and (cbt._prefs(r.user_id)).push_recaps
            else false end
    order by (r.data ->> 'questions')::int desc nulls last
    limit greatest(1, least(coalesce(p_limit, 100), 500))) q $$;
create or replace function cbt.recap_mark(p_user uuid, p_kind text, p_period date, p_channel text)
returns void language sql volatile security definer set search_path = cbt, pg_temp as $$
  update cbt.recaps set emailed_at = case when p_channel = 'email' then now() else emailed_at end,
                        pushed_at = case when p_channel = 'push' then now() else pushed_at end
  where user_id = p_user and kind = p_kind and period_start = p_period $$;
revoke execute on function cbt.build_recaps(text, date, date), cbt.build_last_week_recaps(), cbt.build_last_month_recaps(),
                           cbt.recap_queue(text, text, int), cbt.recap_mark(uuid, text, date, text) from public, anon, authenticated;
grant execute on function cbt.build_recaps(text, date, date), cbt.build_last_week_recaps(), cbt.build_last_month_recaps(),
                          cbt.recap_queue(text, text, int), cbt.recap_mark(uuid, text, date, text) to service_role;

-- KAIRO: the latest recaps and history. 'fresh' = created in the last 3 days (Home shows it, then it moves to history).
create or replace function cbt.my_recaps()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'latest', (select jsonb_build_object('kind', kind, 'period_start', period_start, 'period_end', period_end, 'data', data, 'created_at', created_at,
                 'fresh', created_at > now() - interval '3 days') from cbt.recaps where user_id = auth.uid() order by created_at desc, kind limit 1),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'period_start', period_start, 'period_end', period_end, 'data', data) order by period_start desc, kind), '[]'::jsonb)
                from (select * from cbt.recaps where user_id = auth.uid() order by period_start desc limit 16) h)) end $$;
revoke execute on function cbt.my_recaps() from public, anon;
grant execute on function cbt.my_recaps() to authenticated;
