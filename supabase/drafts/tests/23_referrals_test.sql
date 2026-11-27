-- Behaviour tests for 20261127150000_cbt_proudly_kairo_referrals.sql (PROUDLY KAIRO). Isolated fixtures only.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create or replace function pg_temp.as_user(p uuid, p_anon boolean default false) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, false); perform set_config('request.jwt.claim.is_anonymous', p_anon::text, false); end $$;

-- People: referrer Rita (old account), friends F1..F6 (new), Ezra (old account), a guest, the founder.
insert into auth.users (id, email, is_anonymous, created_at) values
  ('fb000000-0000-0000-0000-0000000000a0', 'founder.ref@example.com', false, now() - interval '90 days'),
  ('fb000000-0000-0000-0000-0000000000a1', 'rita.ref@gmail.com',      false, now() - interval '60 days'),
  ('fb000000-0000-0000-0000-0000000000b1', 'f1.ref@example.com',      false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000b2', 'Rita.Ref+kairo@gmail.com', false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000b3', 'f3.ref@example.com',      false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000b4', 'f4.ref@example.com',      false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000b5', 'f5.ref@example.com',      false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000b6', 'f6.ref@example.com',      false, now() - interval '1 day'),
  ('fb000000-0000-0000-0000-0000000000c1', 'ezra.ref@example.com',    false, now() - interval '30 days'),
  ('fb000000-0000-0000-0000-0000000000d1', null,                       true,  now() - interval '1 hour');
insert into cbt.profiles (id, full_name, role) values
  ('fb000000-0000-0000-0000-0000000000a0', 'Founder Ref', 'admin'),
  ('fb000000-0000-0000-0000-0000000000a1', 'Rita Okafor', 'student'),
  ('fb000000-0000-0000-0000-0000000000b1', 'Femi One', 'student'), ('fb000000-0000-0000-0000-0000000000b2', 'Second Rita', 'student'),
  ('fb000000-0000-0000-0000-0000000000b3', 'Femi Three', 'student'), ('fb000000-0000-0000-0000-0000000000b4', 'Femi Four', 'student'),
  ('fb000000-0000-0000-0000-0000000000b5', 'Femi Five', 'student'), ('fb000000-0000-0000-0000-0000000000b6', 'Femi Six', 'student'),
  ('fb000000-0000-0000-0000-0000000000c1', 'Ezra Old', 'student'), ('fb000000-0000-0000-0000-0000000000d1', '', 'student');

do $$
declare i int; qid uuid; v_subject smallint := (select id from cbt.subjects where code = 'PHY');
begin
  for i in 1..15 loop
    qid := ('23000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into cbt.questions (id, source_ref, subject_id, stem, options, content_hash)
    values (qid, 'ref:' || i, v_subject, 'ref q' || i, '[{"key":"A","html":"a"},{"key":"B","html":"b"},{"key":"C","html":"c"},{"key":"D","html":"d"}]', 'ref' || i);
    insert into cbt.question_keys (question_id, correct_option, explanation) values (qid, 'A', 'because');
    update cbt.questions set status = 'published' where id = qid;
  end loop;
end $$;
create temp table rpool as
  select row_number() over (order by q.id) n, v.question_id, v.version
  from cbt.questions q join lateral (select * from cbt.question_versions v where v.question_id = q.id order by version desc limit 1) v on true
  where q.source_ref like 'ref:%';
create or replace function pg_temp.play(p_uid uuid, p_at timestamptz, qn int, p_final boolean default true) returns uuid language plpgsql as $$
declare a uuid := gen_random_uuid(); t uuid := gen_random_uuid();
begin
  insert into cbt.assessments (id, type, title, status, personal) values (a, 'practice', 'Mixed practice', 'live', true);
  insert into cbt.attempts (id, user_id, assessment_id, origin, started_at, submitted_at, server_received_at, status)
  values (t, p_uid, a, 'online', p_at, case when p_final then p_at + interval '9 minutes' end, case when p_final then p_at + interval '9 minutes' end,
          case when p_final then 'final' else 'in_progress' end::cbt.attempt_status);
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option)
  select t, question_id, version, case when n <= qn then 'A' end from rpool where n <= qn + 2;
  return t;
end $$;

-- ── Codes ──
set role authenticated; select pg_temp.as_user('fb000000-0000-0000-0000-0000000000a1');
create temp table rita as select cbt.my_referrals() j;
select pg_temp.check((select j ->> 'code' ~ '^RITA[A-HJ-NP-Z2-9]{4}$' from rita), 'Rita gets a code from her first name: RITA + 4 unambiguous characters');
select pg_temp.check((select (cbt.my_referrals() ->> 'code') = (j ->> 'code') from rita), 'the code is stable');
reset role;
create temp table code as select referral_code c from cbt.profiles where id = 'fb000000-0000-0000-0000-0000000000a1';
grant select on code to anon, authenticated;
select pg_temp.check(cbt._ref_code_for('fb000000-0000-0000-0000-0000000000c1') ~ '^EZRA[A-HJ-NP-Z2-9]{4}$', 'any signed-up student can be given a code');
select pg_temp.check(cbt._ref_new_code('') ~ '^KAIRO[A-HJ-NP-Z2-9]{4}$', 'no usable name: KAIRO prefix');
set role authenticated; select pg_temp.as_user('fb000000-0000-0000-0000-0000000000d1', true);
select pg_temp.check(cbt.my_referrals() is null, 'guests have no referral dashboard');
reset role;
select pg_temp.check((select referral_code is null from cbt.profiles where id = 'fb000000-0000-0000-0000-0000000000d1'), 'guests get no code');

-- ── Visits ──
set role anon; reset request.jwt.claim.sub;
select pg_temp.check((cbt.referral_visit((select c from code), 'dev-x') ->> 'valid')::boolean, 'a signed-out visitor can open a referral link');
select pg_temp.check((cbt.referral_visit(lower((select c from code)), 'dev-x') ->> 'referrer_first_name') = 'Rita', 'codes are case-insensitive; the landing can say who invited you');
select pg_temp.check(not (cbt.referral_visit('NOPE99', 'dev-x') ->> 'valid')::boolean, 'unknown code: not valid');
select pg_temp.check(not (cbt.referral_visit('<script>', 'dev-x') ->> 'valid')::boolean, 'malformed code rejected');
select cbt.referral_visit((select c from code), 'dev-y');
reset role;
select pg_temp.check((select count(*) = 2 and count(distinct anon_id) = 2 from cbt.referral_visits where code = (select c from code)), 'repeat opens from one install within an hour count once');

-- ── Attribution ──
set role authenticated;
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b1');
select pg_temp.check(cbt.claim_referral((select c from code), 'dev-x', 'link') ->> 'status' = 'recorded', 'a brand-new student is attributed to Rita');
select pg_temp.check(cbt.claim_referral((select c from code), 'dev-x', 'link') ->> 'status' = 'already_referred', 'the same referral cannot be recorded twice');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000a1');
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'self_referral', 'Rita cannot refer herself');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b2');
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'self_referral', 'a second account with Rita''s Gmail (dots/+tag) is a self-referral');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000c1');
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'existing_account', 'an existing (30-day-old) account is not a new referral');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000d1', true);
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'not_signed_in', 'guests cannot be attributed until they register');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b4');
select pg_temp.check(cbt.claim_referral('ZZZZ2222') ->> 'status' = 'invalid_code', 'unknown code is rejected');
-- First touch: F1 cannot be moved to another referrer (F4 will have a code).
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'recorded', 'F4 is attributed to Rita');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b1');
select pg_temp.check(cbt.claim_referral((select referral_code from cbt.profiles where id = 'fb000000-0000-0000-0000-0000000000b4')) ->> 'status' = 'already_referred',
  'first touch wins: a second code never moves a referral');
