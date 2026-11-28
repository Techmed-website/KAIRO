-- Behaviour tests for 20261125090000_cbt_kairo_push.sql. Run after 13.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
-- Stand-in for the website's entitlements table (public schema on Supabase).
create table if not exists public.entitlements (user_id uuid, resource_id text, is_active boolean, revoked_at timestamptz, expires_at timestamptz);
insert into public.entitlements values ('00000000-0000-0000-0000-00000000000b', 'cohort-core', true, null, null);  -- Bola is enrolled
create temp table d (k text, j jsonb);

select pg_temp.check((select count(*) >= 40 from cbt.daily_quotes), 'a bank of daily quotes');
-- Morning, the day of a live daily quiz.
update cbt.assessments set status = 'live', opens_at = '2026-11-25 04:30+01' where id = (select id from cbt.assessments where type = 'daily_quiz' and status <> 'archived' order by opens_at desc limit 1);
insert into d select 'm', cbt.kairo_push_plan('morning', '2026-11-25 06:00+01');
select pg_temp.check((select j ->> 'audience' = 'all' and j ->> 'topic' = 'kairo-morning' and j ->> 'title' = '☀️ Morning Charge · Day 15'
                       and j ->> 'body' like '“%”%' and j ->> 'url' like 'https://kairo.techmedng.com/q/%' from d where k = 'm'), 'morning: quote + today''s quiz, to everyone, opens the quiz');
select cbt.kairo_push_done((select j ->> 'key' from d where k = 'm'), 100, null);
select pg_temp.check(cbt.kairo_push_plan('morning', '2026-11-25 06:05+01') is null, 'never sent twice in a day');
select pg_temp.check((cbt.kairo_push_plan('morning', '2026-11-26 06:00+01') ->> 'body') <> (select j ->> 'body' from d where k = 'm'), 'a different quote the next day');

-- Evening: only students active in 30 days who have not practised today.
insert into cbt.attempts (id, user_id, assessment_id, origin, started_at) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', (select id from cbt.assessments where type = 'practice' limit 1), 'online', '2026-11-20 10:00+01'),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', (select id from cbt.assessments where type = 'practice' limit 1), 'online', '2026-11-26 08:00+01');
insert into d select 'e', cbt.kairo_push_plan('evening', '2026-11-26 19:30+01');
select pg_temp.check((select j -> 'user_ids' ? '00000000-0000-0000-0000-00000000000a' and not (j -> 'user_ids' ? '00000000-0000-0000-0000-00000000000b') from d where k = 'e'),
  'evening reminder goes only to students who have not practised today');

-- Classes note: every second day, only to students without a plan, never after 14 Dec.
select pg_temp.check(cbt.kairo_push_plan('enrol', '2026-11-25 13:00+01') is null, 'day 15 is not a classes day (every second day)');
insert into d select 'c', cbt.kairo_push_plan('enrol', '2026-11-26 13:00+01');
select pg_temp.check((select not (j -> 'user_ids' ? '00000000-0000-0000-0000-00000000000b') and j -> 'user_ids' ? '00000000-0000-0000-0000-00000000000a'
                       and j ->> 'body' like '%optional%' and j ->> 'url' like 'https://techmedng.com/pricing/%' from d where k = 'c'), 'classes note skips enrolled students, says it is optional');
select pg_temp.check(cbt.kairo_push_plan('enrol', '2026-12-16 13:00+01') is null, 'classes notes stop after 14 Dec');

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform cbt.kairo_push_plan('morning'); raise exception 'FAIL: student read the push plan';
exception when insufficient_privilege then raise notice 'ok  students cannot read push plans'; end $$;
reset role; reset request.jwt.claim.sub;
do $$ begin raise notice 'ALL KAIRO PUSH CHECKS PASSED'; end $$;
