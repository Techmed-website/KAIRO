-- Behaviour tests for 20261119030000_cbt_explanation_pipeline.sql. Run after 05.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table eq as select cbt.explanation_queue(1000) j;

select pg_temp.check(jsonb_array_length((select j from eq)) > 0, 'queue lists questions without TECHMED explanations');
select pg_temp.check((select bool_and(e ? 'correct_option' and e ? 'options') from eq, jsonb_array_elements(j) e), 'queue items carry the key and options');
create temp table pick as select (j -> 0 ->> 'question_id')::uuid id from eq;

-- Saving needs per-option lines.
do $$ begin perform cbt.save_explanation(jsonb_build_object('question_id', (select id from pick), 'explanation', repeat('Only the answer, no options explained. ', 3), 'model', 't'));
  raise exception 'FAIL: explanation without why-not lines accepted';
exception when invalid_parameter_value then raise notice 'ok  an explanation must explain the wrong options'; end $$;

select pg_temp.check(cbt.save_explanation(jsonb_build_object('question_id', (select id from pick), 'model', 'test-model',
  'explanation', E'Concept: Example concept.\nSteps:\n1. Do it.\nWhy the other options are wrong:\nB: Because.\nC: Because.\nD: Because.\nTECHMED TIP: Remember it.')),
  'a full TECHMED explanation is saved');
select pg_temp.check((select v.explanation_html like 'Concept: Example concept.%' from cbt.questions q
                      join cbt.question_versions v on v.question_id = q.id and v.version = q.version where q.id = (select id from pick)),
  'the saved explanation reaches the live question version');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000)) e where (e ->> 'question_id')::uuid = (select id from pick)),
  'explained questions leave the queue');

-- A key that changed after the explanation was written is not overwritten with a stale explanation.
create temp table pick3 as select (j -> 2 ->> 'question_id')::uuid id, j -> 2 ->> 'correct_option' k from eq;
select pg_temp.check(not cbt.save_explanation(jsonb_build_object('question_id', (select id from pick3), 'model', 'x',
  'expected_option', case (select k from pick3) when 'A' then 'B' else 'A' end,
  'explanation', E'Concept: Written against an old key.\nWhy the other options are wrong:\nA: x')), 'a stale explanation (key changed) is refused');

-- Editors win.
update cbt.question_keys set explanation_source = 'editor' where question_id = (select id from pick);
select pg_temp.check(not cbt.save_explanation(jsonb_build_object('question_id', (select id from pick), 'model', 'x',
  'explanation', E'Concept: Overwrite attempt here.\nWhy the other options are wrong:\nA: x')), 'editor-written explanations are never overwritten');

-- Key review.
create temp table pick2 as select (j -> 1 ->> 'question_id')::uuid id from eq;
create temp table key_before as select correct_option from cbt.question_keys where question_id = (select id from pick2);
select pg_temp.check(cbt.flag_key(jsonb_build_object('question_id', (select id from pick2), 'proposed_option', 'C', 'verdict', 'disagree',
  'reasoning', 'Working shows C.', 'model', 'test-model')), 'a disputed key is flagged for an editor');
select pg_temp.check(not cbt.flag_key(jsonb_build_object('question_id', (select id from pick2), 'proposed_option', 'B', 'verdict', 'disagree',
  'reasoning', 'again', 'model', 'test-model')), 'only one open review per question');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000)) e where (e ->> 'question_id')::uuid = (select id from pick2)),
  'flagged questions wait for the editor before being explained');
select pg_temp.check((select correct_option from cbt.question_keys where question_id = (select id from pick2)) = (select correct_option from key_before),
  'flagging never changes the key students are marked against');

-- Failed attempts: two failures take a question out of the queue; the failed-retry pass brings it back; success clears it.
create temp table pick4 as select (j -> 3 ->> 'question_id')::uuid id from eq;
select cbt.record_try(jsonb_build_object('question_id', (select id from pick4), 'ok', false, 'reason', 'weak why-not', 'provider', 'gemini', 'model', 'm'));
select pg_temp.check(exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000)) e where (e ->> 'question_id')::uuid = (select id from pick4)),
  'one failure: the question stays in the queue');
select cbt.record_try(jsonb_build_object('question_id', (select id from pick4), 'ok', false, 'reason', 'weak why-not', 'provider', 'gemini', 'model', 'm'));
select pg_temp.check(not exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000)) e where (e ->> 'question_id')::uuid = (select id from pick4)),
  'two failures: the question leaves the queue');
select pg_temp.check(exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000, null, true)) e where (e ->> 'question_id')::uuid = (select id from pick4)),
  'the failed-retry pass includes it again');
select cbt.record_try(jsonb_build_object('question_id', (select id from pick4), 'ok', true));
select pg_temp.check((select count(*) from cbt.explanation_tries where question_id = (select id from pick4)) = 0, 'a success clears the failure count');

-- Editors resolve flagged keys. Review pick2 (flagged above, proposed C): accept → new key + new version + explanation cleared.
select pg_temp.check((select count(*) from cbt.key_reviews where question_id = (select id from pick2) and status = 'open') = 1, 'a flagged review is open');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform cbt.resolve_key_review((select id from cbt.key_reviews limit 1), true); raise exception 'FAIL: student resolved a review';
exception when insufficient_privilege then raise notice 'ok  students cannot resolve key reviews'; end $$;
reset role;
-- Make user ...0a... not staff; use the stub staff user from test 01 if present, else promote a profile for the check.
update cbt.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
reset role;
create temp table rv as select id from cbt.key_reviews where question_id = (select id from pick2);
grant all on rv to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(cbt.resolve_key_review((select id from rv), true) = 'key changed to C', 'an editor accepts the proposed key');
reset role;
select pg_temp.check((select correct_option = 'C' and key_source = 'editor' and explanation is null and explanation_source = 'source'
                      from cbt.question_keys where question_id = (select id from pick2)), 'accepting changes the key, marks it editor-confirmed and clears the old explanation');
select pg_temp.check((select version from cbt.questions where id = (select id from pick2)) >= 2, 'the key change created a new question version');
select pg_temp.check(exists (select 1 from jsonb_array_elements(cbt.explanation_queue(1000)) e where (e ->> 'question_id')::uuid = (select id from pick2) and e ->> 'key_source' = 'editor'),
  'the question is back in the queue, to be explained for the new key');

-- Rejecting confirms the stored key.
create temp table pick5 as select (j -> 4 ->> 'question_id')::uuid id, j -> 4 ->> 'correct_option' k from eq;
select cbt.flag_key(jsonb_build_object('question_id', (select id from pick5), 'proposed_option', null, 'verdict', 'ambiguous', 'reasoning', 'unclear wording', 'model', 'm'));
create temp table rv2 as select id from cbt.key_reviews where question_id = (select id from pick5) and status = 'open';
grant all on rv2 to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(cbt.resolve_key_review((select id from rv2), false) = 'key confirmed', 'an editor can confirm the stored key');
reset role;
select pg_temp.check((select key_source = 'editor' and correct_option = (select k from pick5) from cbt.question_keys where question_id = (select id from pick5)),
  'confirming keeps the key and marks it editor-confirmed');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform cbt.explanation_queue(5, null, false); raise exception 'FAIL: student read the queue';
exception when insufficient_privilege then raise notice 'ok  students cannot call the pipeline functions'; end $$;
select pg_temp.check((select count(*) from cbt.key_reviews) = 0, 'students cannot read key reviews');
reset role;
\echo ALL EXPLANATION PIPELINE CHECKS PASSED