-- Circular: F4 (referred by Rita) cannot then "refer" Rita... Rita is old anyway; F5 referred by F4, then F4 by F5 is blocked.
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b5');
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'recorded', 'F5 is attributed to Rita');
reset role;
-- Same device as the referrer → flagged, not counted until approved.
insert into cbt.events (id, user_id, anon_id, name) values (gen_random_uuid(), 'fb000000-0000-0000-0000-0000000000a1', 'rita-phone', 'page_viewed');
set role authenticated; select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b3');
select pg_temp.check(cbt.claim_referral((select c from code), 'rita-phone') ->> 'status' = 'under_review', 'a sign-up from the referrer''s own device is flagged for review');
-- Students cannot touch referral data or badges directly.
do $$ begin insert into cbt.user_badges (user_id, badge_code) values ('fb000000-0000-0000-0000-0000000000b3', 'ref_50'); raise exception 'FAIL: client granted a badge';
exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from cbt.referrals; raise exception 'FAIL: client read referrals';
exception when insufficient_privilege then null; end $$;
do $$ begin update cbt.referrals set status = 'valid'; raise exception 'FAIL: client changed referrals';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt._ref_refresh(null); raise exception 'FAIL: client called the refresh';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt.referral_tick(); raise exception 'FAIL: client called the notifier';
exception when insufficient_privilege then null; end $$;
reset role;

