-- Behaviour tests for 20261122100000/100100 (challenge type, public quizzes, guests, passcodes, autosave). Run after 09.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to authenticated, anon;
-- Fresh actors: Cee Dee (student), Dayo (second student), a guest, and the editor already created by test 01.
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'cee@example.com'), ('00000000-0000-0000-0000-0000000000d1', 'dayo@example.com'),
                              ('00000000-0000-0000-0000-0000000000a9', null);
insert into cbt.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000c1', 'Cee Dee'), ('00000000-0000-0000-0000-0000000000d1', 'Dayo');
-- A challenge (new type), ranked, 5 minutes, guests welcome, with a slug; a guest-closed twin; a passcode quiz.
insert into cbt.assessments (id, type, title, slug, time_limit_sec, ranked, answers_visibility, status, opens_at, guests_allowed, day_number, prize_text, featured) values
 ('50000000-0000-0000-0000-000000000001', 'challenge', 'Open Challenge', 'open-challenge', 300, true, 'after_submit', 'live', now() - interval '1 hour', true, 12, '₦5,000 airtime', true),
 ('50000000-0000-0000-0000-000000000002', 'topic_test', 'Members Only', 'members-only', 300, true, 'after_submit', 'live', now() - interval '1 hour', false, null, null, false),
 ('50000000-0000-0000-0000-000000000003', 'challenge', 'Private Challenge', 'private-challenge', 300, true, 'after_submit', 'live', now() - interval '1 hour', false, null, null, false),
 ('50000000-0000-0000-0000-000000000004', 'topic_test', 'One Shot', 'one-shot', 300, true, 'after_submit', 'live', now() - interval '1 hour', false, null, null, false);
update cbt.assessments set attempts_allowed = 1 where id = '50000000-0000-0000-0000-000000000004';
insert into cbt.assessment_questions
select a, q, 1, row_number() over (partition by a order by q)
from (values ('50000000-0000-0000-0000-000000000001'::uuid), ('50000000-0000-0000-0000-000000000002'), ('50000000-0000-0000-0000-000000000003'), ('50000000-0000-0000-0000-000000000004')) x(a),
     (values ('10000000-0000-0000-0000-000000000001'::uuid), ('10000000-0000-0000-0000-000000000002')) y(q);

-- The slug must be a clean web address.
do $$ begin update cbt.assessments set slug = 'Bad Slug!' where id = '50000000-0000-0000-0000-000000000002'; raise exception 'FAIL: bad slug accepted';
exception when check_violation then raise notice 'ok  slug must be lowercase-hyphenated'; end $$;
do $$ begin update cbt.assessments set slug = 'open-challenge' where id = '50000000-0000-0000-0000-000000000002'; raise exception 'FAIL: duplicate slug accepted';
exception when unique_violation then raise notice 'ok  slug is unique'; end $$;

-- ── The public website (anon): cards without answers, initials only ──
set role anon;
select pg_temp.check((select count(*) = 4 from jsonb_array_elements(cbt.public_quizzes())), 'anon sees every slugged live quiz');
select pg_temp.check((cbt.public_quizzes() -> 0 ->> 'slug') = 'open-challenge', 'featured quiz comes first');
select pg_temp.check((select not (c ? 'passcode_hash') and not (c ? 'correct_option') and not (c ? 'created_by') from jsonb_array_elements(cbt.public_quizzes()) c limit 1), 'cards carry no secrets');
select pg_temp.check((cbt.public_quiz('open-challenge') ->> 'prize_text') = '₦5,000 airtime' and (cbt.public_quiz('open-challenge') ->> 'question_count')::int = 2, 'one quiz by slug, with prize and question count');
select pg_temp.check(cbt.public_quiz('nope') is null, 'unknown slug returns nothing');
do $$ begin perform cbt.start_attempt(gen_random_uuid(), '50000000-0000-0000-0000-000000000001'); raise exception 'FAIL: signed-out start';
exception when others then raise notice 'ok  starting needs a session (anon: %)', sqlstate; end $$;
do $$ begin perform count(*) from cbt.assessment_secrets; raise exception 'FAIL: anon read passcode hashes';
exception when insufficient_privilege then raise notice 'ok  anon cannot read passcode hashes'; end $$;
reset role;

