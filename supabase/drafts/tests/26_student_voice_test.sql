-- Behaviour tests for 20261128100000_cbt_student_voice.sql. Isolated fixtures only (users fe…, no real students).
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as
$$ begin perform set_config('role', 'authenticated', false); perform set_config('request.jwt.claim.sub', u, false); end $$;

insert into auth.users (id, email, is_anonymous) values
  ('fe000000-0000-0000-0000-0000000000f0', 'voice.founder@kairo-fixture.ng', false),
  ('fe000000-0000-0000-0000-0000000000e0', 'voice.editor@kairo-fixture.ng', false),
  ('fe000000-0000-0000-0000-0000000000a1', 'voice.ada@kairo-fixture.ng', false),
  ('fe000000-0000-0000-0000-0000000000a2', 'voice.bayo@kairo-fixture.ng', false),
  ('fe000000-0000-0000-0000-0000000000a3', null, true);
insert into cbt.profiles (id, full_name, phone, email, role) values
  ('fe000000-0000-0000-0000-0000000000f0', 'Voice Founder', null, 'voice.founder@kairo-fixture.ng', 'admin'),
  ('fe000000-0000-0000-0000-0000000000e0', 'Voice Editor', null, 'voice.editor@kairo-fixture.ng', 'editor'),
  ('fe000000-0000-0000-0000-0000000000a1', 'adaeze okafor', '08011112222', 'voice.ada@kairo-fixture.ng', 'student'),
  ('fe000000-0000-0000-0000-0000000000a2', 'Bayo Lawal', '08033334444', 'voice.bayo@kairo-fixture.ng', 'student');

create temp table vpool as
  select row_number() over (order by q.id) n, v.question_id, v.version
  from cbt.questions q join lateral (select * from cbt.question_versions v where v.question_id = q.id order by version desc limit 1) v on true
  where q.source_ref like 'fi:%';
create or replace function pg_temp.va(p_uid uuid, p_type text, p_personal boolean, p_title text, p_at timestamptz, qn int, p_status text default 'final', p_deadline timestamptz default null)
returns uuid language plpgsql as $$
declare a uuid := gen_random_uuid(); t uuid := gen_random_uuid();
begin
  insert into cbt.assessments (id, type, title, status, personal) values (a, p_type::cbt.assessment_type, p_title, 'live', p_personal);
  insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, deadline_at, submitted_at, server_received_at, status)
  values (t, p_uid, a, 'online', p_at, p_deadline, case when p_status = 'final' then p_at + interval '10 minutes' end,
          case when p_status = 'final' then p_at + interval '10 minutes' end, p_status::cbt.attempt_status);
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option)
  select t, question_id, version, case when n <= qn then 'A' end from vpool where n <= qn;
  return t;
end $$;
select pg_temp.check((select count(*) >= 12 from vpool), 'question pool available');

-- Ada: a short practice (3 answers, not meaningful) and a real one (8 answers).
create temp table ids as select
  pg_temp.va('fe000000-0000-0000-0000-0000000000a1', 'practice', true, 'BIO topic practice', now() - interval '3 hours', 3) short_a,
  pg_temp.va('fe000000-0000-0000-0000-0000000000a1', 'practice', true, 'BIO topic practice', now() - interval '2 hours', 8) real_a,
  pg_temp.va('fe000000-0000-0000-0000-0000000000a2', 'practice', true, 'CHM 2015', now() - interval '2 hours', 8) bayo_a;
grant select on ids to authenticated;

