-- PROUDLY KAIRO: every 10 minutes, award referral badges from learning records and send each new badge's push + email once.
select cron.schedule('kairo-referrals-tick', '*/10 * * * *',
  $$select net.http_post(url := 'https://unbgborbhxzsotaieiun.supabase.co/functions/v1/kairo-referrals', body := '{"action":"tick"}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-techmed-notify',(select value from public.app_secrets where name='notify_hook_secret')),
    timeout_milliseconds := 60000)$$);
