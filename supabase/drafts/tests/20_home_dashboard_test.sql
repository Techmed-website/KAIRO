-- Behaviour tests for 20261126120000_cbt_home_dashboard.sql. Run after 19.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7', 'gbenga@example.com');
insert into cbt.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000a7', 'Gbenga Ola');

-- Three questions to answer, and a daily quiz that opens at 04:30 Lagos on 2 Jan 2030 with them.
create temp table qv as
  select row_number() over (order by v.question_id) n, v.question_id, v.version, v.correct_option
  from (select distinct on (question_id) * from cbt.question_versions order by question_id, version desc) v limit 3;
insert into cbt.assessments (id, type, title, status, opens_at, time_limit_sec, subject_id, topic_label, day_number)
values ('a7000000-0000-0000-0000-000000000001', 'daily_quiz', 'TECHMED UTME 2027 Daily Builder Quiz — Day 99: Chemistry (Gas Laws)', 'live',
        '2030-01-02 04:30+01', 300, (select id from cbt.subjects where code = 'CHM'), 'Gas Laws', 99);
insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
select 'a7000000-0000-0000-0000-000000000001', question_id, version, n from qv;

-- Before Gbenga starts: the quiz is today's, nothing of his yet.
insert into d select 'h0', cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-02 09:00+01');
select pg_temp.check((select j ->> 'id' = 'a7000000-0000-0000-0000-000000000001' and (j ->> 'is_today')::boolean
                       and (j ->> 'question_count')::int = 3 and j ->> 'subject_code' = 'CHM' and j ->> 'topic_label' = 'Gas Laws'
                       and (j ->> 'day_number')::int = 99 from d where k = 'h0'), 'today''s quiz with its subject, topic and size');
select pg_temp.check((select j -> 'result' = 'null'::jsonb and j -> 'in_progress' = 'null'::jsonb and j -> 'best' = 'null'::jsonb from d where k = 'h0'),
  'not started: no result, nothing to resume');
select pg_temp.check((cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-03 09:00+01') ->> 'is_today')::boolean = false,
  'the next day, before a new quiz is built, it is no longer today''s');
select pg_temp.check((cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-02 04:00+01') ->> 'id') is distinct from 'a7000000-0000-0000-0000-000000000001',
  'a quiz that has not opened yet is never shown');

-- He starts: in progress, with time left.
insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, deadline_at, status) values
  ('a7100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'a7000000-0000-0000-0000-000000000001', 'online',
   '2030-01-02 08:58+01', '2030-01-02 09:03+01', 'in_progress');
insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, is_correct)
select 'a7100000-0000-0000-0000-000000000001', question_id, version, null, null from qv;
update cbt.attempt_answers set selected_option = 'A' where attempt_id = 'a7100000-0000-0000-0000-000000000001'
   and question_id = (select question_id from qv where n = 1);
select pg_temp.check((select j -> 'in_progress' ->> 'attempt_id' = 'a7100000-0000-0000-0000-000000000001' and (j -> 'in_progress' ->> 'answered')::int = 1
                       from (select cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-02 09:00+01') j) x),
  'in progress: the attempt to resume, with 1 answered so far');
select pg_temp.check((cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-02 09:10+01') -> 'in_progress') = 'null'::jsonb,
  'an attempt whose time ran out is not offered for resuming');

-- He finishes: 2 of 3, all answered. Then a retry scores 3/3.
update cbt.attempts set status = 'final', submitted_at = '2030-01-02 09:02+01', server_received_at = '2030-01-02 09:02+01', score = 2, total = 3
 where id = 'a7100000-0000-0000-0000-000000000001';
update cbt.attempt_answers aa set selected_option = qv.correct_option, is_correct = qv.n <> 1 from qv
 where aa.attempt_id = 'a7100000-0000-0000-0000-000000000001' and aa.question_id = qv.question_id;
insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status, score, total) values
  ('a7100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a7', 'a7000000-0000-0000-0000-000000000001', 'online',
   '2030-01-02 10:00+01', '2030-01-02 10:03+01', '2030-01-02 10:03+01', 'final', 3, 3);
insert into d select 'h1', cbt._home_today('00000000-0000-0000-0000-0000000000a7', '2030-01-02 11:00+01');
select pg_temp.check((select j -> 'result' ->> 'attempt_id' = 'a7100000-0000-0000-0000-000000000001' and (j -> 'result' ->> 'score')::int = 2
                       and (j -> 'result' ->> 'total')::int = 3 and (j -> 'result' ->> 'answered')::int = 3 from d where k = 'h1'),
  'completed: the first finished attempt (the one that counts) with score and answered count');
select pg_temp.check((select (j ->> 'best')::int = 3 from d where k = 'h1'), 'best over all attempts');
select pg_temp.check((cbt._home_today('00000000-0000-0000-0000-0000000000d1', '2030-01-02 11:00+01') -> 'result') = 'null'::jsonb,
  'another student sees the quiz but not my result');

-- my_progress: lifetime correct answers next to questions answered.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
insert into d select 'p', cbt.my_progress();
select pg_temp.check((select (j ->> 'questions')::int = 3 and (j ->> 'correct')::int = 2 from d where k = 'p'), 'my_progress: 3 answered, 2 correct (accuracy from real answers)');
select pg_temp.check(jsonb_typeof(cbt.home_today()) in ('object', 'null'), 'students can call home_today()');
do $$ begin perform cbt._home_today('00000000-0000-0000-0000-0000000000a7', now()); raise exception 'FAIL: student called _home_today';
exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin perform cbt.home_today(); raise exception 'FAIL: anon called home_today';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin raise notice 'ALL HOME DASHBOARD CHECKS PASSED'; end $$;
