-- Behaviour tests for 20261127090000_cbt_xp_levels.sql. Run after 20.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

-- Reset windows (Lagos is UTC+1, no daylight saving).
select pg_temp.check(cbt.week_start('2030-03-03 21:59+01') = '2030-02-24 22:00+01', 'Sunday 21:59 still belongs to the week that started last Sunday 22:00');
select pg_temp.check(cbt.week_start('2030-03-03 22:00+01') = '2030-03-03 22:00+01', 'the weekly board resets at Sunday 22:00 Lagos');
select pg_temp.check(cbt.week_start('2030-03-06 09:00+01') = '2030-03-03 22:00+01', 'midweek belongs to the week from Sunday 22:00');
select pg_temp.check(cbt.day_start('2030-03-04 00:30+01') = '2030-03-04 00:00+01', 'the daily board resets at Lagos midnight');
select pg_temp.check(cbt.day_start('2030-03-03 23:30+00') = '2030-03-04 00:00+01', '23:30 UTC is already the next Lagos day');

-- Levels: 50·n·(n−1) XP for level n.
select pg_temp.check((cbt.level_for(0) ->> 'level')::int = 1 and (cbt.level_for(99) ->> 'level')::int = 1, 'level 1 below 100 XP');
select pg_temp.check((cbt.level_for(100) ->> 'level')::int = 2 and (cbt.level_for(299) ->> 'level')::int = 2, 'level 2 from 100 XP');
select pg_temp.check((cbt.level_for(300) ->> 'level')::int = 3 and (cbt.level_for(300) ->> 'next')::int = 600, 'level 3 from 300, next at 600');
select pg_temp.check((cbt.level_for(4500) ->> 'level')::int = 10 and cbt.level_for(4500) ->> 'tier' = 'Gold', 'level 10 at 4,500 XP is Gold');
select pg_temp.check(cbt.level_for(1000) ->> 'tier' = 'Silver' and cbt.level_for(0) ->> 'tier' = 'Bronze', 'tiers');

-- People: Xavi and Yemi (accounts), and a guest.
insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000e1', 'xavi@example.com', false),
  ('00000000-0000-0000-0000-0000000000e2', 'yemi@example.com', false),
  ('00000000-0000-0000-0000-0000000000e3', null, true);
insert into cbt.profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Xavi Okon'), ('00000000-0000-0000-0000-0000000000e2', 'Yemi Bello'), ('00000000-0000-0000-0000-0000000000e3', 'Guest');

-- 130 fresh published Chemistry questions, numbered 1..130 (key A).
do $$
declare i int; qid uuid; v_subject smallint := (select id from cbt.subjects where code = 'CHM');
begin
  for i in 1..130 loop
    qid := ('21000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into cbt.questions (id, source_ref, subject_id, stem, options, content_hash)
    values (qid, 'xp:' || i, v_subject, 'xp q' || i, '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 'xp' || i);
    insert into cbt.question_keys (question_id, correct_option, explanation) values (qid, 'A', 'because');
    update cbt.questions set status = 'published' where id = qid;
  end loop;
end $$;
create temp table pool as
  select row_number() over (order by q.id) n, v.question_id, v.version
  from cbt.questions q join lateral (select * from cbt.question_versions v where v.question_id = q.id order by version desc limit 1) v on true
  where q.source_ref like 'xp:%';
select pg_temp.check((select count(*) = 130 from pool), '130 questions to answer');

-- One finished attempt: questions qfrom..qfrom+qn-1, the first ncorrect right. Reuses p_asmt when given (a second attempt).
create or replace function pg_temp.att(p_uid uuid, p_type text, p_at timestamptz, qfrom int, qn int, ncorrect int, p_asmt uuid default null)
returns uuid language plpgsql as $$
declare a uuid := coalesce(p_asmt, gen_random_uuid()); t uuid := gen_random_uuid();
begin
  if p_asmt is null then
    insert into cbt.assessments (id, type, title, status, personal) values (a, p_type::cbt.assessment_type, 'xp test', 'live', true);
  end if;
  insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status, score, total)
  values (t, p_uid, a, 'online', p_at - interval '5 minutes', p_at, p_at, 'final', ncorrect, qn);
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, is_correct)
  select t, question_id, version, case when n - qfrom < ncorrect then 'A' else 'B' end, n - qfrom < ncorrect
  from pool where n between qfrom and qfrom + qn - 1;
  return a;
end $$;

-- Last week, Sunday 21:00 (before the reset): Xavi 12 answers, none right = 12 + session 10 + day 5 = 27.
select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'practice', '2030-03-03 21:00+01', 23, 12, 0);
-- Sunday 22:30 (new week, same Lagos day): 12 right = 36 + session 10 (no second day bonus) = 46.
select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'practice', '2030-03-03 22:30+01', 35, 12, 12);
-- Monday: practice 12 (8 right) = 28 + 10 + day 5 = 43.
select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'practice', '2030-03-04 10:00+01', 1, 12, 8);
-- A retry of the same 12 questions, all right: nothing new today, so no answers XP and no session bonus.
select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'practice', '2030-03-04 10:30+01', 1, 12, 12);
-- Daily quiz: 9/10 = 28 + 20 + 10 (80%+) = 58. Taking it again earns nothing.
create temp table dq as select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'daily_quiz', '2030-03-04 11:00+01', 13, 10, 9) id;
select pg_temp.att('00000000-0000-0000-0000-0000000000e1', 'daily_quiz', '2030-03-04 11:30+01', 13, 10, 10, (select id from dq));
-- Yemi, Monday: 120 right = 360, capped at 300; + session 10 + day 5 = 315. A full mock (130 answers, only 10 new, cap reached) +50.
-- A second mock the same day: no second mock bonus.
select pg_temp.att('00000000-0000-0000-0000-0000000000e2', 'practice', '2030-03-04 12:00+01', 1, 120, 120);
select pg_temp.att('00000000-0000-0000-0000-0000000000e2', 'mock', '2030-03-04 13:00+01', 1, 130, 130);
select pg_temp.att('00000000-0000-0000-0000-0000000000e2', 'mock', '2030-03-04 14:00+01', 1, 130, 130);
-- The guest practises too: guests never appear.
select pg_temp.att('00000000-0000-0000-0000-0000000000e3', 'practice', '2030-03-04 12:00+01', 1, 12, 12);

