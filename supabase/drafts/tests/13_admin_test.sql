-- Behaviour tests for 20261123160000_cbt_admin_quizzes.sql. Run after 12.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create temp table d (k text, j jsonb);
grant all on d to authenticated;
create temp table bio as select q.id from cbt.questions q join cbt.subjects s on s.id = q.subject_id
  join cbt.question_keys k on k.question_id = q.id
  where s.code = 'BIO' and q.status = 'published' and q.passage_id is null and nullif(btrim(k.explanation), '') is not null
  order by q.id limit 6;
grant select on bio to authenticated;

-- ── Students are locked out of every admin function ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform cbt.admin_quiz_list('{}'); raise exception 'FAIL: student listed admin quizzes';
exception when insufficient_privilege then raise notice 'ok  students cannot use the quiz admin'; end $$;
do $$ begin perform cbt.admin_save_quiz('{"title":"Hack","question_ids":[]}'); raise exception 'FAIL: student saved a quiz';
exception when insufficient_privilege then raise notice 'ok  students cannot create quizzes'; end $$;

-- ── An editor builds a prize challenge ──
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';
select pg_temp.check(jsonb_array_length(cbt.admin_question_search('{"subject":"BIO","limit":5}')) between 1 and 5, 'search finds Biology questions');
select pg_temp.check(jsonb_array_length(cbt.admin_question_search('{"subject":"BIO","random":true,"limit":3}')) = 3, 'auto-pick 3 at random');
insert into d select 'c', cbt.admin_save_quiz(jsonb_build_object('type','challenge','title','Biology Champions Challenge','description','Top 3 win airtime.',
  'subject','BIO','time_limit_sec',600,'ranked',true,'attempts_allowed',1,'guests_allowed',false,'prize_text','₦5,000 airtime','max_winners',3,
  'passcode','LION','publish',false,'question_ids',(select jsonb_agg(id) from (select id from bio limit 5) x)));
select pg_temp.check((select j ->> 'slug' = 'biology-champions-challenge' and j ->> 'status' = 'draft' from d where k = 'c'), 'draft saved with a clean web address');
select pg_temp.check((select j ->> 'caption' like '%🏆 Biology Champions Challenge%' and j ->> 'caption' like '%5 questions · 10 minutes · leaderboard%'
                       and j ->> 'caption' like '%Prize: ₦5,000 airtime (top 3)%' and j ->> 'caption' like '%Private: ask your class%'
                       and j ->> 'caption' like '%https://techmedng.com/quizzes/biology-champions-challenge%' and j ->> 'caption' not like '%LION%' from d where k = 'c'),
  'caption: title, format, prize, private note and link; never the passcode');
select pg_temp.check((select j ->> 'slug' = 'biology-champions-challenge-2' from (select cbt.admin_save_quiz(jsonb_build_object('title','Biology Champions Challenge','question_ids',(select jsonb_agg(id) from bio))) j) x),
  'same title again gets -2');
do $$ begin perform cbt.admin_save_quiz(jsonb_build_object('title','Bad','question_ids',jsonb_build_array(gen_random_uuid()))); raise exception 'FAIL: unpublished question accepted';
exception when invalid_parameter_value then raise notice 'ok  only published questions can be used'; end $$;
do $$ begin perform cbt.admin_save_quiz(jsonb_build_object('title','Bad','opens_at', now() + interval '2 hours', 'closes_at', now() + interval '1 hour', 'question_ids', (select jsonb_agg(id) from bio)));
  raise exception 'FAIL: closes before it opens'; exception when invalid_parameter_value then raise notice 'ok  closing must be after opening'; end $$;

-- Edit the question list while nobody has played: same web address, fresh version, old one archived.
insert into d select 'c2', cbt.admin_save_quiz(jsonb_build_object('id',(select j ->> 'id' from d where k = 'c'),'type','challenge','title','Biology Champions Challenge',
  'time_limit_sec',600,'ranked',true,'attempts_allowed',1,'prize_text','₦5,000 airtime','max_winners',3,'publish',false,'question_ids',(select jsonb_agg(id) from bio)));
select pg_temp.check((select j ->> 'slug' = 'biology-champions-challenge' and j ->> 'replaced' = (select j2 ->> 'id' from d d2, lateral (select d2.j j2) z where d2.k = 'c') from d where k = 'c2'),
  'new question list keeps the web address on a fresh version');
reset role;
select pg_temp.check((select status = 'archived' and slug is null from cbt.assessments where id = (select (j ->> 'id')::uuid from d where k = 'c')), 'old version archived, not removed');
select pg_temp.check((select count(*) = 6 from cbt.assessment_questions where assessment_id = (select (j ->> 'id')::uuid from d where k = 'c2')), 'fresh version has the 6 questions');
select pg_temp.check(exists (select 1 from cbt.assessment_secrets where assessment_id = (select (j ->> 'id')::uuid from d where k = 'c2') and passcode_hash is not null), 'passcode carried over');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';

