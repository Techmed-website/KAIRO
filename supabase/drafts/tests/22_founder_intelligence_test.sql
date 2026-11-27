-- Behaviour tests for 20261127120000_cbt_founder_intelligence.sql. Run after 21. Isolated fixtures only (October 2026).
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

-- People: the founder (admin), an editor, three students and a guest.
insert into auth.users (id, email, is_anonymous) values
  ('fa000000-0000-0000-0000-0000000000f0', 'founder@example.com', false),
  ('fa000000-0000-0000-0000-0000000000f9', 'editor@example.com', false),
  ('fa000000-0000-0000-0000-0000000000f1', 'ada.fi@example.com', false),
  ('fa000000-0000-0000-0000-0000000000f2', 'bayo@example.com', false),
  ('fa000000-0000-0000-0000-0000000000f3', 'chi@example.com', false),
  ('fa000000-0000-0000-0000-0000000000f4', null, true);
insert into cbt.profiles (id, full_name, role, created_at) values
  ('fa000000-0000-0000-0000-0000000000f0', 'Founder', 'admin', '2026-09-01 09:00+01'),
  ('fa000000-0000-0000-0000-0000000000f9', 'Editor', 'editor', '2026-09-01 09:00+01'),
  ('fa000000-0000-0000-0000-0000000000f1', 'Ada', 'student', '2026-10-01 09:00+01'),
  ('fa000000-0000-0000-0000-0000000000f2', 'Bayo', 'student', '2026-10-01 23:30+01'),   -- 22:30 UTC: still 1 Oct in Lagos
  ('fa000000-0000-0000-0000-0000000000f3', 'Chi', 'student', '2026-10-01 12:00+01'),
  ('fa000000-0000-0000-0000-0000000000f4', 'Guest', 'student', '2026-10-02 08:00+01');

do $$
declare i int; qid uuid; v_subject smallint := (select id from cbt.subjects where code = 'BIO');
begin
  for i in 1..20 loop
    qid := ('22000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into cbt.questions (id, source_ref, subject_id, stem, options, content_hash)
    values (qid, 'fi:' || i, v_subject, 'fi q' || i, '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 'fi' || i);
    insert into cbt.question_keys (question_id, correct_option, explanation) values (qid, 'A', 'because');
    update cbt.questions set status = 'published' where id = qid;
  end loop;
end $$;
create temp table fpool as
  select row_number() over (order by q.id) n, v.question_id, v.version
  from cbt.questions q join lateral (select * from cbt.question_versions v where v.question_id = q.id order by version desc limit 1) v on true
  where q.source_ref like 'fi:%';
select pg_temp.check((select count(*) = 20 from fpool), '20 questions to answer');

-- One attempt with qn answered questions (+ 2 unanswered rows, which must not count). Finished unless p_final is false.
create or replace function pg_temp.fa(p_uid uuid, p_type text, p_personal boolean, p_title text, p_at timestamptz, qn int, p_final boolean default true)
returns uuid language plpgsql as $$
declare a uuid := gen_random_uuid(); t uuid := gen_random_uuid();
begin
  insert into cbt.assessments (id, type, title, status, personal) values (a, p_type::cbt.assessment_type, p_title, 'live', p_personal);
  insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status)
  values (t, p_uid, a, 'online', p_at, case when p_final then p_at + interval '10 minutes' end,
          case when p_final then p_at + interval '10 minutes' end, case when p_final then 'final' else 'in_progress' end::cbt.attempt_status);
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option)
  select t, question_id, version, case when n <= qn then 'A' end from fpool where n <= qn + 2;
  return t;
end $$;

