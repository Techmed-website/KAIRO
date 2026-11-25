-- Behaviour tests for 20261125120000_cbt_quiz_hub.sql. Run after 14.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to anon, authenticated;

-- Signed out: the hub and a quiz page work, names are initials, no personal numbers.
set role anon;
insert into d select 'hub', cbt.quiz_hub();
select pg_temp.check((select jsonb_typeof(j -> 'recent') = 'array' and jsonb_typeof(j -> 'challenges') = 'array' from d where k = 'hub'), 'signed-out hub has challenges and recent quizzes');
select pg_temp.check((select bool_and(c -> 'me' = 'null'::jsonb) from d, jsonb_array_elements(j -> 'recent') c where k = 'hub'), 'signed out: no personal numbers');
insert into d select 'page', cbt.quiz_page('50000000-0000-0000-0000-000000000001');
select pg_temp.check((select j ->> 'slug' = 'open-challenge' and jsonb_array_length(j -> 'board') >= 1 from d where k = 'page'), 'a quiz page with its leaderboard');
select pg_temp.check((select bool_and(r ->> 'name' ~ '^([A-Z]\.){1,2}$|^Builder$') from d, jsonb_array_elements(j -> 'board') r where k = 'page'), 'signed out: initials only');
select pg_temp.check(cbt.quiz_page('00000000-0000-0000-0000-000000000000') is null, 'unknown quiz: nothing');
reset role;

-- Signed in as Cee: names as "First L.", your attempts, best and rank.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into d select 'mine', cbt.quiz_page('50000000-0000-0000-0000-000000000001');
select pg_temp.check((select (j -> 'me' ->> 'attempts')::int >= 2 and (j -> 'me' ->> 'best')::int = 2 and j -> 'me' ->> 'ranked_attempt_id' is not null
                       and (j -> 'me' ->> 'rank')::int >= 1 from d where k = 'mine'), 'my attempts, best score, ranked attempt and rank');
select pg_temp.check((select bool_or((r ->> 'is_me')::boolean and r ->> 'name' = 'Cee D.') from d, jsonb_array_elements(j -> 'board') r where k = 'mine'), 'I am highlighted as "Cee D."');
select pg_temp.check((select (c -> 'me' ->> 'best') is not null from jsonb_array_elements(cbt.quiz_hub() -> 'challenges') c where c ->> 'slug' = 'open-challenge'), 'the hub shows my best on each quiz');
reset role; reset request.jwt.claim.sub;
do $$ begin raise notice 'ALL QUIZ HUB CHECKS PASSED'; end $$;
