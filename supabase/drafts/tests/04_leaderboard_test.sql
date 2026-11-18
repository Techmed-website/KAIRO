-- Behaviour tests for 20261119010000_cbt_leaderboards.sql. Run after 03.
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

select pg_temp.check(jsonb_array_length(cbt.board('points','day') -> 'rows') = 1, 'instant-feedback answers do not count');
select pg_temp.check((select (b -> 'me' ->> 'rank') is null and (b -> 'me' ->> 'answered')::int < 10 from (select cbt.board('points','day') b) x),
  'a student off the board still gets their own progress (instant answers excluded)');
select pg_temp.check((cbt.board('points','day') -> 'rows' -> 0 ->> 'name') = 'Ada O.' and jsonb_array_length(cbt.board('points','week') -> 'rows') = 0, 'names show as first name + initial; the week board needs 20 answered');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
-- Ada also has 3 end-feedback answers (2 right) from the earlier test files, so 11 of 15 today.
select pg_temp.check((select (b ->> 'rank')::int = 1 and (b ->> 'points')::int = 11 and (b ->> 'answered')::int = 15 and (b ->> 'accuracy')::numeric = 73.3
                      from (select cbt.board('points','day') -> 'me' b) x), 'own row: rank 1, 11 correct of 15, 73.3% accuracy');
select pg_temp.check((cbt.board('points','day') -> 'rows' -> 0 ->> 'is_me')::boolean, 'own row is marked');
select pg_temp.check(cbt.board('points','all') ->> 'min_answered' = '40' and jsonb_array_length(cbt.board('points','all') -> 'rows') = 0,
  'all-time board needs 40 answered');

-- Mock board: best mock /400.
insert into lb select 'ada_mock', cbt.create_practice('{"mode":"mock","subjects":["MTH","CHM","BIO"]}');
select cbt.start_attempt('70000000-0000-0000-0000-000000000003', (select (j ->> 'assessment_id')::uuid from lb where who = 'ada_mock'));
select cbt.submit_attempt(jsonb_build_object('id', '70000000-0000-0000-0000-000000000003',
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', case when q ->> 'subject' = 'ENG' then 'A' else 'B' end))
              from lb, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q where who = 'ada_mock')));
reset role;  -- students cannot read cbt.questions; compute the expected ENG score as the owner
select pg_temp.check((cbt.board('mock','week') -> 'rows' -> 0 ->> 'mock')::int =
                     (select sum(sc)::int from (select round(100.0 * count(*) filter (where aa.is_correct) / count(*)) sc
                      from cbt.attempt_answers aa join cbt.questions q on q.id = aa.question_id
                      where aa.attempt_id = '70000000-0000-0000-0000-000000000003' group by q.subject_id) x)
                     and (cbt.board('mock','week') -> 'rows' -> 0 ->> 'mock')::int >= 100,
  'mock board scores each subject /100 and sums them (/400)');
do $$ begin perform cbt.board('nonsense','day'); raise exception 'FAIL: bad kind accepted';
exception when invalid_parameter_value then raise notice 'ok  unknown board kinds are refused'; end $$;
reset role;
\echo ALL LEADERBOARD CHECKS PASSED