-- Ada: topic practice on 1 Oct (12 answers), daily quiz on 2 Oct (10), year practice on 8 Oct (5): returns on D1 and D7.
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f1', 'practice', true, 'BIO topic practice', '2026-10-01 10:00+01', 12);
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f1', 'daily_quiz', false, 'Daily Builder Quiz', '2026-10-02 06:30+01', 10);
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f1', 'practice', true, 'BIO 2010', '2026-10-08 18:00+01', 5);
-- Bayo: starts mixed practice at 00:30 Lagos on 2 Oct (23:30 UTC on 1 Oct), answers 3 and never finishes.
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f2', 'practice', true, 'Mixed practice', '2026-10-02 00:30+01', 3, false);
-- The guest plays the daily quiz; the editor practises. Neither is a student for these reports.
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f4', 'daily_quiz', false, 'Daily Builder Quiz', '2026-10-02 08:05+01', 10);
select pg_temp.fa('fa000000-0000-0000-0000-0000000000f9', 'practice', true, 'CHM topic practice', '2026-10-02 09:00+01', 20);
-- Chi only looks around (page views): never "active".
insert into cbt.events (id, user_id, session_id, name, feature, path, created_at) values
  (gen_random_uuid(), 'fa000000-0000-0000-0000-0000000000f3', 's-chi', 'page_viewed', 'leaderboard', '/leaderboard', '2026-10-01 12:05+01'),
  (gen_random_uuid(), 'fa000000-0000-0000-0000-0000000000f3', 's-chi', 'page_viewed', 'home', '/', '2026-10-01 12:01+01'),
  (gen_random_uuid(), 'fa000000-0000-0000-0000-0000000000f3', 's-chi', 'user_login', null, '/', '2026-10-02 12:01+01');

-- Phone captured at TECHMED sign-up (auth metadata) is used when the KAIRO profile has none.
update auth.users set raw_user_meta_data = '{"phone":"08030000002"}' where id = 'fa000000-0000-0000-0000-0000000000f2';
-- Helpers
select pg_temp.check(cbt._fi_day('2026-10-01 23:30+00') = '2026-10-02', '23:30 UTC is already the next Lagos day');
select pg_temp.check(cbt._fi_feature('practice', true, 'BIO 2010') = 'year_practice' and cbt._fi_feature('practice', true, 'PHY topic practice') = 'topic_practice'
  and cbt._fi_feature('practice', true, 'Mixed practice') = 'custom_practice' and cbt._fi_feature('mock', true, 'JAMB mock') = 'mock'
  and cbt._fi_feature('practice', true, 'Retry: BIO 2010') = 'review_retry' and cbt._fi_feature('daily_quiz', false, 'x') = 'daily_quiz'
  and cbt._fi_feature('challenge', false, 'x') = 'challenge', 'practice modes are told apart from their titles');
select pg_temp.check(cbt._fi_code('fa000000-0000-0000-0000-0000000000f1') ~ '^S-[0-9A-F]{6}$', 'privacy-safe student code');

-- ── Access ──
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f1';
do $$ begin perform cbt.fi_overview('2026-10-01', '2026-10-02'); raise exception 'FAIL: a student read the founder overview';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt.fi_students('all', null, 50, 0); raise exception 'FAIL: a student read the student explorer';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt._fi_kpis('2026-10-01', '2026-10-02'); raise exception 'FAIL: a student called a private helper';
exception when insufficient_privilege then null; end $$;
select pg_temp.check((select count(*) = 0 from cbt.events), 'students cannot read the events table');
select pg_temp.check(not cbt.is_admin(), 'a student is not an admin');
reset role; set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f9';
do $$ begin perform cbt.fi_feed(null, 10, null, null, null, null); raise exception 'FAIL: an editor read founder analytics';
exception when insufficient_privilege then null; end $$;
reset role; set role anon; reset request.jwt.claim.sub;
do $$ begin perform cbt.fi_overview('2026-10-01', '2026-10-02'); raise exception 'FAIL: anon read founder analytics';
exception when insufficient_privilege then null; end $$;
-- Signed-out visitors may only send page views (and get user_id null whatever they claim).
select pg_temp.check(cbt.track_events('[{"id":"9a000000-0000-4000-8000-000000000001","name":"page_viewed","feature":"landing","anon_id":"dev-1","user_id":"fa000000-0000-0000-0000-0000000000f1"},
                                 {"id":"9a000000-0000-4000-8000-000000000002","name":"offline_pack_downloaded","anon_id":"dev-1"}]') = 1,
  'signed out: only the page view is accepted');
reset role;
select pg_temp.check((select user_id is null and anon_id = 'dev-1' from cbt.events where id = '9a000000-0000-4000-8000-000000000001'), 'signed-out event cannot claim a user');