-- ── prompts ──
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(cbt.voice_prompt('result', (select short_a from ids)) is null, 'a 3-question session does not trigger the practice prompt');
select pg_temp.check(cbt.voice_prompt('result', (select real_a from ids)) ->> 'prompt' = 'practice_helpful', 'first meaningful practice: "Was this practice session helpful?"');
select pg_temp.check(cbt.voice_prompt('result', (select real_a from ids)) is null, 'the same prompt is never delivered twice (second device gets nothing)');
select pg_temp.check(cbt.voice_prompt('home') is null, 'only one unsolicited prompt per 7 days');
select cbt.voice_prompt_dismiss('practice_helpful', (select real_a::text from ids));
reset role;
select pg_temp.check((select dismissed_at is not null and responded_at is null from cbt.feedback_prompts where user_id = 'fe000000-0000-0000-0000-0000000000a1'), 'dismissal recorded');
select pg_temp.check((select count(*) = 1 from cbt.events where user_id = 'fe000000-0000-0000-0000-0000000000a1' and name = 'feedback_prompt_dismissed'), 'dismissal event recorded once');
-- Bayo is someone else: Ada cannot claim a prompt on Bayo's attempt.
update cbt.feedback_prompts set shown_at = now() - interval '8 days' where user_id = 'fe000000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(cbt.voice_prompt('result', (select bayo_a from ids)) is distinct from '{"prompt":"practice_helpful"}'::jsonb
                     and coalesce(cbt.voice_prompt('result', (select bayo_a from ids)) ->> 'prompt', '') <> 'practice_helpful', 'no practice prompt on another student''s attempt');
reset role;
delete from cbt.feedback_prompts where user_id = 'fe000000-0000-0000-0000-0000000000a1' and prompt <> 'practice_helpful';
update cbt.feedback_prompts set shown_at = now() - interval '8 days' where user_id = 'fe000000-0000-0000-0000-0000000000a1';

-- Never during a live timed exam.
select pg_temp.va('fe000000-0000-0000-0000-0000000000a1', 'mock', true, 'Mock UTME', now() - interval '5 minutes', 2, 'in_progress', now() + interval '1 hour');
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(cbt.voice_prompt('home') is null, 'no prompt while a timed exam is running');
reset role;
update cbt.attempts set deadline_at = now() - interval '1 minute' where user_id = 'fe000000-0000-0000-0000-0000000000a1' and status = 'in_progress';

-- Trigger 2: three meaningful sessions → overall rating invitation, at most once per 30 days.
select pg_temp.va('fe000000-0000-0000-0000-0000000000a1', 'practice', true, 'PHY 2012', now() - interval '1 day', 6);
select pg_temp.va('fe000000-0000-0000-0000-0000000000a1', 'daily_quiz', false, 'Daily Builder Quiz', now() - interval '2 days', 10);
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(cbt.voice_prompt('home') ->> 'prompt' = 'experience_rating', 'three completed sessions: overall rating invitation');
reset role;
update cbt.feedback_prompts set shown_at = now() - interval '10 days' where user_id = 'fe000000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(coalesce(cbt.voice_prompt('home') ->> 'prompt', '') <> 'experience_rating', 'rating prompt not repeated within 30 days');
reset role;
delete from cbt.feedback_prompts where user_id = 'fe000000-0000-0000-0000-0000000000a1' and prompt <> 'experience_rating';
update cbt.feedback_prompts set shown_at = now() - interval '10 days' where user_id = 'fe000000-0000-0000-0000-0000000000a1';

-- Guests are never prompted and cannot submit.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a3'); set request.jwt.claim.is_anonymous = 'true';
select pg_temp.check(cbt.voice_prompt('home') is null, 'guests are never prompted');
do $$ begin perform cbt.voice_submit_feedback('{"id":"fe100000-0000-0000-0000-000000000099","category":"overall","rating":5,"trigger":"voluntary"}');
  raise exception 'FAIL: guest submitted feedback'; exception when sqlstate '28000' then raise notice 'ok  guests cannot submit feedback'; end $$;
reset request.jwt.claim.is_anonymous;

-- ── feedback ──
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check((cbt.voice_submit_feedback('{"id":"fe100000-0000-0000-0000-000000000001","category":"overall","rating":2,"trigger":"rating_prompt","prompt":"experience_rating","body":"Too slow on my phone, call me 0803 333 4444 or ada@mail.com"}') ->> 'ok')::boolean,
                     'student submits a star rating');
