-- Behaviour tests for 20261127180000_cbt_attendance_and_recaps.sql. Isolated fixtures only.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
insert into auth.users (id, email) values ('fd000000-0000-0000-0000-0000000000a1', 'paid.att@example.org'),
  ('fd000000-0000-0000-0000-0000000000a2', 'free.att@example.org'), ('fd000000-0000-0000-0000-0000000000a3', 'tutor.att@example.org'),
  ('fd000000-0000-0000-0000-0000000000a0', 'founder.att@example.org');
insert into cbt.profiles (id, full_name, role) values ('fd000000-0000-0000-0000-0000000000a1', 'Paid Pupil', 'student'),
  ('fd000000-0000-0000-0000-0000000000a2', 'Free Pupil', 'student'), ('fd000000-0000-0000-0000-0000000000a3', 'Tutor Tee', 'student'),
  ('fd000000-0000-0000-0000-0000000000a0', 'Founder', 'admin');
alter table public.entitlements add column if not exists starts_at timestamptz, add column if not exists granted_at timestamptz,
  add column if not exists created_at timestamptz default now();
insert into public.entitlements (user_id, resource_id, is_active, revoked_at, expires_at)
values ('fd000000-0000-0000-0000-0000000000a1', 'cohort-mastery', true, null, now() + interval '60 days');
-- A class that started 10 minutes ago (fixed code for the test).
insert into cbt.class_sessions (class_date, starts_at, ends_at, code)
values ((now() at time zone 'Africa/Lagos')::date, now() - interval '10 minutes', now() + interval '3 hours', 'ABC234')
on conflict (class_date, title) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, code = excluded.code;

set role authenticated; set request.jwt.claim.sub = 'fd000000-0000-0000-0000-0000000000a2';
select pg_temp.check(cbt.class_checkin('ABC234') ->> 'reason' = 'not_enrolled', 'only paid students can check in');
select pg_temp.check(not (cbt.my_attendance() ->> 'paid')::boolean, 'free student: no attendance card');
do $$ begin perform cbt.staff_today(); raise exception 'FAIL: a student opened the staff portal'; exception when insufficient_privilege then null; end $$;
reset role; set role authenticated; set request.jwt.claim.sub = 'fd000000-0000-0000-0000-0000000000a1';
select pg_temp.check(cbt.class_checkin('WRONG1') ->> 'reason' = 'wrong_code', 'wrong code refused');
select pg_temp.check((cbt.class_checkin(' abc234 ') ->> 'status') = 'present', 'right code (any case, spaces) → present within 15 minutes');
select pg_temp.check((cbt.class_checkin('ABC234') ->> 'already')::boolean, 'checking in twice is harmless');
select pg_temp.check((cbt.my_attendance() -> 'today' ->> 'status') = 'present' and (cbt.my_attendance() -> 'stats' ->> 'attended')::int = 1, 'student sees today''s status and totals');
do $$ begin perform cbt.admin_set_tutor('tutor.att@example.org', true); raise exception 'FAIL: student made a tutor'; exception when insufficient_privilege then null; end $$;
reset role; set role authenticated; set request.jwt.claim.sub = 'fd000000-0000-0000-0000-0000000000a0';
select pg_temp.check((cbt.admin_set_tutor('TUTOR.att@example.org', true) ->> 'ok')::boolean, 'founder makes a tutor by email');
select pg_temp.check(not (cbt.admin_set_tutor('nobody@example.org', true) ->> 'ok')::boolean, 'unknown email: clear refusal');
reset role; set role authenticated; set request.jwt.claim.sub = 'fd000000-0000-0000-0000-0000000000a3';
create temp table st as select cbt.staff_today() j;
select pg_temp.check((select j -> 'session' ->> 'code' = 'ABC234' and (j ->> 'checked_in')::int >= 1 from st), 'tutor sees today''s code and live count');
select pg_temp.check((select count(*) >= 1 from jsonb_array_elements(cbt.staff_roster((select (j -> 'session' ->> 'id')::uuid from st))) r
                      where r ->> 'name' = 'Paid Pupil' and r ->> 'status' = 'present'), 'roster shows who checked in');
select cbt.staff_mark((select (j -> 'session' ->> 'id')::uuid from st), 'fd000000-0000-0000-0000-0000000000a1', 'late');
select pg_temp.check((select count(*) = 1 from jsonb_array_elements(cbt.staff_students()) s where s ->> 'name' = 'Paid Pupil' and (s -> 'attendance' ->> 'late')::int = 1), 'tutor marking corrects attendance');
select pg_temp.check(jsonb_array_length(cbt.staff_add_review('fd000000-0000-0000-0000-0000000000a1', 'Strong start; revise moles.')) = 1, 'tutor adds a review');
select pg_temp.check(cbt.staff_new_code((select (j -> 'session' ->> 'id')::uuid from st)) ~ '^[A-HJ-NP-Z2-9]{6}$', 'tutor can rotate the code');
do $$ begin perform cbt.fi_overview(current_date, current_date); raise exception 'FAIL: tutor read founder analytics'; exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;
-- Recaps
select pg_temp.check(cbt.build_recaps('week', current_date - 6, current_date) >= 0, 'recaps build');
select pg_temp.check(cbt.build_recaps('week', current_date - 6, current_date) = 0, 'a period is built once');
select pg_temp.check((select (cbt._recap('fd000000-0000-0000-0000-0000000000a1', current_date - 6, current_date) -> 'attendance' ->> 'attended')::int = 1), 'paid students'' recap includes attendance');
select pg_temp.check((select cbt._recap('fd000000-0000-0000-0000-0000000000a2', current_date - 6, current_date) -> 'attendance' = 'null'::jsonb), 'free students'' recap has no attendance');