-- ── Staff set a passcode; students cannot ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform cbt.set_passcode('50000000-0000-0000-0000-000000000003', 'GOLD'); raise exception 'FAIL: student set a passcode';
exception when insufficient_privilege then raise notice 'ok  students cannot set passcodes'; end $$;
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';
select cbt.set_passcode('50000000-0000-0000-0000-000000000003', 'GOLD');
reset role;
select pg_temp.check((select count(*) = 1 from cbt.audit_log where action = 'passcode_set'), 'setting a passcode is audited');
select pg_temp.check((select passcode_hash <> 'GOLD' and passcode_hash like '$2%' from cbt.assessment_secrets), 'passcode is stored hashed');

-- ── Cee: passcode gate, first attempt ranks, retakes do not, autosave, resume ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform count(*) from cbt.assessment_secrets; raise exception 'FAIL: student read passcode hashes';
exception when insufficient_privilege then raise notice 'ok  students cannot read passcode hashes'; end $$;
select pg_temp.check((select (c ->> 'has_passcode')::boolean from jsonb_array_elements(cbt.public_quizzes()) c where c ->> 'slug' = 'private-challenge'), 'the website can tell a quiz is private');
do $$ begin perform cbt.get_paper('50000000-0000-0000-0000-000000000003'); raise exception 'FAIL: paper before passcode';
exception when insufficient_privilege then raise notice 'ok  passcode quiz hands out no questions before the code'; end $$;
do $$ begin perform cbt.start_attempt('c1000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000003', null, 'WRONG'); raise exception 'FAIL: wrong passcode';
exception when sqlstate '28P01' then raise notice 'ok  wrong passcode refused'; end $$;
do $$ begin perform cbt.start_attempt('c1000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000003'); raise exception 'FAIL: missing passcode';
exception when sqlstate '28P01' then raise notice 'ok  missing passcode refused'; end $$;
select pg_temp.check((cbt.start_attempt('c1000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000003', null, 'GOLD') -> 'attempt' ->> 'id') is not null, 'right passcode starts the attempt');
select pg_temp.check((cbt.start_attempt('c1000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000003') ->> 'resumed')::boolean, 'a resume needs no passcode again');