-- ── Activation (authoritative learning records) ──
select pg_temp.play('fb000000-0000-0000-0000-0000000000b1', now() - interval '20 hours', 9);
select cbt._ref_refresh(null);
select pg_temp.check((select activated_at is null from cbt.referrals where referred_id = 'fb000000-0000-0000-0000-0000000000b1'), '9 answered questions do not activate');
select pg_temp.play('fb000000-0000-0000-0000-0000000000b4', now() - interval '20 hours', 12, false);
select cbt._ref_refresh(null);
select pg_temp.check((select activated_at is null from cbt.referrals where referred_id = 'fb000000-0000-0000-0000-0000000000b4'), 'an unfinished session does not activate');
select pg_temp.play('fb000000-0000-0000-0000-0000000000b1', now() - interval '19 hours', 10);
create temp table aw1 as select * from cbt._ref_refresh(null);
select pg_temp.check((select activated_at is not null from cbt.referrals where referred_id = 'fb000000-0000-0000-0000-0000000000b1'), '10 answered questions in a finished session activate');
select pg_temp.check((select count(*) = 1 and bool_and(badge_code = 'ref_1' and user_id = 'fb000000-0000-0000-0000-0000000000a1') from aw1), 'Rita earns Proud KAIRO User at 1 activated referral');
select pg_temp.check((select count(*) = 0 from cbt._ref_refresh(null)), 'running again awards nothing new (once only)');
select pg_temp.check((select count(*) = 1 from cbt.referral_notices where user_id = 'fb000000-0000-0000-0000-0000000000a1'), 'one notice for one badge');
-- XP: referral badges add nothing to the academic board.
select pg_temp.check((select count(*) = 0 from cbt._xp_events('fb000000-0000-0000-0000-0000000000a1') where kind = 'badge'), 'referral badges earn no XP');
select pg_temp.check((select count(*) = 1 from cbt.user_badges where user_id = 'fb000000-0000-0000-0000-0000000000a1' and badge_code = 'ref_1'), 'the badge is recorded in the existing achievements');

-- Retention: learning again on a later Lagos day.
select pg_temp.play('fb000000-0000-0000-0000-0000000000b1', now() + interval '1 day', 3, false);
select cbt._ref_refresh(null);
select pg_temp.check((select retained_at is not null from cbt.referrals where referred_id = 'fb000000-0000-0000-0000-0000000000b1'), 'learning on a later Lagos day = retained');

-- Rita practises too (so she is on the academic XP board).
select pg_temp.play('fb000000-0000-0000-0000-0000000000a1', now() - interval '6 hours', 12);

-- Flagged F3 activates but does not count; F4 + F5 activate → 3 → Advocate.
select pg_temp.play('fb000000-0000-0000-0000-0000000000b3', now() - interval '5 hours', 10);
select pg_temp.play('fb000000-0000-0000-0000-0000000000b4', now() - interval '4 hours', 11);
select cbt._ref_refresh(null);
select pg_temp.check((select count(*) = 1 from cbt.user_badges where user_id = 'fb000000-0000-0000-0000-0000000000a1' and badge_code like 'ref_%'), 'flagged referral not counted: still 2 activated, no Advocate yet');
select pg_temp.play('fb000000-0000-0000-0000-0000000000b5', now() - interval '3 hours', 15);
select cbt._ref_refresh(null);
select pg_temp.check((select array_agg(badge_code order by badge_code) = array['ref_1','ref_3'] from cbt.user_badges where user_id = 'fb000000-0000-0000-0000-0000000000a1' and badge_code like 'ref_%'),
  '3 activated → KAIRO Advocate; Ambassador (5) not yet');

set role authenticated; select pg_temp.as_user('fb000000-0000-0000-0000-0000000000a1');
create temp table rita2 as select cbt.my_referrals() j;
select pg_temp.check((select (j -> 'stats' ->> 'activated')::int = 3 and (j -> 'stats' ->> 'registrations')::int = 3 and (j -> 'stats' ->> 'retained')::int = 1
                             and (j -> 'stats' ->> 'under_review')::int = 1 and (j -> 'stats' ->> 'visits')::int = 2 from rita2), 'Rita''s numbers: 2 visits, 3 registered, 3 activated, 1 retained, 1 under review');
