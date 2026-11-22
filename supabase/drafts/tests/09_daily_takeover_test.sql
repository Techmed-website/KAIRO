-- Behaviour tests for 20261119070000_cbt_daily_quiz_takeover.sql. Run after 08.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
update cbt.assessments set status = 'archived' where type = 'daily_quiz';  -- start clean of earlier tests' daily quizzes
create temp table d (k text, j jsonb);
grant all on d to authenticated;
create function pg_temp.quiz(p_date date, p_replace boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('date', p_date, 'title', 'TECHMED Daily Builder Quiz — Day 10: Mathematics (Indices)', 'replace', p_replace,
    'questions', (select jsonb_agg(jsonb_build_object('subject', 'MTH', 'stem', 'Simplify 2^' || i || ' × 2^2',
       'options', jsonb_build_array('2^' || (i + 2), '4^' || i, '2^' || (2 * i), '8'), 'correct', 'A',
       'explanation', 'Same base: add the indices, so 2^' || i || ' × 2^2 = 2^' || (i + 2) || '.')) from generate_series(1, 10) i)) $$;

-- Published as the database owner (the scheduled task) for a date already open: live at once.
insert into d select 'pub', cbt.publish_daily_quiz(pg_temp.quiz(current_date - 1));
select pg_temp.check((select (j ->> 'question_count')::int = 10 and j ->> 'url' like 'https://kairo.techmedng.com/q/%' from d where k = 'pub'), 'publishes 10 questions and returns the KAIRO link');
select pg_temp.check((select status = 'live' and time_limit_sec = 600 and not ranked and answers_visibility = 'after_submit'
                      from cbt.assessments where id = (select (j ->> 'assessment_id')::uuid from d where k = 'pub')), 'opened day: live, 10 minutes, answers after submitting');
select pg_temp.check((select count(*) = 10 from cbt.questions q join cbt.question_keys k on k.question_id = q.id
                      where q.source = 'techmed' and q.status = 'published' and k.key_source = 'editor' and k.explanation like 'Same base%'), 'questions join the bank with TECHMED keys and explanations');
-- A future date waits for the 06:00 WAT cron.
insert into d select 'fut', cbt.publish_daily_quiz(pg_temp.quiz(current_date + 3));
select pg_temp.check((select status = 'scheduled' and (opens_at at time zone 'Africa/Lagos')::time = '06:00' from cbt.assessments
                      where id = (select (j ->> 'assessment_id')::uuid from d where k = 'fut')), 'future quiz is scheduled for 06:00 WAT');

-- Validation: nothing is written for a bad question.
do $$ begin perform cbt.publish_daily_quiz(jsonb_set(pg_temp.quiz(current_date + 5), '{questions,3,correct}', '"E"'));
  raise exception 'FAIL: a key outside the options was accepted';
exception when invalid_parameter_value then raise notice 'ok  rejects a key that is not one of the options'; end $$;
select pg_temp.check(not exists (select 1 from cbt.assessments where type = 'daily_quiz' and (opens_at at time zone 'Africa/Lagos')::date = current_date + 5), 'a rejected quiz leaves nothing behind');
do $$ begin perform cbt.publish_daily_quiz(pg_temp.quiz(current_date - 1)); raise exception 'FAIL: second quiz for one day';
exception when unique_violation then raise notice 'ok  one daily quiz per day'; end $$;

-- A student sits it: the paper carries no keys; leaderboard via paper_board.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select j ->> 'title' like '%Day 10%' from (select cbt.todays_quiz() j) x), 'todays_quiz returns it');
insert into d select 'paper', cbt.get_paper((select (j ->> 'assessment_id')::uuid from d where k = 'pub'));
select pg_temp.check((select bool_and(q -> 'correct_option' is null) from d, jsonb_array_elements(j -> 'questions') q where k = 'paper'), 'the daily paper carries no keys');
select cbt.start_attempt('c0000000-0000-0000-0000-000000000001', (select (j ->> 'assessment_id')::uuid from d where k = 'pub'));
select cbt.submit_attempt(jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000001', 'duration_sec', 200,
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', 'A')) from d, jsonb_array_elements(j -> 'questions') q where k = 'paper')));
select pg_temp.check((cbt.paper_board('c0000000-0000-0000-0000-000000000001') ->> 'scope') = 'assessment', 'the daily quiz has its own leaderboard');
select pg_temp.check((select (x -> 0 ->> 'my_best')::int = 10 and (x -> 0 ->> 'players')::int = 1 and jsonb_array_length(x) = 1 from (select cbt.daily_quizzes() x) y),
  'daily_quizzes lists opened quizzes only, with my best score');
do $$ begin perform cbt.publish_daily_quiz(pg_temp.quiz(current_date + 6)); raise exception 'FAIL: student published a quiz';
exception when insufficient_privilege then raise notice 'ok  students cannot publish'; end $$;
reset role;
do $$ begin perform cbt.publish_daily_quiz(pg_temp.quiz(current_date - 1, true)); raise exception 'FAIL: replaced an attempted quiz';
exception when unique_violation then raise notice 'ok  an attempted quiz cannot be replaced'; end $$;
insert into d select 'rep', cbt.publish_daily_quiz(pg_temp.quiz(current_date + 3, true));
select pg_temp.check((select status = 'archived' from cbt.assessments where id = (select (j ->> 'assessment_id')::uuid from d where k = 'fut')), 'replace=true swaps an unattempted quiz');
\echo ALL DAILY TAKEOVER CHECKS PASSED