select pg_temp.check((cbt.voice_submit_feedback('{"id":"fe100000-0000-0000-0000-000000000001","category":"overall","rating":2,"trigger":"rating_prompt"}') ->> 'duplicate')::boolean,
                     'a resent submission (slow network) is accepted once, not duplicated');
select pg_temp.check((cbt.voice_add_detail('fe100000-0000-0000-0000-000000000001', '["speed","bogus"]', 'ignored because body exists') ->> 'ok')::boolean, 'low rating accepts one follow-up');
select pg_temp.check((cbt.voice_submit_feedback(jsonb_build_object('id','fe100000-0000-0000-0000-000000000002','category','practice','helpful','not','reasons',jsonb_build_array('unclear','weak_explanations'),
                       'trigger','practice_prompt','prompt','practice_helpful','attempt_id',(select real_a from ids))) ->> 'ok')::boolean, 'student submits contextual practice feedback');
select pg_temp.check((cbt.voice_submit_feedback(jsonb_build_object('id','fe100000-0000-0000-0000-000000000003','category','technical','body','Leaderboard would not load',
                       'trigger','voluntary','attempt_id',(select bayo_a from ids))) ->> 'ok')::boolean, 'voluntary problem report');
do $$ begin perform cbt.voice_submit_feedback('{"id":"fe100000-0000-0000-0000-000000000004","category":"overall","trigger":"voluntary"}');
  raise exception 'FAIL: rating flow without stars'; exception when sqlstate '22023' then raise notice 'ok  the rating flow requires a star rating'; end $$;
reset role;
select pg_temp.check((select body from cbt.feedback where id = 'fe100000-0000-0000-0000-000000000001') !~ '0803|ada@mail' , 'phone numbers and emails are removed from feedback text');
select pg_temp.check((select reasons = '{speed}' from cbt.feedback where id = 'fe100000-0000-0000-0000-000000000001'), 'only allowed reasons are stored');
select pg_temp.check((select attempt_id is null from cbt.feedback where id = 'fe100000-0000-0000-0000-000000000003'), 'a link to another student''s attempt is dropped');
select pg_temp.check((select feature = 'topic_practice' and attempt_id is not null from cbt.feedback where id = 'fe100000-0000-0000-0000-000000000002'), 'practice feedback carries the feature and attempt, not question text');
select pg_temp.check((select responded_at is not null from cbt.feedback_prompts where user_id = 'fe000000-0000-0000-0000-0000000000a1' and prompt = 'experience_rating'), 'answering the rating prompt marks it responded');
select pg_temp.check((select count(*) = 1 from cbt.events where name = 'experience_rating_submitted' and user_id = 'fe000000-0000-0000-0000-0000000000a1'), 'one rating event, even after a resend');
select pg_temp.check((select count(*) = 0 from cbt.events where name like '%feedback%' and props::text ~* 'slow|leaderboard'), 'no feedback text in analytics events');
-- After rating, no rating prompt for 30 days even if the prompt row ages.
update cbt.feedback_prompts set shown_at = now() - interval '40 days' where user_id = 'fe000000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(coalesce(cbt.voice_prompt('home') ->> 'prompt', '') <> 'experience_rating', 'a student who rated is not asked again within 30 days');
reset role;

