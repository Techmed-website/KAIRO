-- Behaviour tests for the cbt draft. Run with: supabase/drafts/tests/run.sh
-- Every check raises an exception on failure, so the run stops (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ── Fixtures (as superuser) ──
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bola@example.com'),
  ('00000000-0000-0000-0000-0000000000ed', 'editor@example.com');
insert into cbt.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada Obi', 'student'),
  ('00000000-0000-0000-0000-00000000000b', 'Bola Ade', 'student'),
  ('00000000-0000-0000-0000-0000000000ed', 'Edi Tor', 'editor');
insert into cbt.subjects (code, name) values ('PHY', 'Physics') on conflict (code) do nothing;
insert into cbt.topics (subject_id, name) select id, 'Test topic' from cbt.subjects where code = 'PHY';
create temp table fx as select s.id subject_id, t.id topic_id from cbt.subjects s join cbt.topics t on t.subject_id = s.id and t.name = 'Test topic';
grant select on fx to authenticated, anon;

-- Two questions: insert as draft with keys, then publish (snapshot trigger fires).
insert into cbt.questions (id, subject_id, topic_id, stem, options, content_hash) select * from (values
 ('10000000-0000-0000-0000-000000000001'::uuid, (select subject_id from fx), (select topic_id from fx),
  'SI unit of force?', '[{"key":"A","text":"N"},{"key":"B","text":"J"},{"key":"C","text":"W"},{"key":"D","text":"Pa"}]'::jsonb, 'h1'),
 ('10000000-0000-0000-0000-000000000002'::uuid, (select subject_id from fx), (select topic_id from fx), 'SI unit of power?',
  '[{"key":"A","text":"N"},{"key":"B","text":"J"},{"key":"C","text":"W"},{"key":"D","text":"Pa"}]'::jsonb, 'h2')) v;
insert into cbt.passages (id, source_ref, html) values
 ('40000000-0000-0000-0000-000000000001', 'ref:2', '<p>Read the passage...</p>');
insert into cbt.questions (id, subject_id, topic_id, stem, options, content_hash, passage_id) values
 ('10000000-0000-0000-0000-000000000003', (select subject_id from fx), (select topic_id from fx), '1980 five-option question?',
  '[{"key":"A","html":"1"},{"key":"B","html":"2"},{"key":"C","html":"3"},{"key":"D","html":"4"},{"key":"E","html":"5"}]', 'h3',
  '40000000-0000-0000-0000-000000000001');
insert into cbt.question_keys (question_id, correct_option, explanation) values
 ('10000000-0000-0000-0000-000000000001', 'A', 'Newton.'),
 ('10000000-0000-0000-0000-000000000002', 'C', 'Watt.'),
 ('10000000-0000-0000-0000-000000000003', 'E', 'Five.');
update cbt.questions set status = 'published';

-- A ranked, timed assessment (the weekly drill's rules; typed daily_quiz so todays_quiz finds it) and an offline practice pack.
insert into cbt.assessments (id, type, title, time_limit_sec, opens_at, closes_at, attempts_allowed,
                             answers_visibility, ranked, status) values
 ('20000000-0000-0000-0000-00000000000d', 'daily_quiz', 'Daily', 600, now() - interval '1 hour',
  now() + interval '10 hours', 1, 'after_close', true, 'live');
insert into cbt.assessments (id, type, title, offline_allowed, answers_visibility, status) values
 ('20000000-0000-0000-0000-00000000000f', 'practice', 'Pack', true, 'per_question', 'live');
insert into cbt.assessment_questions
select a, q, 1, row_number() over (partition by a order by q)
from (values ('20000000-0000-0000-0000-00000000000d'::uuid), ('20000000-0000-0000-0000-00000000000f'::uuid)) x(a),
     (values ('10000000-0000-0000-0000-000000000001'::uuid), ('10000000-0000-0000-0000-000000000002'::uuid)) y(q);

create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
set client_min_messages = notice;

-- Five-option question goes into a separate practice pack (keeps the score checks above unchanged).
insert into cbt.assessments (id, type, title, offline_allowed, answers_visibility, status) values
 ('20000000-0000-0000-0000-0000000000e5', 'practice', 'Pre-2000 pack', true, 'per_question', 'live');
insert into cbt.assessment_questions values ('20000000-0000-0000-0000-0000000000e5', '10000000-0000-0000-0000-000000000003', 1, 1);

-- ── Act as student Ada ──
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select pg_temp.check((select count(*) from cbt.questions) = 0, 'students cannot SELECT the question bank');
select pg_temp.check((select count(*) from cbt.question_keys) = 0, 'students cannot SELECT answer keys');

do $$ begin
  perform cbt.get_paper('20000000-0000-0000-0000-00000000000d');
  raise exception 'FAIL: ranked paper served before start';
exception when insufficient_privilege then raise notice 'ok  ranked paper hidden until the attempt starts';
end $$;

select pg_temp.check(
  (cbt.get_paper('20000000-0000-0000-0000-00000000000f') -> 'questions' -> 0) ? 'correct_option',
  'offline practice pack carries keys');

do $$ begin
  update cbt.profiles set role = 'admin' where id = auth.uid();
  raise exception 'FAIL: student changed own role';
exception when insufficient_privilege then raise notice 'ok  student cannot promote self to admin';
end $$;

-- Start the ranked quiz, then confirm the paper has no keys.
select cbt.start_attempt('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000d');
select pg_temp.check(
  not ((cbt.get_paper('20000000-0000-0000-0000-00000000000d') -> 'questions' -> 0) ? 'correct_option'),
  'ranked paper has no keys after start');
select pg_temp.check(
  (cbt.start_attempt('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000d') ->> 'resumed')::boolean,
  'start_attempt again resumes (timer not reset)');

-- Submit with one right, one wrong. Client claims both correct; the server ignores that.
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000001","answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","version":1,"selected":"A","is_correct":true},
  {"question_id":"10000000-0000-0000-0000-000000000002","version":1,"selected":"B","is_correct":true}]}') ->> 'score')::int = 1,
  'server marks: score 1/2 regardless of client claims');

