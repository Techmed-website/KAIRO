-- Behaviour tests for 20261126100000_cbt_quiz_reliability.sql. Run after 18.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'moses@example.com'), ('00000000-0000-0000-0000-0000000000a2', 'ada@example.com');
select pg_temp.check((select count(*) >= 2 from cbt.assessment_questions where assessment_id = '50000000-0000-0000-0000-000000000001'), 'the open challenge has questions');

-- Moses: taps Start (ranked attempt created), is pulled away before any question, the timer runs out.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'; set request.jwt.claim.is_anonymous = 'false';
select cbt.start_attempt('a1000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'phone', null);
reset role;
select pg_temp.check((select counts_for_rank from cbt.attempts where id = 'a1000000-0000-0000-0000-000000000001'), 'first attempt is the ranked one');
update cbt.attempts set started_at = now() - interval '20 minutes', deadline_at = now() - interval '15 minutes' where id = 'a1000000-0000-0000-0000-000000000001';
-- He opens the link again: the empty expired attempt gives up its slot and the new one ranks.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select cbt.start_attempt('a1000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'phone', null);
reset role;
select pg_temp.check((select not counts_for_rank from cbt.attempts where id = 'a1000000-0000-0000-0000-000000000001')
                     and (select counts_for_rank from cbt.attempts where id = 'a1000000-0000-0000-0000-000000000002'),
  'a never-started attempt no longer blocks the real first attempt from ranking');

-- Ada answers two questions, then loses her network; nobody submits.
create temp table ans as select jsonb_agg(jsonb_build_object('question_id', question_id, 'selected', 'A', 'time_ms', 9000)) j
  from (select question_id from cbt.assessment_questions where assessment_id = '50000000-0000-0000-0000-000000000001' order by position limit 2) x;
grant select on ans to authenticated;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select cbt.start_attempt('a2000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'phone', null);
select cbt.save_answers('a2000000-0000-0000-0000-000000000001', (select j from ans));
reset role;
update cbt.attempts set started_at = now() - interval '25 minutes', deadline_at = now() - interval '20 minutes' where id = 'a2000000-0000-0000-0000-000000000001';
select pg_temp.check((cbt.finish_expired_attempts() ->> 'finished')::int >= 1, 'the 10-minute job finishes expired attempts');
select pg_temp.check((select status = 'final' and counts_for_rank and score is not null and total >= 2 and submitted_at = deadline_at
                      from cbt.attempts where id = 'a2000000-0000-0000-0000-000000000001'),
  'an abandoned attempt with answers is marked from what was saved and stays ranked');
select pg_temp.check((select count(*) = 0 from cbt.attempts where status = 'in_progress' and deadline_at < now() - interval '10 minutes'
                      and exists (select 1 from cbt.attempt_answers aa where aa.attempt_id = attempts.id and aa.selected_option is not null)),
  'nothing with answers is left hanging');

-- Ada starts again: that is a retake, not ranked.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select cbt.start_attempt('a2000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'phone', null);
reset role;
select pg_temp.check((select not counts_for_rank from cbt.attempts where id = 'a2000000-0000-0000-0000-000000000002'), 'after a finished attempt, the next one is a retake');

select pg_temp.check((cbt.quiz_page('50000000-0000-0000-0000-000000000001') ->> 'ranked_count')::int
                     = (select count(*) from cbt.attempts where assessment_id = '50000000-0000-0000-0000-000000000001' and counts_for_rank and status = 'final')
                     and cbt.quiz_page('50000000-0000-0000-0000-000000000001') ? 'guest_players', 'quiz page gives exact ranked and guest counts');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$ begin perform cbt.finish_expired_attempts(); raise exception 'FAIL: student ran the job'; exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
do $$ begin raise notice 'ALL QUIZ RELIABILITY CHECKS PASSED'; end $$;