-- Students cannot read the tables or other students' feedback.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a2');
do $$ begin perform 1 from cbt.feedback; raise exception 'FAIL: student read cbt.feedback'; exception when insufficient_privilege then raise notice 'ok  feedback table is closed to students'; end $$;
do $$ begin perform 1 from cbt.testimonials; raise exception 'FAIL: student read cbt.testimonials'; exception when insufficient_privilege then raise notice 'ok  testimonials table is closed to students'; end $$;
do $$ begin update cbt.testimonials set status = 'approved'; raise exception 'FAIL: student updated testimonials'; exception when insufficient_privilege then raise notice 'ok  students cannot approve testimonials directly'; end $$;
select pg_temp.check(jsonb_array_length(cbt.my_voice() -> 'feedback') = 0, 'Bayo sees none of Ada''s feedback');
-- Bayo cannot reuse Ada's feedback id to probe or overwrite it.
do $$ begin perform cbt.voice_submit_feedback('{"id":"fe100000-0000-0000-0000-000000000001","category":"general","body":"x hijack","trigger":"voluntary"}');
  raise exception 'FAIL: reused id'; exception when sqlstate '22023' then raise notice 'ok  another student''s feedback id is refused'; end $$;
select pg_temp.check(not (cbt.voice_add_detail('fe100000-0000-0000-0000-000000000001', '["other"]', 'hijack') ->> 'ok')::boolean, 'cannot add detail to someone else''s feedback');
reset role;
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check(jsonb_array_length(cbt.my_voice() -> 'feedback') = 3, 'Ada sees her own 3 submissions');
reset role;

-- ── testimonials ──
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
do $$ begin perform cbt.voice_submit_testimonial('{"id":"fe200000-0000-0000-0000-000000000001","body":"KAIRO made chemistry finally click for me.","display_mode":"first","consent":false}');
  raise exception 'FAIL: no consent'; exception when sqlstate '22023' then raise notice 'ok  a testimonial without explicit consent is refused'; end $$;
do $$ begin perform cbt.voice_submit_testimonial('{"id":"fe200000-0000-0000-0000-000000000001","body":"KAIRO made chemistry finally click for me.","display_mode":"first"}');
  raise exception 'FAIL: consent missing'; exception when sqlstate '22023' then raise notice 'ok  consent is never assumed when missing'; end $$;
select pg_temp.check((cbt.voice_submit_testimonial('{"id":"fe200000-0000-0000-0000-000000000001","body":"KAIRO made chemistry finally click for me. Text me 08011112222.","rating":5,"display_mode":"first","consent":true}') ->> 'ok')::boolean,
                     'student submits a testimonial with explicit consent');
reset role;
select pg_temp.check((select status = 'pending' and published_at is null from cbt.testimonials where id = 'fe200000-0000-0000-0000-000000000001'), 'testimonials start pending, never public by default');
select pg_temp.check(((cbt.public_reviews() ->> 'total')::int) = 0, 'unapproved testimonials never appear publicly');

-- Moderation is admin-only: students and editors are refused.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
do $$ begin perform cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000001', 'approve'); raise exception 'FAIL: student approved own review';
  exception when insufficient_privilege then raise notice 'ok  a student cannot approve their own testimonial'; end $$;
do $$ begin perform cbt.fi_voice_overview(current_date - 7, current_date); raise exception 'FAIL: student read analytics';
  exception when insufficient_privilege then raise notice 'ok  students cannot read Student Voice analytics'; end $$;
reset role;
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000e0');
do $$ begin perform cbt.fi_voice_testimonials('pending'); raise exception 'FAIL: editor moderated';
  exception when insufficient_privilege then raise notice 'ok  editors have no moderation access'; end $$;
do $$ begin perform cbt.fi_voice_feedback(current_date - 7, current_date); raise exception 'FAIL: editor explorer';
  exception when insufficient_privilege then raise notice 'ok  editors cannot open the feedback explorer'; end $$;
reset role;

-- Founder: suggest an edit → cannot publish until the student approves it.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
select cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000001', 'suggest_edit', 'trim contact', 'KAIRO made chemistry finally click for me.');
do $$ begin perform cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000001', 'approve'); raise exception 'FAIL: published unapproved edit';
  exception when sqlstate '55000' then raise notice 'ok  an edited version waits for the student''s approval'; end $$;