insert into d select 's1', cbt.start_attempt('c1000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
select pg_temp.check((j -> 'attempt' ->> 'counts_for_rank')::boolean and not (j ->> 'resumed')::boolean and jsonb_array_length(j -> 'answers') = 0, 'first attempt counts for rank, nothing saved yet') from d where k = 's1';
select pg_temp.check(not exists (select 1 from jsonb_array_elements(cbt.get_paper('50000000-0000-0000-0000-000000000001') -> 'questions') q where q ? 'correct_option' or q ? 'explanation_html'), 'the paper never carries keys or explanations');
select cbt.save_answers('c1000000-0000-0000-0000-000000000001', '[{"question_id":"10000000-0000-0000-0000-000000000001","selected":"a","time_ms":4000}]');
-- New phone: a different attempt id resumes the same attempt and returns what was saved (no keys).
insert into d select 's1b', cbt.start_attempt('c1000000-0000-0000-0000-0000000000ff', '50000000-0000-0000-0000-000000000001');
select pg_temp.check((j ->> 'resumed')::boolean and (j -> 'attempt' ->> 'id') = 'c1000000-0000-0000-0000-000000000001' and (j -> 'answers' -> 0 ->> 'selected') = 'A' and not (j -> 'answers' -> 0 ? 'is_correct'), 'resume on another device: same attempt, saved answers, no keys') from d where k = 's1b';
select pg_temp.check((select is_correct is null from cbt.attempt_answers where attempt_id = 'c1000000-0000-0000-0000-000000000001'), 'autosaved answers are not marked until submit');
do $$ begin perform cbt.save_answers('c1000000-0000-0000-0000-000000000001', '[{"question_id":"10000000-0000-0000-0000-000000000001","selected":"B"}]') ; perform cbt.save_answers('00000000-0000-0000-0000-00000000dead', '[]');
  raise exception 'FAIL: saved to an unknown attempt'; exception when others then if sqlstate <> 'P0002' then raise; end if; raise notice 'ok  cannot save to an attempt that is not yours'; end $$;
select pg_temp.check((cbt.submit_attempt('{"id":"c1000000-0000-0000-0000-000000000001","duration_sec":90,"answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","selected":"A"},{"question_id":"10000000-0000-0000-0000-000000000002","selected":"C"}]}') ->> 'score')::int = 2, 'submit scores on the server: 2/2');
select pg_temp.check((cbt.get_review('c1000000-0000-0000-0000-000000000001') -> 'items' -> 0 ? 'correct_option'), 'answers and explanations arrive only after submitting');
select pg_temp.check((cbt.submit_attempt('{"id":"c1000000-0000-0000-0000-000000000001","answers":[]}') ->> 'already_received')::boolean, 'double submit is idempotent');
do $$ begin perform cbt.save_answers('c1000000-0000-0000-0000-000000000001', '[]'); raise exception 'FAIL: saved after submit';
exception when sqlstate 'P0001' then raise notice 'ok  no saving after submitting'; end $$;
-- Retake: allowed (unlimited), but it does not rank.
insert into d select 's2', cbt.start_attempt('c1000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
select pg_temp.check(not (j -> 'attempt' ->> 'counts_for_rank')::boolean and not (j ->> 'resumed')::boolean, 'a retake is allowed but does not count for rank') from d where k = 's2';
select cbt.submit_attempt('{"id":"c1000000-0000-0000-0000-000000000002","duration_sec":10,"answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","selected":"A"},{"question_id":"10000000-0000-0000-0000-000000000002","selected":"C"}]}');
-- A quiz with attempts_allowed = 1 stops the second try.
select cbt.start_attempt('c1000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000004');
select cbt.submit_attempt('{"id":"c1000000-0000-0000-0000-000000000004","answers":[]}');
do $$ begin perform cbt.start_attempt('c1000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004'); raise exception 'FAIL: second attempt on a one-shot quiz';
exception when unique_violation then raise notice 'ok  attempts_allowed still caps attempts'; end $$;

-- ── Late submissions and saves ──
insert into d select 's3', cbt.start_attempt('c1000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002');
reset role;
update cbt.attempts set deadline_at = now() - interval '1 minute' where id = 'c1000000-0000-0000-0000-000000000003';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform cbt.save_answers('c1000000-0000-0000-0000-000000000003', '[]'); raise exception 'FAIL: saved after the deadline';
exception when sqlstate 'P0001' then raise notice 'ok  autosave stops at the deadline'; end $$;
reset role;
update cbt.attempts set deadline_at = now() - interval '11 minutes' where id = 'c1000000-0000-0000-0000-000000000003';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check((cbt.submit_attempt('{"id":"c1000000-0000-0000-0000-000000000003","answers":[{"question_id":"10000000-0000-0000-0000-000000000001","selected":"A"}]}') ->> 'reject_reason') = 'submitted_after_deadline', 'submitting after deadline + grace is rejected');
select pg_temp.check((select status = 'rejected' and not counts_for_rank from cbt.attempts where id = 'c1000000-0000-0000-0000-000000000003'), 'a late attempt never ranks');
-- An unfinished attempt past its deadline is not resumed: a fresh one starts.
select pg_temp.check(not (cbt.start_attempt('c1000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000002') ->> 'resumed')::boolean, 'an expired attempt is not resumed');

-- ── Privacy: Dayo cannot see Cee ──
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check((select count(*) = 0 from cbt.attempts where user_id = '00000000-0000-0000-0000-0000000000c1'), 'a student cannot read another student''s attempts');
select pg_temp.check((select count(*) = 0 from cbt.question_keys), 'a student cannot read answer keys');
do $$ begin perform cbt.get_review('c1000000-0000-0000-0000-000000000001'); raise exception 'FAIL: read someone else''s review';
exception when sqlstate 'P0002' then raise notice 'ok  a student cannot open another student''s review'; end $$;

-- ── Guests: sign-in quizzes refuse them; open ones keep the attempt but not the rank until an account exists ──
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a9'; set request.jwt.claim.is_anonymous = 'true';
do $$ begin perform cbt.start_attempt('a9000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000002'); raise exception 'FAIL: guest entered a members-only quiz';
exception when sqlstate '28000' then raise notice 'ok  guests are refused on sign-in-only quizzes'; end $$;
insert into d select 'g1', cbt.start_attempt('a9000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
select pg_temp.check(not (j -> 'attempt' ->> 'counts_for_rank')::boolean, 'a guest attempt does not rank yet') from d where k = 'g1';
select cbt.submit_attempt('{"id":"a9000000-0000-0000-0000-000000000001","duration_sec":50,"answers":[
  {"question_id":"10000000-0000-0000-0000-000000000001","selected":"A"},{"question_id":"10000000-0000-0000-0000-000000000002","selected":"C"}]}');
do $$ begin perform cbt.claim_guest_rank('a9000000-0000-0000-0000-000000000001'); raise exception 'FAIL: guest claimed rank';
exception when sqlstate '28000' then raise notice 'ok  a guest cannot claim rank until they have an account'; end $$;
reset role; set role anon;
select pg_temp.check((select count(*) = 1 from cbt.public_leaderboard('50000000-0000-0000-0000-000000000001')), 'the guest is not on the public board');
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a9'; set request.jwt.claim.is_anonymous = 'false';
-- (same user id, now with an account: Supabase flips is_anonymous when the guest links an email or Google identity)
select pg_temp.check((cbt.claim_guest_rank('a9000000-0000-0000-0000-000000000001') ->> 'counts_for_rank')::boolean, 'after creating an account the guest keeps their rank');
select pg_temp.check((cbt.claim_guest_rank('a9000000-0000-0000-0000-000000000001') ->> 'counts_for_rank')::boolean, 'claiming twice is harmless');
reset request.jwt.claim.is_anonymous;

-- ── The public board: ranks first attempts only, fastest wins ties, initials only ──
reset role;  -- timed quizzes measure time on the server, which is ~0 s in a test: give the two first attempts real times
update cbt.attempts set duration_sec = 90 where id = 'c1000000-0000-0000-0000-000000000001';
update cbt.attempts set duration_sec = 50 where id = 'a9000000-0000-0000-0000-000000000001';
set role anon;
create temp table lb as select * from cbt.public_leaderboard('50000000-0000-0000-0000-000000000001');
grant select on lb to anon;
select pg_temp.check((select count(*) = 2 from lb), 'board lists Cee''s first attempt (not the retake) and the claimed guest');
select pg_temp.check((select initials = 'C.D.' from lb where rank = 2), 'initials only: Cee Dee shows as C.D.');
select pg_temp.check((select rank = 1 and score = 2 and duration_sec = 50 from lb order by rank limit 1), 'same score, faster time ranks first');
select pg_temp.check((select initials from lb where rank = 1) = 'Builder', 'a guest with no name shows as Builder');
select pg_temp.check((select count(*) = 0 from cbt.public_leaderboard('50000000-0000-0000-0000-000000000009')), 'unknown quiz: empty board');
reset role;

-- ── The challenge type exists, and the migration kept the old behaviour for ordinary ranked quizzes ──
select pg_temp.check(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'assessment_type' and e.enumlabel = 'challenge'), 'assessment_type has challenge');
select pg_temp.check(to_regprocedure('cbt.start_attempt(uuid, uuid, text)') is null and to_regprocedure('cbt.start_attempt(uuid, uuid, text, text)') is not null, 'one start_attempt only (no ambiguous overloads)');
do $$ begin raise notice 'ALL BATCH 2 CHECKS PASSED'; end $$;
