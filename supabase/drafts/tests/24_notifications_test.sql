-- Behaviour tests for 20261127170000_cbt_notifications_and_mail.sql. Isolated fixtures only.
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.is_anonymous;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email, is_anonymous, email_confirmed_at) values
  ('fc000000-0000-0000-0000-0000000000a1', 'paid.mail@kairo-fixture.ng', false, now()),
  ('fc000000-0000-0000-0000-0000000000a2', 'free.mail@kairo-fixture.ng', false, now()),
  ('fc000000-0000-0000-0000-0000000000a3', 'unconfirmed.mail@kairo-fixture.ng', false, null),
  ('fc000000-0000-0000-0000-0000000000a4', null, true, null);
insert into cbt.profiles (id, full_name) values ('fc000000-0000-0000-0000-0000000000a2', 'Free Mail');
-- public.entitlements stand-in for the paid-student check (only if the website schema is absent here).
do $$ begin
  if to_regclass('public.entitlements') is null then
    create table public.entitlements (user_id uuid, resource_id text, is_active boolean, revoked_at timestamptz, expires_at timestamptz);
  end if;
end $$;
insert into public.entitlements (user_id, resource_id, is_active, revoked_at, expires_at)
values ('fc000000-0000-0000-0000-0000000000a1', 'cohort-core', true, null, now() + interval '30 days');

create temp table aud as select cbt.mail_audience('techmed_unpaid', 'classes', 'test-offer') j;
select pg_temp.check((select count(*) filter (where a ->> 'email' = 'free.mail@kairo-fixture.ng') = 1
                             and count(*) filter (where a ->> 'email' = 'paid.mail@kairo-fixture.ng') = 0
                             and count(*) filter (where a ->> 'email' = 'unconfirmed.mail@kairo-fixture.ng') = 0
                      from aud, jsonb_array_elements(j) a), 'unpaid audience: excludes paid students, unconfirmed addresses and guests');
select pg_temp.check((select count(*) = 1 from jsonb_array_elements(cbt.mail_audience('paid_students', 'classes', 'test-x')) a where a ->> 'email' = 'paid.mail@kairo-fixture.ng'), 'paid audience');

-- Unsubscribe with the signed token from the audience.
create temp table tok as select a ->> 'unsub' t, a ->> 'unsub_all' ta from aud, jsonb_array_elements(j) a where a ->> 'email' = 'free.mail@kairo-fixture.ng';
grant select on tok to anon;
set role anon;
select pg_temp.check(not (cbt.email_unsubscribe('fc000000-0000-0000-0000-0000000000a2.classes.000000000000000000000000') ->> 'ok')::boolean, 'a forged token is rejected');
select pg_temp.check(not (cbt.email_unsubscribe(replace((select t from tok), 'classes', 'recaps')) ->> 'ok')::boolean, 'a token cannot be moved to another category');
select pg_temp.check((cbt.email_unsubscribe((select t from tok)) ->> 'ok')::boolean, 'one-click unsubscribe works without signing in');
reset role;
select pg_temp.check((select count(*) = 0 from jsonb_array_elements(cbt.mail_audience('techmed_unpaid', 'classes', 'test-offer-2')) a where a ->> 'email' = 'free.mail@kairo-fixture.ng'), 'unsubscribed from classes: dropped from class emails');
select pg_temp.check((select count(*) = 1 from jsonb_array_elements(cbt.mail_audience('techmed_unpaid', 'recaps', 'test-recap')) a where a ->> 'email' = 'free.mail@kairo-fixture.ng'), '... but still gets weekly recaps');
set role anon;
select pg_temp.check((cbt.email_unsubscribe((select ta from tok)) ->> 'ok')::boolean, 'unsubscribe from all');
reset role;
select pg_temp.check((select count(*) = 0 from jsonb_array_elements(cbt.mail_audience('techmed_all', 'recaps', 'test-recap-2')) a where a ->> 'email' = 'free.mail@kairo-fixture.ng'), 'unsubscribed from all: no emails at all');

-- Send log: a campaign never goes to the same person twice.
select cbt.mail_logged('test-paid', 'fc000000-0000-0000-0000-0000000000a1', 'paid.mail@kairo-fixture.ng', 'sent');
select pg_temp.check((select count(*) = 0 from jsonb_array_elements(cbt.mail_audience('paid_students', 'classes', 'test-paid')) a where a ->> 'email' = 'paid.mail@kairo-fixture.ng'), 'already sent: not in the audience again');

-- Student settings.
set role authenticated; set request.jwt.claim.sub = 'fc000000-0000-0000-0000-0000000000a2';
select pg_temp.check((cbt.my_notification_prefs() ->> 'email_all_off')::boolean, 'student sees their preferences');
select pg_temp.check(not (cbt.set_notification_prefs('{"email_all_off": false, "push_reminders": false}') ->> 'push_reminders')::boolean, 'student changes preferences');
do $$ begin perform cbt.mail_audience('techmed_all', 'classes', 'x'); raise exception 'FAIL: student read a mail audience';
exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from cbt.notification_prefs; raise exception 'FAIL: student read the prefs table';
exception when insufficient_privilege then null; end $$;
reset role; reset request.jwt.claim.sub;
select pg_temp.check((select cbt.push_allowed(array['fc000000-0000-0000-0000-0000000000a2'::uuid, 'fc000000-0000-0000-0000-0000000000a1'::uuid], 'reminders')
                      = array['fc000000-0000-0000-0000-0000000000a1'::uuid]), 'push opt-out respected for user-targeted pushes');

-- Placeholder/test domains never enter an audience (one bad address used to fail a whole batch).
insert into auth.users (id, email, is_anonymous, email_confirmed_at) values ('fc000000-0000-0000-0000-0000000000af', 'someone@example.com', false, now());
select pg_temp.check((select count(*) = 0 from jsonb_array_elements(cbt.mail_audience('techmed_all', 'classes', 'test-x')) a where a ->> 'email' = 'someone@example.com'), 'test domains are excluded from audiences');
-- Schedules exist for classes, recaps and the offer drip.
select pg_temp.check((select count(*) = 8 from cron.job where jobname in ('kairo-class-session','kairo-recap-week-build','kairo-recap-week-send','kairo-recap-week-retry','kairo-recap-month-build','kairo-recap-month-send','kairo-recap-month-retry','kairo-class-offer-drip')), 'mail and class schedules are registered');
