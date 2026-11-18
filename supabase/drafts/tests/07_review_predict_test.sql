-- Behaviour tests for 20261119050000_cbt_review_and_predict.sql. Run after 06.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
-- A fresh student, so earlier test files don't interfere.
insert into auth.users values ('00000000-0000-0000-0000-00000000000d', 'dayo@example.com') on conflict do nothing;
create temp table rv (j jsonb); grant all on rv to authenticated;
create function pg_temp.sit_answers(p_attempt uuid, p_req jsonb, p_pattern text) returns void language plpgsql as $$
declare a uuid;
begin
  a := (cbt.create_practice(p_req) ->> 'assessment_id')::uuid;
  perform cbt.start_attempt(p_attempt, a);
  -- p_pattern: one letter per question in position order ('A' right, 'B' wrong, '-' blank)
  perform cbt.submit_attempt(jsonb_build_object('id', p_attempt, 'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id',
    'selected', nullif(substr(p_pattern, (q ->> 'position')::int, 1), '-'))) from jsonb_array_elements(cbt.get_paper(a) -> 'questions') q)));
end $$;
grant execute on function pg_temp.sit_answers(uuid, jsonb, text) to authenticated;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
-- CHM 2013 has 10 questions keyed A (test 05). Get 3 wrong, 1 blank.
select pg_temp.sit_answers('90000000-0000-0000-0000-000000000001', '{"mode":"year","subject":"CHM","year":2013,"feedback":"end"}', 'BBBA-AAAAA');
select pg_temp.check((cbt.review_due() ->> 'due')::int = 0 and (cbt.review_due() ->> 'upcoming')::int = 3, 'missed questions wait 1 day before review (blank ones are not reviews)');

-- Pretend a day has passed.
reset role;
update cbt.attempts set submitted_at = now() - interval '25 hours', server_received_at = now() - interval '25 hours' where id = '90000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((cbt.review_due() ->> 'due')::int = 3, 'after a day, the 3 missed questions are due');
select pg_temp.check((cbt.review_due() -> 'by_subject' -> 0 ->> 'code') = 'CHM', 'due counts are grouped by subject');
insert into rv select cbt.create_review('{}');
select pg_temp.check((select (j ->> 'question_count')::int from rv) = 3, 'a review session holds the due questions');
select pg_temp.check((select (cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'assessment' ->> 'answers_visibility') from rv) = 'per_question', 'review gives instant feedback');

-- Answer them right in the review: they come back after 3 days, not now.
select cbt.start_attempt('90000000-0000-0000-0000-000000000002', (select (j ->> 'assessment_id')::uuid from rv));
select cbt.submit_attempt(jsonb_build_object('id', '90000000-0000-0000-0000-000000000002', 'answers',
  (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', 'A')) from rv, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q)));
select pg_temp.check((cbt.review_due() ->> 'due')::int = 0 and (cbt.review_due() ->> 'upcoming')::int = 3, 'answered right once: back in 3 days');
do $$ begin perform cbt.create_review('{}'); raise exception 'FAIL: empty review created';
exception when no_data_found then raise notice 'ok  nothing due: no empty review session'; end $$;

-- Three rights in a row: learnt.
reset role;
update cbt.attempts set submitted_at = now() - interval '40 days', server_received_at = now() - interval '40 days' where id = '90000000-0000-0000-0000-000000000001';
update cbt.attempts set submitted_at = now() - interval '30 days', server_received_at = now() - interval '30 days' where id = '90000000-0000-0000-0000-000000000002';
insert into cbt.attempts (id, user_id, assessment_id, origin, status, started_at, submitted_at, server_received_at)
select g, '00000000-0000-0000-0000-00000000000d', (select (j ->> 'assessment_id')::uuid from rv), 'online', 'final', now() - interval '20 days' + (n || ' days')::interval,
       now() - interval '20 days' + (n || ' days')::interval, now() - interval '20 days' + (n || ' days')::interval
from (values ('90000000-0000-0000-0000-000000000003'::uuid, 1), ('90000000-0000-0000-0000-000000000004'::uuid, 2)) v(g, n);
insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, is_correct)
select a.id, aa.question_id, aa.question_version, 'A', true
from cbt.attempt_answers aa cross join (values ('90000000-0000-0000-0000-000000000003'::uuid), ('90000000-0000-0000-0000-000000000004'::uuid)) a(id)
where aa.attempt_id = '90000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((cbt.review_due() ->> 'due')::int = 0 and (cbt.review_due() ->> 'upcoming')::int = 0, 'right three times in a row: learnt, leaves review');

-- Prediction input: mocks scored /400 with each subject /100.
select pg_temp.sit_answers('90000000-0000-0000-0000-000000000005', '{"mode":"mock","subjects":["MTH","CHM","BIO"]}', repeat('A', 300));
select pg_temp.check((select (m ->> 'total')::int = (select sum(v::int) from jsonb_each_text(m -> 'subjects') s(k, v))
                       and (select count(*) from jsonb_object_keys(m -> 'subjects')) = 4
                      from jsonb_array_elements(cbt.my_mock_scores()) m limit 1), 'mock scores: each subject /100, total is their sum (/400)');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(not exists (select 1 from jsonb_array_elements(cbt.my_mock_scores()) m where m ->> 'attempt_id' = '90000000-0000-0000-0000-000000000005'),
  'mock scores are private to each student');
reset role;
\echo ALL REVIEW AND PREDICTION CHECKS PASSED