-- ── Tracking ──
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f2';
select pg_temp.check(cbt.track_events('[{"id":"9b000000-0000-4000-8000-000000000001","name":"page_viewed","feature":"offline","session_id":"s1","device":"mobile",
                                  "props":{"count":3,"email":"bayo@example.com","answer":"B","mode":"topic"}},
                                 {"id":"9b000000-0000-4000-8000-000000000002","name":"made_up_event"},
                                 {"id":"not-a-uuid","name":"page_viewed"},
                                 {"id":"9b000000-0000-4000-8000-000000000003","name":"page_viewed","feature":"not_a_feature","subject":"<b>x"}]') = 2,
  'unknown names and bad ids are dropped');
select pg_temp.check(cbt.track_events('[{"id":"9b000000-0000-4000-8000-000000000001","name":"page_viewed","feature":"offline"}]') = 0, 'a resent event is ignored (idempotent)');
select pg_temp.check(cbt.track_events('"oops"') = 0 and cbt.track_events(null) = 0, 'malformed payloads return 0, never an error');
reset role;
select pg_temp.check((select props = '{"count":3,"mode":"topic"}'::jsonb and user_id = 'fa000000-0000-0000-0000-0000000000f2' and device = 'mobile'
                      from cbt.events where id = '9b000000-0000-4000-8000-000000000001'), 'only allow-listed props are kept (email/answer dropped); user from the JWT');
select pg_temp.check((select feature is null and subject is null from cbt.events where id = '9b000000-0000-4000-8000-000000000003'), 'unknown feature and bad subject are nulled');
-- Rate limit: 600 events in 10 minutes, then quietly dropped.
insert into cbt.events (id, user_id, name) select gen_random_uuid(), 'fa000000-0000-0000-0000-0000000000f3', 'page_viewed' from generate_series(1, 600);
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f3';
select pg_temp.check(cbt.track_events('[{"id":"9c000000-0000-4000-8000-000000000001","name":"page_viewed"}]') = 0, 'rate limited after 600 events in 10 minutes');
reset role;
-- Remove the flood (page views carry no weight in activity anyway, but keep counts readable).
create temp table flood as select id from cbt.events where user_id = 'fa000000-0000-0000-0000-0000000000f3' and created_at > now() - interval '1 hour';
update cbt.events set created_at = '2026-09-01' where id in (select id from flood);

-- ── Founder reports ──
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f0';
select pg_temp.check(cbt.is_admin(), 'the founder is an admin');

create temp table o1 as select cbt.fi_overview('2026-10-01', '2026-10-01') j;
select pg_temp.check((select (j -> 'current' ->> 'registrations')::int = 3 from o1), '1 Oct: 3 registrations (23:30 Lagos counts on 1 Oct; staff and guest excluded)');
select pg_temp.check((select (j -> 'current' ->> 'active_users')::int = 1 from o1), '1 Oct: 1 active student (page views alone do not count)');
select pg_temp.check((select (j -> 'current' ->> 'questions')::int = 12 from o1), '1 Oct: 12 questions (unanswered rows not counted)');
select pg_temp.check((select (j -> 'current' ->> 'practice_started')::int = 1 and (j -> 'current' ->> 'practice_completed')::int = 1 from o1), '1 Oct: 1 practice started, 1 completed');

create temp table o2 as select cbt.fi_overview('2026-10-02', '2026-10-02') j;
select pg_temp.check((select (j -> 'current' ->> 'active_users')::int = 2 and (j -> 'current' ->> 'returning_users')::int = 1 from o2), '2 Oct: 2 active, 1 returning (Ada)');
select pg_temp.check((select (j -> 'current' ->> 'questions')::int = 13 from o2), '2 Oct: 10 quiz + 3 practice answers = 13 (editor and guest excluded)');
select pg_temp.check((select (j -> 'current' ->> 'quiz_started')::int = 1 and (j -> 'current' ->> 'quiz_completed')::int = 1
                             and (j -> 'current' ->> 'practice_started')::int = 1 and (j -> 'current' ->> 'practice_completed')::int = 0
                             and (j -> 'current' ->> 'practice_abandoned')::int = 1 from o2), '2 Oct: starts and completions are distinct; Bayo abandoned');
select pg_temp.check((select (j -> 'current' ->> 'guest_plays')::int = 1 from o2), 'guest plays are reported separately');
select pg_temp.check((select (j -> 'previous' ->> 'registrations')::int = 3 and j -> 'period' ->> 'prev_from' = '2026-10-01' from o2), 'previous equivalent period is the day before');

