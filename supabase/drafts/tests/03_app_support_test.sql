-- Behaviour tests for 20261119000000_cbt_app_support.sql (retry from mistakes, richer review). Run after 02.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table rr (j jsonb);
grant all on rr to authenticated;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
-- CHM 2011 paper (keys are all A): answer A, B, blank -> one wrong, one blank.
insert into rr select cbt.create_practice('{"mode":"year","subject":"CHM","year":2011}');
select cbt.start_attempt('60000000-0000-0000-0000-000000000001', (select (j ->> 'assessment_id')::uuid from rr));
select cbt.submit_attempt(jsonb_build_object('id', '60000000-0000-0000-0000-000000000001',
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id',
                'selected', case (q ->> 'position')::int when 1 then 'A' when 2 then 'B' end))
              from rr, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q)));

select pg_temp.check((select (i ->> 'subject') = 'CHM' and (i ->> 'year')::int = 2011 and i ? 'topic_id' and i ? 'media_url'
                      from jsonb_array_elements(cbt.get_review('60000000-0000-0000-0000-000000000001') -> 'items') i limit 1),
  'review items carry subject, year, topic and diagram');

truncate rr;
insert into rr select cbt.create_retry('{"attempt_id":"60000000-0000-0000-0000-000000000001"}');
select pg_temp.check((select (j ->> 'question_count')::int from rr) = 1, 'retry holds only the wrong answer (not the blank or the correct one)');
select pg_temp.check((select j ->> 'title' from rr) like 'Retry: %', 'retry is titled after the original');
select pg_temp.check((select (cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'assessment' ->> 'answers_visibility') from rr) = 'per_question',
  'retry defaults to instant feedback');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  perform cbt.create_retry('{"attempt_id":"60000000-0000-0000-0000-000000000001"}');
  raise exception 'FAIL: another student retried Ada''s attempt';
exception when no_data_found then raise notice 'ok  other students cannot retry someone else''s attempt';
end $$;
reset role;
\echo ALL APP SUPPORT CHECKS PASSED
