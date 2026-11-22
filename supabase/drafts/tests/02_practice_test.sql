-- Behaviour tests for the practice engine (migration 20261118060000). Run by run.sh after 01_engine_test.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;
reset role;

-- Fixtures: 6 published questions in each of ENG, MTH, CHM, BIO across two years, with a trusted topic,
-- plus one PHY question whose topic is only a suggestion.
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into cbt.subjects (code, name) values ('ENG','Use of English'),('MTH','Mathematics'),('CHM','Chemistry'),('BIO','Biology')
  on conflict (code) do nothing;
insert into cbt.topics (subject_id, name) select id, 'T-' || code from cbt.subjects on conflict do nothing;

do $$
declare s record; i int; qid uuid;
begin
  for s in select id, code from cbt.subjects where code in ('ENG','MTH','CHM','BIO','PHY') loop
    for i in 1..6 loop
      qid := gen_random_uuid();
      insert into cbt.questions (id, source_ref, subject_id, topic_id, topic_auto, year, stem, options, content_hash)
      values (qid, 'p:' || s.code || ':' || lpad(i::text, 2, '0'), s.id,
              (select id from cbt.topics where subject_id = s.id and name = 'T-' || s.code),
              s.code <> 'PHY', case when i <= 3 then 2010 else 2011 end, s.code || ' q' || i,
              '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 'h' || s.code || i);
      insert into cbt.question_keys (question_id, correct_option, explanation) values (qid, 'A', 'because');
      update cbt.questions set status = 'published' where id = qid;
    end loop;
  end loop;
end $$;
set client_min_messages = notice;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select pg_temp.check((select (s ->> 'count')::int from jsonb_array_elements(cbt.catalog() -> 'subjects') s where s ->> 'code' = 'ENG') = 6,
  'catalog counts published ENG questions');
select pg_temp.check((select jsonb_array_length(s -> 'topics') from jsonb_array_elements(cbt.catalog() -> 'subjects') s where s ->> 'code' = 'BIO') = 1,
  'catalog lists trusted topics');

-- Year paper: only that year, in source order.
create temp table r as select cbt.create_practice('{"mode":"year","subject":"BIO","year":2010}') j;
grant all on r to authenticated;
select pg_temp.check((select (j ->> 'question_count')::int from r) = 3, 'year mode: 3 questions from BIO 2010');
select pg_temp.check((select string_agg(q ->> 'stem_html', ',' order by (q ->> 'position')::int)
                      from r, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q) = 'BIO q1,BIO q2,BIO q3',
  'year mode keeps source order');
select pg_temp.check((select bool_and(q ? 'correct_option') from r, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q),
  'practice paper carries keys for instant feedback');

-- Topic practice: suggested (untrusted) topics are excluded.
do $$ begin
  perform cbt.create_practice(jsonb_build_object('mode','topic','subject','PHY','topic_ids',
          jsonb_build_array((select id from cbt.topics where name = 'T-PHY'))));
  raise exception 'FAIL: untrusted topic used';
exception when no_data_found then raise notice 'ok  topic mode skips untrusted topic labels';
end $$;

-- Mixed: per-subject counts, and unseen questions come first.
truncate r;
insert into r select cbt.create_practice('{"mode":"mixed","subjects":[{"code":"CHM","count":3},{"code":"MTH","count":2}]}');
select pg_temp.check((select (j ->> 'question_count')::int from r) = 5, 'mixed mode: 3 CHM + 2 MTH');
select cbt.start_attempt('50000000-0000-0000-0000-000000000001', (select (j ->> 'assessment_id')::uuid from r));
select cbt.submit_attempt(jsonb_build_object('id', '50000000-0000-0000-0000-000000000001',
  'answers', (select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'selected', 'A'))
              from r, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q)));
create temp table seen as select (q ->> 'id')::uuid id from r, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q
  where q ->> 'subject' = 'CHM';
grant all on seen to authenticated;
truncate r;
insert into r select cbt.create_practice('{"mode":"mixed","subjects":[{"code":"CHM","count":3}]}');
select pg_temp.check(not exists (select 1 from r, jsonb_array_elements(cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions') q
                                 where (q ->> 'id')::uuid in (select id from seen)),
  'unseen questions are served before ones already answered');

-- Mock: English plus exactly three others, timed, answers after submit, no keys in the paper.
truncate r;
insert into r select cbt.create_practice('{"mode":"mock","subjects":["MTH","CHM","BIO"]}');
select pg_temp.check((select (j ->> 'time_limit_sec')::int from r) = 7200, 'mock is 2 hours');
select pg_temp.check((select (cbt.get_paper((j ->> 'assessment_id')::uuid) -> 'questions' -> 0 ->> 'subject') from r) = 'ENG',
  'mock starts with English');
do $$ begin
  perform cbt.create_practice('{"mode":"mock","subjects":["MTH","CHM"]}');
  raise exception 'FAIL: mock with 2 subjects allowed';
exception when invalid_parameter_value then raise notice 'ok  mock needs exactly 3 subjects besides English';
end $$;

-- Privacy: another student cannot see, open or start Ada's personal session.
create temp table ada_session as select (j ->> 'assessment_id')::uuid id from r;
grant all on ada_session to authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from cbt.assessments where id = (select id from ada_session)) = 0, 'other students cannot list a personal session');
do $$ begin
  perform cbt.get_paper((select id from ada_session));
  raise exception 'FAIL: other student opened a personal paper';
exception when no_data_found then raise notice 'ok  other students cannot open a personal paper';
end $$;
do $$ begin
  perform cbt.start_attempt(gen_random_uuid(), (select id from ada_session));
  raise exception 'FAIL: other student started a personal session';
exception when raise_exception then raise notice 'ok  other students cannot start a personal session';
end $$;

-- Editing after publishing.
reset role;
update cbt.question_keys set explanation = 'better explanation' where question_id = (select id from cbt.questions where source_ref = 'p:BIO:01');
select pg_temp.check((select explanation_html from cbt.question_versions v join cbt.questions q on q.id = v.question_id
                      where q.source_ref = 'p:BIO:01' and v.version = q.version) = 'better explanation',
  'explanation edit reaches the live version');
update cbt.question_keys set correct_option = 'B' where question_id = (select id from cbt.questions where source_ref = 'p:BIO:01');
select pg_temp.check((select version from cbt.questions where source_ref = 'p:BIO:01') = 2, 'key change creates version 2');
select pg_temp.check((select correct_option from cbt.question_versions v join cbt.questions q on q.id = v.question_id
                      where q.source_ref = 'p:BIO:01' and v.version = 1) = 'A', 'version 1 keeps the old key');

\echo ALL PRACTICE CHECKS PASSED
