-- Behaviour tests for 20261126090200_cbt_analysis.sql. Run after 17 (uses Funmi from 17).
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to anon, authenticated;

-- Four published questions (latest versions), numbered 1..4.
create temp table qv as
  select row_number() over (order by v.question_id) n, v.question_id, v.version, v.correct_option
  from (select distinct on (question_id) * from cbt.question_versions
        where question_id not in (select question_id from cbt.attempt_answers) order by question_id, version desc) v limit 4;
select pg_temp.check((select count(*) = 4 from qv), 'four questions to work with');

-- Funmi's attempt 1 (assessment X): q1 wrong, q2-q4 right, 25 s each.
update cbt.attempts set server_received_at = now() - interval '2 days', submitted_at = now() - interval '2 days' where id = 'f1000000-0000-0000-0000-000000000001';
insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, is_correct, time_ms)
select 'f1000000-0000-0000-0000-000000000001', question_id, version,
       case when n = 1 then (case correct_option when 'A' then 'B' else 'A' end) else correct_option end, n <> 1, 25000 from qv;
-- Three other students on the same paper: q1, q2 right, q3, q4 wrong, 10 s each; each scores 5/10.
insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status, score, total)
select ('f2000000-0000-0000-0000-00000000000' || i)::uuid, u, (select assessment_id from cbt.attempts where id = 'f1000000-0000-0000-0000-000000000001'),
       'online', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day', 'final', 5, 10
from (values (1, '00000000-0000-0000-0000-00000000000a'::uuid), (2, '00000000-0000-0000-0000-00000000000b'::uuid), (3, '00000000-0000-0000-0000-0000000000d1'::uuid)) o(i, u);
insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, is_correct, time_ms)
select ('f2000000-0000-0000-0000-00000000000' || i)::uuid, question_id, version,
       case when n <= 2 then correct_option else (case correct_option when 'A' then 'B' else 'A' end) end, n <= 2, 10000
from qv, generate_series(1, 3) i;

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
insert into d select 'a', cbt.attempt_analysis('f1000000-0000-0000-0000-000000000001');
select pg_temp.check((select (j ->> 'answered')::int = 4 and (j ->> 'avg_sec')::numeric = 25 and (j ->> 'community_avg_sec')::numeric = 10 from d where k = 'a'),
  'result: my time per question against everyone on the same questions');
select pg_temp.check((select (j ->> 'peers')::int = 3 and (j ->> 'peer_avg_pct')::numeric = 50 and (j ->> 'percentile')::int = 100 from d where k = 'a'),
  'result: compared with others on the same paper (6/10 beats every 5/10)');
select pg_temp.check((select (j ->> 'beat_the_crowd')::int = 2 and (j ->> 'missed_easy')::int = 1 and (j ->> 'slow')::int = 4 from d where k = 'a'),
  'result: right where most missed, missed what most got right, and slow questions');
select pg_temp.check((select count(*) = 4 and bool_and((x ->> 'community_pct') is not null)
                      from d, jsonb_array_elements(j -> 'questions') x where k = 'a'), 'result: per-question accuracy of everyone');

insert into d select 'm', cbt.my_analysis();
select pg_temp.check((select (j -> 'totals' ->> 'answered')::int = 4 and (j -> 'totals' ->> 'pct')::numeric = 75 from d where k = 'm'), 'overall: totals and accuracy');
select pg_temp.check((select jsonb_array_length(j -> 'subjects') >= 1 and (j -> 'subjects' -> 0 ->> 'community_pct') is not null from d where k = 'm'), 'overall: by subject, against everyone');
select pg_temp.check((select jsonb_array_length(j -> 'weeks') >= 1 from d where k = 'm'), 'overall: weekly trend');
select pg_temp.check((select j -> 'next' ->> 'topic_id' is not null or jsonb_array_length(j -> 'topics') = 0 from d where k = 'm'), 'overall: a topic to practise next');
reset role; reset request.jwt.claim.sub;

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.check(cbt.attempt_analysis('f1000000-0000-0000-0000-000000000001') is null, 'nobody else can analyse my attempt');
select pg_temp.check((cbt.my_analysis() -> 'totals' ->> 'answered')::int = 4, 'my_analysis only counts my own answers');
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin perform cbt.my_analysis(); raise exception 'FAIL: anon analysis'; exception when insufficient_privilege then null; end $$;
reset role;
insert into d select 'bank', jsonb_build_object('n', (select count(*) from cbt.questions where status = 'published'));
set role anon;
select pg_temp.check((cbt.bank_count() ->> 'total')::int = (select (j ->> 'n')::int from d where k = 'bank'), 'bank count is public and live');
reset role;
do $$ begin raise notice 'ALL ANALYSIS CHECKS PASSED'; end $$;