reset role;
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check((cbt.my_voice() -> 'testimonials' -> 0 ->> 'edit_status') = 'awaiting_student', 'the student sees the suggested edit');
select cbt.voice_answer_edit('fe200000-0000-0000-0000-000000000001', true);
reset role;
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
select pg_temp.check((cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000001', 'approve', 'good') ->> 'ok')::boolean, 'admin approves a testimonial');
reset role;
create temp table pub as select cbt.public_reviews() j;
select pg_temp.check((select (j ->> 'total')::int = 1 from pub), 'approved + consented review is public');
select pg_temp.check((select j -> 'reviews' -> 0 ->> 'body' = 'KAIRO made chemistry finally click for me.' from pub), 'the public sees the version the student approved');
select pg_temp.check((select j -> 'reviews' -> 0 ->> 'name' = 'Adaeze' from pub), 'first-name-only display');
select pg_temp.check((select (j -> 'reviews' -> 0 ->> 'verified')::boolean from pub), 'verified label only for a real practising account');
select pg_temp.check((select j::text !~* 'kairo-fixture|0801|08011112222|fe000000|user_id|email|phone|note' from pub), 'public reviews carry no contact details, ids or moderation notes');
-- Anonymous visitors can read public reviews (and only that).
set role anon;
select pg_temp.check(((cbt.public_reviews() ->> 'total')::int) = 1, 'signed-out visitors can read approved reviews');
do $$ begin perform cbt.my_voice(); raise exception 'FAIL: anon my_voice'; exception when insufficient_privilege then raise notice 'ok  anon cannot call private feedback functions'; end $$;
reset role;

-- Bayo: anonymous publication; the admin rejects one and the rating filter works.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a2');
select cbt.voice_submit_testimonial('{"id":"fe200000-0000-0000-0000-000000000002","body":"Buy followers cheap at spam dot com now!!!","display_mode":"anon","consent":true}');
select cbt.voice_submit_testimonial('{"id":"fe200000-0000-0000-0000-000000000003","body":"The daily quiz keeps me practising every single morning.","rating":4,"display_mode":"anon","consent":true}');
reset role;
select pg_temp.check((select status = 'withdrawn' from cbt.testimonials where id = 'fe200000-0000-0000-0000-000000000002'), 'a new submission replaces the one still pending');
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
do $$ begin perform cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000002', 'approve'); raise exception 'FAIL: published withdrawn';
  exception when insufficient_privilege then raise notice 'ok  a withdrawn review can never be published'; end $$;
select cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000003', 'approve');
select pg_temp.check((cbt.public_reviews(12, 0, 4) -> 'reviews' -> 0 ->> 'name') = 'KAIRO student', 'anonymous reviews show no name; rating filter works');
reset role;

-- Withdrawal takes a published review down at once.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a1');
select pg_temp.check((cbt.voice_withdraw_testimonial('fe200000-0000-0000-0000-000000000001') ->> 'changed')::boolean, 'student withdraws publication consent');
reset role;
select pg_temp.check(((cbt.public_reviews() ->> 'total')::int) = 1 and cbt.public_reviews()::text !~ 'chemistry', 'a withdrawn review disappears from public reviews');
select pg_temp.check((select count(*) >= 5 from cbt.voice_audit where entity = 'testimonial' and entity_id = 'fe200000-0000-0000-0000-000000000001'), 'consent and moderation trail is kept');
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
do $$ begin perform cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000001', 'approve'); raise exception 'FAIL: republished after withdrawal';
  exception when insufficient_privilege then raise notice 'ok  admin cannot republish after a withdrawal'; end $$;
select pg_temp.check((cbt.fi_voice_moderate('fe200000-0000-0000-0000-000000000003', 'hide', 'off-topic now') ->> 'ok')::boolean, 'admin hides a published review');
select pg_temp.check(((cbt.public_reviews() ->> 'total')::int) = 0, 'hidden reviews are not public');

-- ── founder analytics ──
create temp table ov as select cbt.fi_voice_overview(current_date - 7, current_date) j;
reset role;
select pg_temp.check((select (j -> 'ratings' ->> 'count')::int = (select count(*) from cbt.feedback where category = 'overall' and status <> 'deleted' and created_at >= current_date - 7) from ov), 'rating count matches the database');
select pg_temp.check((select (j -> 'ratings' ->> 'negative')::int = 1 and (j -> 'ratings' -> 'dist' -> 3 ->> 'n')::int = 1 and (j -> 'ratings' -> 'dist' -> 3 ->> 'stars')::int = 2 from ov), 'rating distribution matches records (one 2-star)');
select pg_temp.check((select (j -> 'response' ->> 'rating_shown')::int = 0 from ov), 'prompt exposure is counted by when it was shown (aged prompt is outside 7 days)');
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
create temp table ov60 as select cbt.fi_voice_overview(current_date - 60, current_date) j;
reset role;
select pg_temp.check((select (j -> 'response' ->> 'rating_shown')::int = 1 and (j -> 'response' ->> 'rating_answered')::int = 1 from ov60), 'response rate uses prompt exposure and answers');
select pg_temp.check((select (j ->> 'submissions')::int = 3 and (j -> 'helpful' ->> 'not')::int = 1 from ov), 'submission and helpfulness counts');
select pg_temp.check((select exists (select 1 from jsonb_array_elements(j -> 'themes') t where t ->> 'theme' = 'Technical problems' and (t ->> 'n')::int >= 1) from ov), 'keyword themes are backed by real records');
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
select pg_temp.check(((cbt.fi_voice_overview(current_date - 60, current_date - 30)) -> 'ratings' ->> 'count')::int = 0, 'date filter excludes records outside the period');
select pg_temp.check(((cbt.fi_voice_feedback(current_date - 7, current_date, '{"category":"technical"}')) ->> 'total')::int = 1, 'explorer filters by category');
select pg_temp.check((cbt.fi_voice_feedback(current_date - 7, current_date))::text !~ 'kairo-fixture|0803|Adaeze', 'explorer shows pseudonymous students, no contact details');
select pg_temp.check((cbt.fi_voice_identity('feedback', 'fe100000-0000-0000-0000-000000000003') ->> 'email') = 'voice.ada@kairo-fixture.ng', 'identity lookup works for the admin');
select cbt.fi_voice_set_feedback('fe100000-0000-0000-0000-000000000001', 'deleted', 'test');
select pg_temp.check(((cbt.fi_voice_overview(current_date - 7, current_date)) -> 'ratings' ->> 'count')::int = 0, 'deleted records leave the satisfaction average');
reset role;
select pg_temp.check((select count(*) = 1 from cbt.voice_audit where action = 'identity_viewed'), 'identity lookups are audited');

-- Settings are admin-adjustable and drive the limits.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
select pg_temp.check((cbt.fi_voice_set_settings('{"unsolicited_gap_days":14}') ->> 'unsolicited_gap_days')::int = 14, 'admin adjusts the prompt frequency');
select cbt.fi_voice_set_settings('{"unsolicited_gap_days":7}');
reset role;
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000e0');
do $$ begin perform cbt.fi_voice_set_settings('{"enabled":false}'); raise exception 'FAIL: editor changed settings';
  exception when insufficient_privilege then raise notice 'ok  editors cannot change prompt settings'; end $$;
reset role;

-- Founder Intelligence still works.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000f0');
select pg_temp.check(cbt.fi_overview(current_date - 7, current_date) ? 'current', 'existing Founder Intelligence overview still answers');
reset role;
-- Erasing a testimonial removes its text.
select pg_temp.as_user('fe000000-0000-0000-0000-0000000000a2');
select pg_temp.check((cbt.voice_delete_testimonial('fe200000-0000-0000-0000-000000000003') ->> 'ok')::boolean, 'student can erase their testimonial');
reset role;
select pg_temp.check(not exists (select 1 from cbt.testimonials where id = 'fe200000-0000-0000-0000-000000000003'), 'erased testimonial text is gone');