-- Publish, a student plays, then the editor manages it.
select cbt.admin_quiz_action((select (j ->> 'id')::uuid from d where k = 'c2'), 'publish_now');
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select cbt.start_attempt('ad000000-0000-0000-0000-000000000001', (select (j ->> 'id')::uuid from d where k = 'c2'), null, 'LION');
select cbt.submit_attempt(jsonb_build_object('id','ad000000-0000-0000-0000-000000000001','answers',
  (select jsonb_agg(jsonb_build_object('question_id', id, 'selected', 'A')) from bio)));
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';
do $$ begin perform cbt.admin_save_quiz(jsonb_build_object('id',(select j ->> 'id' from d where k = 'c2'),'title','X','question_ids',(select jsonb_agg(id) from (select id from bio limit 2) x)));
  raise exception 'FAIL: changed questions after attempts'; exception when sqlstate '55000' then raise notice 'ok  questions lock once students have played'; end $$;
select pg_temp.check((cbt.admin_save_quiz(jsonb_build_object('id',(select j ->> 'id' from d where k = 'c2'),'type','challenge','title','Biology Champions Challenge — Final',
  'time_limit_sec',600,'ranked',true,'attempts_allowed',1,'prize_text','₦10,000 airtime','max_winners',3,'publish',true)) ->> 'caption') like '%₦10,000%',
  'title and prize can still change after attempts; caption follows');
insert into d select 'r', cbt.admin_quiz_results((select (j ->> 'id')::uuid from d where k = 'c2'));
select pg_temp.check((select jsonb_array_length(j) = 1 and j -> 0 ->> 'full_name' = 'Cee Dee' and (j -> 0 ->> 'rank')::int = 1 from d where k = 'r'), 'results show the student, score and rank');
select cbt.admin_set_attempt('ad000000-0000-0000-0000-000000000001', true, 'shared answers in the group');
reset role;
select pg_temp.check((select status = 'rejected' and not counts_for_rank and reject_reason like 'staff:%' from cbt.attempts where id = 'ad000000-0000-0000-0000-000000000001'), 'rejected with a reason, off the board');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ed';
do $$ begin perform cbt.admin_set_attempt('ad000000-0000-0000-0000-000000000001', true, ' '); raise exception 'FAIL: rejected without a reason';
exception when invalid_parameter_value then raise notice 'ok  a reason is required'; end $$;
select pg_temp.check((cbt.admin_set_attempt('ad000000-0000-0000-0000-000000000001', false) ->> 'counts_for_rank')::boolean, 'restored to the board (it was the first attempt)');
select pg_temp.check((cbt.admin_quiz_action((select (j ->> 'id')::uuid from d where k = 'c2'), 'close') ->> 'status') = 'closed', 'close early');
select pg_temp.check((cbt.admin_quiz_action((select (j ->> 'id')::uuid from d where k = 'c2'), 'reopen') ->> 'status') = 'live', 'reopen');
insert into d select 'dup', cbt.admin_quiz_action((select (j ->> 'id')::uuid from d where k = 'c2'), 'duplicate');
select pg_temp.check((select (cbt.admin_quiz_detail((j ->> 'id')::uuid) -> 'quiz' ->> 'status') = 'draft'
                       and jsonb_array_length(cbt.admin_quiz_detail((j ->> 'id')::uuid) -> 'questions') = 6 from d where k = 'dup'), 'duplicate: a draft with the same questions');
select pg_temp.check((select count(*) >= 3 from jsonb_array_elements(cbt.admin_quiz_list('{"type":"challenge"}'))), 'list shows the challenges');
-- Closing a scheduled quiz (and publish+close in one transaction) must not break the opens/closes order.
insert into d select 'sch', cbt.admin_save_quiz(jsonb_build_object('title','Later Challenge','opens_at', now() + interval '1 day','publish',true,'question_ids',(select jsonb_agg(id) from (select id from bio limit 2) x)));
select pg_temp.check((select j ->> 'status' = 'scheduled' from d where k = 'sch'), 'a future opening time schedules the quiz');
select pg_temp.check((cbt.admin_quiz_action((select (j ->> 'id')::uuid from d where k = 'sch'), 'close') ->> 'status') = 'closed', 'a scheduled quiz can be closed');
do $$ declare r jsonb; begin
  r := cbt.admin_save_quiz(jsonb_build_object('title','Instant Close','publish',true,'question_ids',(select jsonb_agg(id) from (select id from bio limit 2) x)));
  perform cbt.admin_quiz_action((r ->> 'id')::uuid, 'close');
  raise notice 'ok  publish and close in the same moment works';
end $$;

-- Question tools
select pg_temp.check((cbt.admin_question_update((select id from bio limit 1), '{"difficulty":4}') ->> 'difficulty')::int = 4, 'set difficulty 1-5');
do $$ begin perform cbt.admin_question_update((select id from bio limit 1), '{"difficulty":9}'); raise exception 'FAIL: difficulty 9';
exception when invalid_parameter_value then raise notice 'ok  difficulty must be 1-5'; end $$;
select pg_temp.check((cbt.admin_question_update((select id from bio offset 5 limit 1), '{"status":"retired"}') ->> 'status') = 'retired', 'retire a question');
select pg_temp.check((cbt.admin_question_update((select id from bio offset 5 limit 1), '{"status":"published"}') ->> 'status') = 'published', 'restore it');
reset role;
select pg_temp.check((select count(*) >= 8 from cbt.audit_log where actor = '00000000-0000-0000-0000-0000000000ed'
                      and action in ('quiz_create','quiz_edit','quiz_publish_now','attempt_reject','attempt_restore','quiz_close','quiz_reopen','quiz_duplicate','question_update')),
  'every admin action is in the audit log');
reset request.jwt.claim.sub;
do $$ begin raise notice 'ALL ADMIN CHECKS PASSED'; end $$;