-- Re-send the same attempt (sync retry): no duplicate, same score.
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000001","answers":[]}') ->> 'already_received')::boolean,
  're-send returns already_received');
select pg_temp.check((select count(*) from cbt.attempts) = 1, 'still exactly one attempt row');
select pg_temp.check((select count(*) from cbt.attempt_answers) = 2, 'still exactly two answer rows');

-- A second ranked attempt with a new UUID is refused.
do $$ begin
  perform cbt.start_attempt('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000d');
  raise exception 'FAIL: second ranked attempt allowed';
exception when unique_violation then raise notice 'ok  second ranked attempt refused';
end $$;

-- Ranked quiz submitted offline without an online start: kept, but rejected for ranking.
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000003","assessment_id":"20000000-0000-0000-0000-00000000000d","origin":"offline","answers":[]}') ->> 'reject_reason') = 'must_start_online',
  'ranked attempt never started online is rejected');

-- Daily quiz review hides keys until closing time.
select pg_temp.check(not (cbt.get_review('30000000-0000-0000-0000-000000000001') ->> 'answers_revealed')::boolean,
  'daily quiz answers hidden until close');

-- Offline practice attempt syncs and updates topic stats.
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000004","assessment_id":"20000000-0000-0000-0000-00000000000f","origin":"offline","duration_sec":95,"answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","version":1,"selected":"A"},
  {"question_id":"10000000-0000-0000-0000-000000000002","version":1,"selected":"C"}]}') ->> 'score')::int = 2,
  'offline practice attempt accepted, 2/2');
select pg_temp.check((select attempted from cbt.topic_stats where user_id = auth.uid()) = 4, 'topic_stats accumulates (2 ranked + 2 practice)');

-- Five options (pre-2000 papers): answer E is accepted and marked, and the passage travels with the paper.
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-0000000000e5","assessment_id":"20000000-0000-0000-0000-0000000000e5","answers":[
  {"question_id":"10000000-0000-0000-0000-000000000003","version":1,"selected":"E"}]}') ->> 'score')::int = 1,
  'five-option question: answer E marked correct');
select pg_temp.check((cbt.get_paper('20000000-0000-0000-0000-0000000000e5') -> 'questions' -> 0 ->> 'passage_html') like '%passage%',
  'comprehension passage included in the paper');

-- Answers for questions not in the assessment are ignored.
select cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000005","assessment_id":"20000000-0000-0000-0000-00000000000f","answers":[
  {"question_id":"99999999-0000-0000-0000-000000000000","version":1,"selected":"A"}]}');
