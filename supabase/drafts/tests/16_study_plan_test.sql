-- Behaviour tests for 20261125150000_cbt_study_plan.sql. Run after 15.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to anon, authenticated;

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check(cbt.get_study_plan() is null, 'no plan yet: nothing');
select cbt.save_study_plan('{"input":{"targetDate":"2027-05-01"},"completed":["a|b"]}');
insert into d select 'cee', cbt.get_study_plan();
select pg_temp.check((select j -> 'data' -> 'completed' ->> 0 = 'a|b' from d where k = 'cee'), 'my plan comes back as saved');
select cbt.save_study_plan('{"completed":["a|b","c|d"]}');
select pg_temp.check(jsonb_array_length(cbt.get_study_plan() -> 'data' -> 'completed') = 2, 'saving again replaces my own row');
do $$ begin perform cbt.save_study_plan('[1]'); raise exception 'FAIL: array accepted'; exception when sqlstate '22023' then null; end $$;
reset role; reset request.jwt.claim.sub;

-- Another student sees nothing of Cee's plan, and cannot read the table directly.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check(cbt.get_study_plan() is null, 'another student does not see my plan');
do $$ begin perform 1 from cbt.study_plans; raise exception 'FAIL: table readable'; exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;

-- Signed out: refused.
set role anon;
do $$ begin perform cbt.save_study_plan('{}'); raise exception 'FAIL: anon saved'; exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin raise notice 'ALL STUDY PLAN CHECKS PASSED'; end $$;
