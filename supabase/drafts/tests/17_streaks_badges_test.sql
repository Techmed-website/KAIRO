-- Behaviour tests for 20261126090000_cbt_streaks_badges.sql and 20261126090100_cbt_streak_reminder.sql. Run after 16.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'funmi@example.com');
insert into cbt.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000f1', 'Funmi Ade');
-- Funmi's own practice paper, so later suites can compare her with exactly the students they add.
insert into cbt.assessments (id, type, title, status) values ('f0000000-0000-0000-0000-000000000001', 'practice', 'Funmi practice', 'live');
-- Funmi finishes something on 20, 21 and 22 Nov (Lagos), one of them a perfect 10/10; then an unfinished one on the 23rd.
insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status, score, total) values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'online',
   '2026-11-20 20:00+01', '2026-11-20 20:10+01', '2026-11-20 20:10+01', 'final', 6, 10),
  ('f1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'online',
   '2026-11-21 23:50+01', '2026-11-21 23:58+01', '2026-11-22 00:02+01', 'final', 10, 10),
  ('f1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'online',
   '2026-11-22 07:00+01', '2026-11-22 07:05+01', '2026-11-22 07:05+01', 'final', 4, 10),
  ('f1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'online',
   '2026-11-23 07:00+01', null, null, 'in_progress', null, null);

insert into d select 's1', cbt._streak('00000000-0000-0000-0000-0000000000f1', '2026-11-23 12:00+01');
select pg_temp.check((select (j ->> 'current')::int = 3 and (j ->> 'best')::int = 3 and not (j ->> 'today')::boolean from d where k = 's1'),
  'streak counts Lagos days by finish time (23:58 counts for the 21st), and still holds the morning after');
select pg_temp.check((select jsonb_array_length(j -> 'week') = 7 and (j -> 'week' ->> 5)::boolean and not (j -> 'week' ->> 6)::boolean from d where k = 's1'), 'a 7-day strip ending today');
select pg_temp.check((cbt._streak('00000000-0000-0000-0000-0000000000f1', '2026-11-24 12:00+01') ->> 'current')::int = 0, 'a missed day resets the current streak');
select pg_temp.check((cbt._streak('00000000-0000-0000-0000-0000000000f1', '2026-11-24 12:00+01') ->> 'best')::int = 3, 'best streak is kept');
select pg_temp.check((cbt._streak('00000000-0000-0000-0000-0000000000f1', '2026-11-22 21:00+01') ->> 'today')::boolean, 'today is marked done after a finished attempt');

-- Evening reminder on the 23rd: Funmi is on a 3-day streak and has not started anything today.
update cbt.attempts set started_at = '2026-11-22 07:30+01' where id = 'f1000000-0000-0000-0000-000000000004';
create temp table ev as select cbt.kairo_push_plan('evening', '2026-11-23 19:30+01') j;
select pg_temp.check((select exists (select 1 from jsonb_array_elements(j -> 'groups') g
                                     where g ->> 'title' = '🔥 Keep your 3-day streak' and g -> 'user_ids' ? '00000000-0000-0000-0000-0000000000f1')
                       and not (j -> 'user_ids' ? '00000000-0000-0000-0000-0000000000f1') from ev),
  'evening: students on a streak get "Keep your N-day streak", not the general note');

-- Badges: Funmi asks for her progress.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
insert into d select 'p1', cbt.my_progress();
select pg_temp.check((select j -> 'new' ? 'first_quiz' and j -> 'new' ? 'streak_3' and j -> 'new' ? 'perfect' and not (j -> 'new' ? 'streak_7') from d where k = 'p1'),
  'first quiz, 3-day streak and perfect score are earned; 7-day streak is not');
select pg_temp.check((select (b ->> 'progress')::int = 3 and b ->> 'earned_at' is null from d, jsonb_array_elements(j -> 'badges') b
                       where k = 'p1' and b ->> 'code' = 'streak_7'), 'unearned badges show progress (3 of 7)');
select pg_temp.check((select (b ->> 'earned_at') is not null from d, jsonb_array_elements(j -> 'badges') b where k = 'p1' and b ->> 'code' = 'perfect'), 'earned badges carry the date');
select pg_temp.check(jsonb_array_length(cbt.my_progress() -> 'new') = 0, 'badges are awarded once');
select pg_temp.check((select count(*) = 3 from cbt.user_badges), 'I can read my own badges');
reset role; reset request.jwt.claim.sub;

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check((select count(*) = 0 from cbt.user_badges where user_id = '00000000-0000-0000-0000-0000000000f1'), 'other students cannot see my badges');
do $$ begin perform cbt.award_badges('00000000-0000-0000-0000-0000000000f1'); raise exception 'FAIL: student called award_badges';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt._streak('00000000-0000-0000-0000-0000000000f1'); raise exception 'FAIL: student read another streak';
exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
select pg_temp.check((select count(*) >= 10 from cbt.badges), 'the badge list is public');
do $$ begin perform cbt.my_progress(); raise exception 'FAIL: anon progress'; exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin raise notice 'ALL STREAK AND BADGE CHECKS PASSED'; end $$;
