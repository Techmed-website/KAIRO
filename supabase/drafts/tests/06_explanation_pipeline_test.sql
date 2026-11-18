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

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform cbt.explanation_queue(5); raise exception 'FAIL: student read the queue';
exception when insufficient_privilege then raise notice 'ok  students cannot call the pipeline functions'; end $$;
select pg_temp.check((select count(*) from cbt.key_reviews) = 0, 'students cannot read key reviews');
reset role;
\echo ALL EXPLANATION PIPELINE CHECKS PASSED
