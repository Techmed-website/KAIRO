-- Automatic schedules for classes, recaps and the class-launch offer. Every send is idempotent (mail_log /
-- recaps.emailed_at), so repeated runs only pick up whoever is still waiting; this is how we live inside the
-- email provider's daily cap: a run that hits the cap stops and the next run continues.
create or replace function cbt._kairo_mail(p_body jsonb) returns bigint
language sql volatile security definer set search_path = cbt, pg_temp as $$
  select net.http_post(url := 'https://unbgborbhxzsotaieiun.supabase.co/functions/v1/kairo-mail', body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-techmed-notify', (select value from public.app_secrets where name = 'notify_hook_secret')),
    timeout_milliseconds := 120000) $$;
revoke execute on function cbt._kairo_mail(jsonb) from public, anon, authenticated;

do $$ declare j text; begin
  foreach j in array array['kairo-class-session','kairo-recap-week-build','kairo-recap-week-send','kairo-recap-week-retry',
                           'kairo-recap-month-build','kairo-recap-month-send','kairo-recap-month-retry','kairo-class-offer-drip'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

-- Today's class (code + register) is ready by 6 PM Lagos, Monday to Saturday.
select cron.schedule('kairo-class-session', '0 17 * * 1-6', $$select cbt.ensure_class_session()$$);

-- Weekly recap: built Monday 06:00 Lagos for last Mon–Sun, sent 06:30 Lagos (email + push), retried through Tuesday.
select cron.schedule('kairo-recap-week-build', '0 5 * * 1', $$select cbt.build_last_week_recaps()$$);
select cron.schedule('kairo-recap-week-send', '30 5 * * 1', $$select cbt._kairo_mail('{"action":"recaps","kind":"week"}')$$);
select cron.schedule('kairo-recap-week-retry', '30 11,17 * * 1,2', $$select cbt._kairo_mail('{"action":"recaps","kind":"week"}')$$);

-- Monthly milestones: built on the 1st for last month, sent the same morning, retried on the 1st and 2nd.
select cron.schedule('kairo-recap-month-build', '10 5 1 * *', $$select cbt.build_last_month_recaps()$$);
select cron.schedule('kairo-recap-month-send', '40 5 1 * *', $$select cbt._kairo_mail('{"action":"recaps","kind":"month"}')$$);
select cron.schedule('kairo-recap-month-retry', '40 11,17 1,2 * *', $$select cbt._kairo_mail('{"action":"recaps","kind":"month"}')$$);

-- Class-launch offer: whoever has not received it yet, 70 a day at 08:00 Lagos, until the offer ends (7 Dec, 11:59 PM).
select cron.schedule('kairo-class-offer-drip', '0 7 * * *', $$select cbt._kairo_mail('{"action":"campaign","template":"class_offer","campaign":"class-offer-2026-11","audience":"techmed_unpaid","category":"classes","limit":70}')
  where now() < timestamptz '2026-12-07 18:00:00+00'$$);