create temp table o3 as select cbt.fi_overview('2026-10-01', '2026-10-02') j;
select pg_temp.check((select (j -> 'current' ->> 'active_users')::int = 2 and (j -> 'current' ->> 'dau_avg')::numeric = 1.5
                             and (j -> 'current' ->> 'wau')::int = 2 from o3), '1–2 Oct: unique actives 2 (not 3 raw), average DAU 1.5, WAU 2');
select pg_temp.check((select jsonb_array_length(j -> 'series') = 2 and (j -> 'series' -> 0 ->> 'registrations')::int = 3
                             and (j -> 'series' -> 1 ->> 'returning')::int = 1 from o3), 'daily series');
-- Repeated events never inflate learning numbers: questions come from attempt answers only.
reset role;
insert into cbt.events (id, user_id, name, feature, created_at)
  select gen_random_uuid(), 'fa000000-0000-0000-0000-0000000000f1', 'question_answered', 'topic_practice', '2026-10-01 10:05+01' from generate_series(1, 25);
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f0';
select pg_temp.check((cbt.fi_overview('2026-10-01', '2026-10-01') -> 'current' ->> 'questions')::int = 12, 'client question events do not change the question count');

create temp table en as select cbt.fi_engagement('2026-10-01', '2026-10-08') j;
select pg_temp.check((select (c ->> 'size')::int = 3 and (c ->> 'd1')::int = 2 and (c ->> 'd7')::int = 1 and (c ->> 'd30')::int = 0 and (c ->> 'w7')::int = 2
                      from en, jsonb_array_elements(j -> 'cohorts') c where c ->> 'cohort' = '2026-10-01'), 'cohort 1 Oct: D1 2/3, D7 1/3, D30 0/3, within-7 2/3');
select pg_temp.check((select (d ->> 'dau')::int = 1 and (d ->> 'wau')::int = 2 from en, jsonb_array_elements(j -> 'daily') d where d ->> 'day' = '2026-10-08'),
  '8 Oct: DAU 1, rolling WAU 2');
select pg_temp.check((select (j -> 'summary' ->> 'engaged')::int = 1 from en), 'engaged learners: completed something and answered 10+');
-- An immature cohort reports nothing for D7/D30.
reset role;
insert into auth.users (id, email) values ('fa000000-0000-0000-0000-0000000000f5', 'new@example.com');
insert into cbt.profiles (id, full_name, created_at) values ('fa000000-0000-0000-0000-0000000000f5', 'New', now() - interval '2 days');
set role authenticated; set request.jwt.claim.sub = 'fa000000-0000-0000-0000-0000000000f0';
select pg_temp.check((select c -> 'd7' = 'null'::jsonb and c -> 'd30' = 'null'::jsonb and not (c ->> 'd7_mature')::boolean
                      from jsonb_array_elements(cbt.fi_engagement(cbt._fi_day(now()) - 3, cbt._fi_day(now())) -> 'cohorts') c
                      where (c ->> 'cohort')::date = cbt._fi_day(now() - interval '2 days')), 'immature cohorts: D7/D30 not reported');

create temp table fu as select cbt.fi_funnel('2026-10-01', '2026-10-01', 14) j;
select pg_temp.check((select string_agg(s ->> 'n', ',' order by ord) = '3,3,2,1,1,1' from fu, jsonb_array_elements(j -> 'stages') with ordinality x(s, ord)),
  'funnel: registered 3 → interacted 3 → started 2 → completed 1 → returned 1 → consistent 1');

create temp table fe as select cbt.fi_features('2026-10-01', '2026-10-08') j;
select pg_temp.check((select (f ->> 'starts')::int = 1 and (f ->> 'completions')::int = 1 and (f ->> 'users')::int = 1
                      from fe, jsonb_array_elements(j -> 'current') f where f ->> 'feature' = 'daily_quiz'), 'feature: daily quiz 1 start, 1 completion (guest excluded)');
select pg_temp.check((select (f ->> 'abandoned')::int = 1 and (f ->> 'completions')::int = 0
                      from fe, jsonb_array_elements(j -> 'current') f where f ->> 'feature' = 'custom_practice'), 'feature: custom practice abandoned once');