select pg_temp.check((select sum(xp) = 174 from cbt._xp_events('00000000-0000-0000-0000-0000000000e1')), 'Xavi: 27 + 46 + 43 + 0 + 58 + 0 = 174 XP (retries add nothing)');
select pg_temp.check((select sum(xp) filter (where kind = 'answers') = 300 and sum(xp) filter (where kind = 'mock') = 50 and sum(xp) = 365
                      from cbt._xp_events('00000000-0000-0000-0000-0000000000e2')), 'Yemi: answers capped at 300 a day, one mock bonus a day, 365 XP');
select pg_temp.check((select count(*) = 0 from cbt._xp_events(null) where user_id = '00000000-0000-0000-0000-0000000000e3'), 'guests earn no XP and never appear');
select pg_temp.check((select count(*) = 1 from cbt._xp_events('00000000-0000-0000-0000-0000000000e1') where kind = 'daily_quiz'), 'the daily quiz bonus is paid once');

create temp table s as select cbt._xp_summary('00000000-0000-0000-0000-0000000000e1', '2030-03-04 15:00+01') j;
select pg_temp.check((select (j ->> 'total')::int = 174 and (j ->> 'week')::int = 147 and (j ->> 'today')::int = 101 and (j ->> 'level')::int = 2
                             and (j ->> 'next')::int = 300 from s), 'summary: total 174, this week 147 (from Sunday 22:00), today 101, level 2 (next at 300)');

create temp table b as select p, cbt._xp_board('00000000-0000-0000-0000-0000000000e1', p, 50, '2030-03-04 15:00+01') j from unnest(array['day', 'week', 'all']) p;
select pg_temp.check((select j -> 'rows' -> 0 ->> 'name' = 'Yemi B.' and (j -> 'rows' -> 0 ->> 'xp')::int = 365
                             and (j -> 'rows' -> 1 ->> 'xp')::int = 147 and (j -> 'rows' -> 1 ->> 'is_me')::boolean from b where p = 'week'), 'weekly board: Yemi 365, me 147, names as "First L."');
select pg_temp.check((select (j -> 'me' ->> 'prev_rank')::int = 1 and j -> 'rows' -> 0 -> 'prev_rank' = 'null'::jsonb from b where p = 'week'), 'weekly board: last week''s finish (I was #1, Yemi had not started)');
select pg_temp.check((select (j -> 'me' ->> 'xp')::int = 101 and (j ->> 'participants')::int = 2 from b where p = 'day'), 'daily board: today only; the guest is not counted');
select pg_temp.check((select (j -> 'me' ->> 'xp')::int = 174 and (j -> 'me' ->> 'prev_rank') is not null
                             and (select (r ->> 'rank')::int from jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Yemi B.') < (j -> 'me' ->> 'rank')::int
                      from b where p = 'all'), 'all-time board: lifetime XP (174), a rank before today, Yemi above me');
select pg_temp.check((select (j -> 'me' ->> 'prev_rank')::int > (j -> 'me' ->> 'rank')::int - 2
                      from b where p = 'all'), 'all-time board: before today Yemi had no XP, so I have dropped exactly one place since');
select pg_temp.check((select (j ->> 'ends_at')::timestamptz = '2030-03-10 22:00+01' from b where p = 'week'), 'the weekly board says when it resets');
select pg_temp.check((select jsonb_array_length(j -> 'rows') = 1 and (j -> 'me' ->> 'rank')::int = 2
                      from (select cbt._xp_board('00000000-0000-0000-0000-0000000000e1', 'week', 1, '2030-03-04 15:00+01') j) x), 'outside the list, my own rank still comes back');

-- Access: students use xp_board and my_progress, never the helpers.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.check(jsonb_typeof(cbt.xp_board('week', 10) -> 'rows') = 'array', 'students can read the board');
select pg_temp.check(cbt.xp_board('forever', 10) is null, 'unknown period: nothing');
create temp table mp as select cbt.my_progress() j;
select pg_temp.check((select (j -> 'xp' ->> 'total')::int = 25 * (select count(*) from cbt.user_badges where user_id = '00000000-0000-0000-0000-0000000000e1')
                             and j -> 'xp' ? 'level' and (j ->> 'quizzes')::int = 6 from mp),
  'my_progress carries XP (attempts dated 2030 are in the future, so only the badges just earned count: 25 each), level, quizzes finished');
select pg_temp.check((select count(*) >= 20 from jsonb_array_elements(cbt.my_progress() -> 'badges') b where b ? 'category'), 'badges carry a category');
do $$ begin perform cbt._xp_events(null); raise exception 'FAIL: student read everyone''s XP events';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt._xp_board('00000000-0000-0000-0000-0000000000e2', 'week', 10, now()); raise exception 'FAIL: student called _xp_board';
exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin perform cbt.xp_board('week', 10); raise exception 'FAIL: anon read the board';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin raise notice 'ALL XP AND LEVEL CHECKS PASSED'; end $$;
