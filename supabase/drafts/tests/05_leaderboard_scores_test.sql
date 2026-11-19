-- Behaviour tests for 20261119020000_cbt_leaderboard_scores.sql (score, then time). Run after 04.
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table s2 (who text, j jsonb);
grant all on s2 to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c', 'chidi@example.com') on conflict do nothing;
insert into cbt.profiles (id, full_name) values ('00000000-0000-0000-0000-00000000000c', 'Chidi Eze') on conflict (id) do update set full_name = excluded.full_name;

-- 10 more 2013 questions in ENG, MTH and CHM so a 4-subject paper can have 10 per subject (BIO 2012 has 20 from test 04).
do $$ declare s record; i int; qid uuid;
begin
  for s in select id, code from cbt.subjects where code in ('ENG','MTH','CHM') loop
    for i in 1..10 loop
      qid := gen_random_uuid();
      insert into cbt.questions (id, source_ref, subject_id, topic_id, topic_auto, year, stem, options, content_hash)
      values (qid, 's2:' || s.code || i, s.id, (select id from cbt.topics where subject_id = s.id limit 1), true, 2013, 's2 ' || s.code || i,
              '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 's2' || s.code || i);
      insert into cbt.question_keys (question_id, correct_option) values (qid, 'A');
      update cbt.questions set status = 'published' where id = qid;
    end loop;
  end loop;
end $$;

-- Helper: an end-of-session paper, answered 'A' for the first p_right positions of each subject, with a duration.
create function pg_temp.sit(p_user uuid, p_attempt uuid, p_req jsonb, p_right int, p_dur int) returns jsonb language plpgsql as $$
declare a uuid; r jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  a := (cbt.create_practice(p_req) ->> 'assessment_id')::uuid;
  perform cbt.start_attempt(p_attempt, a);
  select cbt.submit_attempt(jsonb_build_object('id', p_attempt, 'duration_sec', p_dur,
    'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id',
                  'selected', case when rn <= p_right then 'A' else 'B' end))
                from (select q, row_number() over (partition by q ->> 'subject' order by (q ->> 'position')::int) rn
                      from jsonb_array_elements(cbt.get_paper(a) -> 'questions') q) x))) into r;
  return r;
end $$;
grant execute on function pg_temp.sit(uuid, uuid, jsonb, int, int) to authenticated;

set role authenticated;
-- Single subject (BIO 2012, 10 questions): Ada and Chidi both 8/10 = 80/100; Chidi is faster; Bola 9/10 = 90 but slow.
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000001',
  '{"mode":"mixed","subjects":[{"code":"BIO","count":10}],"years":[2012,2012],"feedback":"end"}', 8, 4500);
select pg_temp.sit('00000000-0000-0000-0000-00000000000c', '80000000-0000-0000-0000-000000000002',
  '{"mode":"mixed","subjects":[{"code":"BIO","count":10}],"years":[2012,2012],"feedback":"end"}', 8, 3900);
select pg_temp.sit('00000000-0000-0000-0000-00000000000b', '80000000-0000-0000-0000-000000000003',
  '{"mode":"mixed","subjects":[{"code":"BIO","count":10}],"years":[2012,2012],"feedback":"end"}', 9, 9000);
-- Too short to count: 5 questions.
select pg_temp.sit('00000000-0000-0000-0000-00000000000b', '80000000-0000-0000-0000-000000000004',
  '{"mode":"mixed","subjects":[{"code":"CHM","count":5}],"years":[2013,2013],"feedback":"end"}', 5, 60);

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into s2 select 'bio', cbt.board('day', 1, 'BIO');
select pg_temp.check((select string_agg(r ->> 'name' || '=' || (r ->> 'score'), ',' order by (r ->> 'rank')::int) from s2, jsonb_array_elements(j -> 'rows') r where who = 'bio')
                     = 'Bola A.=90,Chidi E.=80,Ada O.=80', 'higher score first; equal scores: faster finish ranks higher (Bola''s 12/12 instant session from 04 does not count)');
select pg_temp.check((select (j -> 'rows' -> 0 ->> 'max')::int = 100 and (j -> 'rows' -> 1 ->> 'duration_sec')::int = 3900 from s2 where who = 'bio'),
  'single subject is scored /100 and carries the time taken');
select pg_temp.check((select (j -> 'me' ->> 'rank')::int = 3 from s2 where who = 'bio'), 'own row comes back with its rank');
select pg_temp.check(jsonb_array_length(cbt.board('day', 1, 'CHM') -> 'rows') = 0, 'fewer than 10 questions per subject does not count');
select pg_temp.check(jsonb_array_length(cbt.board('day', 1) -> 'rows') = 3, 'the any-subject /100 board lists each student once (their best)');

-- Four subjects, 10 each: /400.
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000005',
  '{"mode":"mixed","subjects":[{"code":"ENG","count":10},{"code":"MTH","count":10},{"code":"CHM","count":10},{"code":"BIO","count":10}],"years":[2012,2013],"feedback":"end"}', 7, 3000);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select (r ->> 'score')::int = 280 and (r ->> 'max')::int = 400 and jsonb_array_length(r -> 'subjects') = 4
                      from jsonb_array_elements(cbt.board('week', 4) -> 'rows') r where (r ->> 'is_me')::boolean),
  'four subjects at 7/10 each score 280/400');
select pg_temp.check((cbt.board('week', 3) -> 'max')::int = 300, 'three-subject board is /300');
do $$ begin perform cbt.board('day', 2, 'BIO'); raise exception 'FAIL: subject filter on a 2-subject board accepted';
exception when invalid_parameter_value then raise notice 'ok  a subject filter only applies to /100 boards'; end $$;
reset role;
\echo ALL SCORE LEADERBOARD CHECKS PASSED
