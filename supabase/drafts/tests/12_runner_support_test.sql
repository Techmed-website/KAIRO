-- Behaviour tests for 20261123140000_cbt_runner_support.sql. Run after 11.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
set role anon;
select pg_temp.check((cbt.public_quiz_by_id('50000000-0000-0000-0000-000000000001') ->> 'slug') = 'open-challenge', 'anon gets a quiz card by id');
select pg_temp.check((cbt.public_quiz_by_id('50000000-0000-0000-0000-000000000001') ? 'result_config') and not (cbt.public_quiz_by_id('50000000-0000-0000-0000-000000000001') ? 'passcode_hash'), 'card carries result config, never secrets');
select pg_temp.check(cbt.public_quiz_by_id('00000000-0000-0000-0000-000000000000') is null, 'unknown id: nothing');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select bool_and(q ->> 'source' = 'jamb') from jsonb_array_elements(cbt.get_paper('50000000-0000-0000-0000-000000000001') -> 'questions') q), 'paper questions carry their source');
reset role; reset request.jwt.claim.sub;
do $$ begin raise notice 'ALL RUNNER SUPPORT CHECKS PASSED'; end $$;
