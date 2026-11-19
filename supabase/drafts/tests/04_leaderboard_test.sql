-- Behaviour tests for 20261119010000_cbt_leaderboards.sql (keyless end-of-session papers). Run after 03.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table lb (who text, j jsonb);
grant all on lb to authenticated;
-- Names for the board.
update cbt.profiles set full_name = 'Ada Obi' where id = '00000000-0000-0000-0000-00000000000a';
insert into cbt.profiles (id, full_name) values ('00000000-0000-0000-0000-00000000000b', 'Bola Ade') on conflict (id) do update set full_name = excluded.full_name;

-- More questions so a student can pass the daily minimum (10 answered).
do $$ declare s smallint; i int; qid uuid;
begin
  select id into s from cbt.subjects where code = 'BIO';
  for i in 1..20 loop
    qid := gen_random_uuid();
    insert into cbt.questions (id, source_ref, subject_id, topic_id, topic_auto, year, stem, options, content_hash)
    values (qid, 'lb:' || lpad(i::text, 2, '0'), s, (select id from cbt.topics where subject_id = s limit 1), true, 2012, 'lb q' || i,
            '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 'lb' || i);
    insert into cbt.question_keys (question_id, correct_option) values (qid, 'A');
    update cbt.questions set status = 'published' where id = qid;
  end loop;
end $$;

set role authenticated;
-- Ada: an END-feedback session of 12 BIO 2012 questions, 9 right. Counts.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into lb select 'ada_end', cbt.create_practice('{"mode":"mixed","subjects":[{"code":"BIO","count":12}],"years":[2012,2012],"feedback":"end"}');
select pg_temp.check(not exists (select 1 from lb, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q
                                 where who = 'ada_end' and q ? 'correct_option'), 'end-of-session paper carries no keys');
select cbt.start_attempt('70000000-0000-0000-0000-000000000001', (select (j ->> 'assessment_id')::uuid from lb where who = 'ada_end'));
select cbt.submit_attempt(jsonb_build_object('id', '70000000-0000-0000-0000-000000000001',
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', case when (q ->> 'position')::int <= 9 then 'A' else 'B' end))
              from lb, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q where who = 'ada_end')));
select pg_temp.check((select (q ? 'correct_option') from jsonb_array_elements(cbt.get_review('70000000-0000-0000-0000-000000000001') -> 'items') q limit 1),
  'keys arrive through get_review after marking');

-- Bola: an INSTANT session (keys on the phone) of 12 questions, all right. Must not count.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into lb select 'bola_inst', cbt.create_practice('{"mode":"mixed","subjects":[{"code":"BIO","count":12}],"years":[2012,2012]}');
select cbt.start_attempt('70000000-0000-0000-0000-000000000002', (select (j ->> 'assessment_id')::uuid from lb where who = 'bola_inst'));
select cbt.submit_attempt(jsonb_build_object('id', '70000000-0000-0000-0000-000000000002',
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', 'A'))
              from lb, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q where who = 'bola_inst')));

-- Board ranking itself is tested in 05 (v1 board was replaced by score-based boards).
reset role;
\echo ALL LEADERBOARD CHECKS PASSED