select pg_temp.check((select count(*) from cbt.attempt_answers where attempt_id = '30000000-0000-0000-0000-000000000005') = 0,
  'foreign question ids ignored');

-- ── Student Bola: cannot see Ada's attempt; leaderboard and tie-break ──
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from cbt.attempts) = 0, 'Bola cannot read Ada''s attempts');
do $$ begin
  perform cbt.submit_attempt('{"id":"30000000-0000-0000-0000-000000000001","answers":[]}');
  raise exception 'FAIL: hijacked another user''s attempt';
exception when insufficient_privilege then raise notice 'ok  cannot submit into another user''s attempt id';
end $$;
select cbt.start_attempt('30000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-00000000000d');
select cbt.submit_attempt('{"id":"30000000-0000-0000-0000-0000000000b1","answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","version":1,"selected":"A"},
  {"question_id":"10000000-0000-0000-0000-000000000002","version":1,"selected":"C"}]}');
select pg_temp.check((select rank from cbt.leaderboard('20000000-0000-0000-0000-00000000000d') where is_me) = 1, 'Bola (2/2) ranks 1st');
select pg_temp.check((select count(*) from cbt.leaderboard('20000000-0000-0000-0000-00000000000d')) = 2, 'leaderboard has 2 ranked entries (rejected one excluded)');
select pg_temp.check((select display_name from cbt.leaderboard('20000000-0000-0000-0000-00000000000d') where rank = 2) = 'Ada O.', 'names shown as first name + initial');
select pg_temp.check((select user_id from cbt.leaderboard('20000000-0000-0000-0000-00000000000d') where rank = 2) is null, 'other students'' ids not exposed');
select pg_temp.check((select rank from cbt.my_results() where assessment_type = 'daily_quiz') = 1, 'my_results reports rank for TECHMED');

-- ── Editor edits a published question: old attempts keep their version ──
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';
update cbt.question_keys set correct_option = 'B' where question_id = '10000000-0000-0000-0000-000000000002';
update cbt.questions set stem = 'SI unit of power (edited)?' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.check((select version from cbt.questions where id = '10000000-0000-0000-0000-000000000002') = 3, 'key change then wording edit create versions 2 and 3');
select pg_temp.check((select correct_option from cbt.question_versions where question_id = '10000000-0000-0000-0000-000000000002' and version = 3) = 'B', 'latest version carries the new key');
select pg_temp.check((select correct_option from cbt.question_versions where question_id = '10000000-0000-0000-0000-000000000002' and version = 1) = 'C', 'version 1 keeps original key');

-- Always-open daily quiz (v0.2 rules): no closing time, unranked, answers right after submit.
reset role;
insert into cbt.assessments (id, type, title, time_limit_sec, opens_at, answers_visibility, offline_allowed, status) values
 ('20000000-0000-0000-0000-0000000000d2', 'daily_quiz', 'Daily (always open)', 300, now() - interval '25 hours', 'after_submit', true, 'live');
update cbt.assessments set opens_at = now() - interval '5 days', closes_at = now() - interval '4 days'
 where id = '20000000-0000-0000-0000-00000000000d';
insert into cbt.assessment_questions values ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-000000000001', 1, 1);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((cbt.submit_attempt('{"id":"30000000-0000-0000-0000-0000000000d2","assessment_id":"20000000-0000-0000-0000-0000000000d2","origin":"offline","answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","version":1,"selected":"A"}]}') ->> 'status') = 'final',
  'yesterday''s always-open daily quiz can still be taken (even offline)');
select pg_temp.check((cbt.get_review('30000000-0000-0000-0000-0000000000d2') ->> 'answers_revealed')::boolean,
  'daily quiz answers revealed right after submit');

-- ── Signed-out visitor ──
reset role; set role anon; reset request.jwt.claim.sub;
select pg_temp.check((cbt.todays_quiz() ->> 'title') = 'Daily (always open)', 'todays_quiz works signed out and finds the always-open quiz');
do $$ begin
  perform cbt.get_paper('20000000-0000-0000-0000-00000000000f');
  raise exception 'FAIL: anon fetched a paper';
exception when insufficient_privilege then raise notice 'ok  anon cannot fetch papers';
end $$;

reset role;
\echo ALL CHECKS PASSED