select pg_temp.check((select (f ->> 'opens')::int = 1 and f -> 'starts' = 'null'::jsonb
                      from fe, jsonb_array_elements(j -> 'current') f where f ->> 'feature' = 'leaderboard'), 'feature: leaderboard is view-only (1 open)');

select pg_temp.check((select count(*) filter (where r ->> 'student' in (cbt._fi_code('fa000000-0000-0000-0000-0000000000f1'), cbt._fi_code('fa000000-0000-0000-0000-0000000000f2'),
                                                                      cbt._fi_code('fa000000-0000-0000-0000-0000000000f3'), cbt._fi_code('fa000000-0000-0000-0000-0000000000f5'))) = 4
                             and count(*) filter (where r ->> 'student' in (cbt._fi_code('fa000000-0000-0000-0000-0000000000f0'), cbt._fi_code('fa000000-0000-0000-0000-0000000000f9'),
                                                                      cbt._fi_code('fa000000-0000-0000-0000-0000000000f4'))) = 0
                      from jsonb_array_elements(cbt.fi_students('all', null, 200, 0) -> 'rows') r), 'explorer lists the 4 students, not staff or guests');
select pg_temp.check((select r ->> 'student' = cbt._fi_code('fa000000-0000-0000-0000-0000000000f3') from jsonb_array_elements(cbt.fi_students('never_practised', null, 50, 0) -> 'rows') r
                      where r ->> 'student' = cbt._fi_code('fa000000-0000-0000-0000-0000000000f3')), 'segment: registered but never practised');
select pg_temp.check((select count(*) = 1 from jsonb_array_elements(cbt.fi_students('started_not_completed', null, 200, 0) -> 'rows') r
                      where r ->> 'student' in (cbt._fi_code('fa000000-0000-0000-0000-0000000000f1'), cbt._fi_code('fa000000-0000-0000-0000-0000000000f2'))
                        and r ->> 'student' = cbt._fi_code('fa000000-0000-0000-0000-0000000000f2')), 'segment: started but never completed (Bayo, not Ada)');
select pg_temp.check((select bool_and(r ->> 'full_name' = 'Ada' and r ->> 'email' = 'ada.fi@example.com') and count(*) = 1
                      from jsonb_array_elements(cbt.fi_students('all', 'ada.fi@example.com', 200, 0) -> 'rows') r),
  'the admin sees name and email for follow-ups, and can search by email');
select pg_temp.check((select r ->> 'phone' = '08030000002' and r ->> 'full_name' = 'Bayo' from jsonb_array_elements(cbt.fi_students('all', '08030000002', 200, 0) -> 'rows') r),
  'phone falls back to the TECHMED sign-up number, and is searchable');
select pg_temp.check((select jsonb_array_length(j -> 'timeline') >= 5 and (j -> 'by_feature' -> 0 ->> 'starts')::int >= 1
                      from (select cbt.fi_student('fa000000-0000-0000-0000-0000000000f1') j) x), 'student timeline');

create temp table fd as select cbt.fi_feed(null, 100, null, null, '2026-10-01', '2026-10-08') j;
select pg_temp.check((select count(*) filter (where i ->> 'kind' = 'registered') = 3 and count(*) filter (where i ->> 'kind' = 'completed') >= 3
                             and count(*) filter (where i ->> 'student' like 'G-%') >= 1 from fd, jsonb_array_elements(j -> 'items') i), 'feed: registrations, completions, guest marked G-');
select pg_temp.check((select not (j::text ~ 'example.com') from fd), 'feed carries names but not emails');
select pg_temp.check((select count(*) >= 1 from fd, jsonb_array_elements(j -> 'items') i where i ->> 'student_name' = 'Ada' and i ->> 'name' is not null and i ->> 'name' <> 'Ada'), 'feed shows the student name without hiding the event name');
select pg_temp.check((select jsonb_array_length(cbt.fi_feed(null, 5, array['started'], null, null, null) -> 'items') between 1 and 5), 'feed: bounded and filterable');
do $$ begin perform cbt.fi_overview('2026-10-02', '2026-10-01'); raise exception 'FAIL: reversed range accepted';
exception when invalid_parameter_value then null; end $$;
reset role; reset request.jwt.claim.sub;
