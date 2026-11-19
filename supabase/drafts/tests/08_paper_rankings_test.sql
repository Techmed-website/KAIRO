-- Behaviour tests for 20261119060000_cbt_paper_rankings.sql. Run after 05 (uses its users and BIO 2012 questions).
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
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
create temp table pb (who text, j jsonb);
grant all on pb to authenticated;

set role authenticated;
-- The BIO 2012 past paper, first 10 questions, end-of-session feedback.
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001',
  '{"mode":"year","subject":"BIO","year":2012,"count":10,"feedback":"end"}', 8, 900);
select pg_temp.sit('00000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000002',
  '{"mode":"year","subject":"BIO","year":2012,"count":10,"feedback":"end"}', 8, 600);
select pg_temp.sit('00000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000003',
  '{"mode":"year","subject":"BIO","year":2012,"count":10,"feedback":"end"}', 9, 1200);
-- Same title but a different number of questions is a different paper.
select pg_temp.sit('00000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000004',
  '{"mode":"year","subject":"BIO","year":2012,"count":12,"feedback":"end"}', 12, 100);

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into pb select 'ada1', cbt.paper_board('b0000000-0000-0000-0000-000000000001');
select pg_temp.check((select j ->> 'scope' = 'paper' and j ->> 'title' = 'BIO 2012' and (j ->> 'participants')::int = 3
                      and (j ->> 'question_count')::int = 10 and (j ->> 'max')::int = 100 from pb where who = 'ada1'),
  'a past-paper session ranks against the same paper (same title and length) only');
select pg_temp.check((select (j -> 'this' ->> 'rank')::int = 3 from pb where who = 'ada1'), 'rank #3 of 3: 80 in 900s is behind 90 and behind 80 in 600s');
select pg_temp.check((select string_agg(r ->> 'name' || '=' || (r ->> 'score'), ',' order by (r ->> 'rank')::int)
                      from pb, jsonb_array_elements(j -> 'rows') r where who = 'ada1') = 'Bola A.=90,Chidi E.=80,Ada O.=80',
  'paper board: score first, then faster time');
select pg_temp.check((select (j -> 'rows' -> 0 -> 'subject_scores' ->> 'BIO')::int = 90 from pb where who = 'ada1'),
  'rows carry subject-by-subject scores');

-- Ada resits and gets 10/10: this attempt is #1, a personal best; the old attempt is still #3 but her best row is #1.
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000005',
  '{"mode":"year","subject":"BIO","year":2012,"count":10,"feedback":"end"}', 10, 1500);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into pb select 'ada2', cbt.paper_board('b0000000-0000-0000-0000-000000000005');
select pg_temp.check((select (j -> 'this' ->> 'rank')::int = 1 and (j -> 'this' ->> 'personal_best')::boolean
                      and (j ->> 'participants')::int = 3 from pb where who = 'ada2'), 'a resit counts once per student; 100/100 is #1 and a personal best');
insert into pb select 'ada1b', cbt.paper_board('b0000000-0000-0000-0000-000000000001');
select pg_temp.check((select (j -> 'this' ->> 'rank')::int = 3 and not (j -> 'this' ->> 'personal_best')::boolean
                      and (j -> 'me' ->> 'rank')::int = 1 from pb where who = 'ada1b'), 'an older attempt keeps its own rank; the board shows her best');

-- Mixed session: ranked against all-time sessions on the same subject set (BIO only, >= 10 questions).
insert into pb select 'mix', cbt.paper_board('80000000-0000-0000-0000-000000000001');
select pg_temp.check((select j ->> 'scope' = 'subjects' and (j ->> 'participants')::int = 3 from pb where who = 'mix'),
  'a mixed session ranks against everyone''s best on the same subjects');

-- Not ranked: instant feedback, or too short.
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000006',
  '{"mode":"year","subject":"BIO","year":2012,"count":10,"feedback":"instant"}', 10, 60);
select pg_temp.sit('00000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000007',
  '{"mode":"year","subject":"BIO","year":2012,"count":5,"feedback":"end"}', 5, 60);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check(cbt.paper_board('b0000000-0000-0000-0000-000000000006') ->> 'reason' = 'instant', 'instant-feedback practice is not ranked');
select pg_temp.check(cbt.paper_board('b0000000-0000-0000-0000-000000000007') ->> 'reason' = 'short', 'fewer than 10 questions per subject is not ranked');
do $$ begin perform cbt.paper_board('b0000000-0000-0000-0000-000000000002'); raise exception 'FAIL: read another student''s attempt';
exception when no_data_found then raise notice 'ok  only your own attempt can be ranked'; end $$;

-- Period boards now carry subject_scores too.
select pg_temp.check((select (r -> 'subject_scores' ->> 'BIO') is not null from jsonb_array_elements(cbt.board('all', 1, 'BIO') -> 'rows') r limit 1),
  'board rows carry subject_scores');
reset role;
\echo ALL PAPER RANKING CHECKS PASSED