select pg_temp.check((select j ->> 'level' = 'ref_3' and j -> 'next' ->> 'code' = 'ref_5' and (j -> 'next' ->> 'remaining')::int = 2 from rita2), 'progress: Advocate, 2 more to Ambassador');
select pg_temp.check((select jsonb_array_length(j -> 'celebrate') = 2 from rita2), 'two badges waiting to be celebrated');
select pg_temp.check((select not (j::text ~ 'example.com') and not (j::text ~ 'Femi') from rita2), 'Rita sees no names or emails of the friends she referred');
select cbt.referral_celebrated(array['ref_1', 'ref_3']);
select pg_temp.check(jsonb_array_length(cbt.referral_celebrations()) = 0, 'celebrated once: never again');
create temp table board as select cbt.referral_board('all', 50, 0) j;
select pg_temp.check((select (j -> 'me' ->> 'rank')::int = 1 and (j -> 'me' ->> 'activated')::int = 3 and j -> 'me' ->> 'badge' = 'ref_3' from board), 'Rita leads the Ambassadors board with 3');
select pg_temp.check((select j -> 'rows' -> 0 ->> 'name' = 'Rita O.' and not (j::text ~ 'example.com') from board), 'board names are "First L." with no contact details');
select pg_temp.check((select (j -> 'top_ambassador' ->> 'value')::int = 3 from (select cbt.referral_month() j) x), 'monthly recognition: top ambassador this month');
select pg_temp.check((select r ->> 'ref' = 'ref_3' from jsonb_array_elements(cbt.xp_board('all', 100) -> 'rows') r where r ->> 'name' = 'Rita O.'), 'academic board shows Rita''s referral badge marker');
do $$ begin perform cbt.fi_referrals(current_date - 7, current_date); raise exception 'FAIL: a student read referral intelligence';
exception when insufficient_privilege then null; end $$;
do $$ begin perform cbt.fi_referral_set(false); raise exception 'FAIL: a student paused the programme';
exception when insufficient_privilege then null; end $$;

-- ── Founder ──
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000a0');
create temp table fr as select cbt.fi_referrals(current_date - 7, current_date) j;
select pg_temp.check((select (j -> 'totals' ->> 'registrations')::int >= 3 and (j -> 'totals' ->> 'activated')::int >= 3 and (j -> 'totals' ->> 'flagged')::int >= 1 from fr), 'founder sees registrations, activations and flagged referrals');
select pg_temp.check((select (b ->> 'holders')::int >= 1 from fr, jsonb_array_elements(j -> 'badges') b where b ->> 'code' = 'ref_3'), 'badge distribution');
select pg_temp.check((select t ->> 'name' = 'Rita Okafor' and (t ->> 'activated')::int = 3 from fr, jsonb_array_elements(j -> 'top_referrers') t where t ->> 'code' = (select c from code)), 'top referrers with names for the founder');
-- Approve the flagged one → it counts (4 activated).
select cbt.fi_referral_review('fb000000-0000-0000-0000-0000000000b3', 'valid', 'checked: classmate');
select pg_temp.check(((select cbt.my_referrals()) is not null), 'founder can also open their own dashboard');
-- Pause: new referrals refused, existing kept.
select pg_temp.check((cbt.fi_referral_set(false) ->> 'enabled')::boolean = false, 'founder can pause the programme');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000b6');
select pg_temp.check(cbt.claim_referral((select c from code)) ->> 'status' = 'paused', 'while paused, new referrals are not recorded');
select pg_temp.as_user('fb000000-0000-0000-0000-0000000000a0');
select cbt.fi_referral_set(true);
reset role;
select pg_temp.check((select count(*) = 4 from cbt.referrals where referrer_id = 'fb000000-0000-0000-0000-0000000000a1' and status = 'valid' and activated_at is not null), 'approved referral now counts: 4 activated');
-- Raising a threshold never revokes an earned badge.
update cbt.badges set goal = 4 where code = 'ref_3';
select cbt._ref_refresh(null);
update cbt.badges set goal = 99 where code = 'ref_3';
select cbt._ref_refresh(null);
select pg_temp.check((select count(*) = 1 from cbt.user_badges where user_id = 'fb000000-0000-0000-0000-0000000000a1' and badge_code = 'ref_3'), 'changing a threshold never removes an earned badge');
update cbt.badges set goal = 3 where code = 'ref_3';
-- Notifier: one push/email per badge.
create temp table tick as select cbt.referral_tick() j;
select pg_temp.check((select count(*) = 2 from tick, jsonb_array_elements(j) n where n ->> 'user_id' = 'fb000000-0000-0000-0000-0000000000a1'), 'two badge notices are waiting for Rita');
select cbt.referral_notice_done('fb000000-0000-0000-0000-0000000000a1', 'ref_1', 'push');
select cbt.referral_notice_done('fb000000-0000-0000-0000-0000000000a1', 'ref_1', 'email');
select pg_temp.check((select count(*) = 1 from jsonb_array_elements(cbt.referral_tick()) n where n ->> 'user_id' = 'fb000000-0000-0000-0000-0000000000a1'), 'a notice is sent once per channel');
select pg_temp.check((select count(*) >= 1 from jsonb_array_elements(cbt.referral_launch_audience()) a where a ->> 'code' = (select c from code)), 'launch audience carries each student''s own code');
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
