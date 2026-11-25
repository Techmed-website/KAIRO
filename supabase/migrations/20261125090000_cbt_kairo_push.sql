-- KAIRO push notifications (OneSignal app "Kairo", kairo.techmedng.com). The aim is practice, not selling:
--   06:00  Morning Charge: a daily quote + today's Daily Builder Quiz          → everyone subscribed
--   19:30  Practice reminder                                                    → only students who have not practised today
--   13:00  every second day, until 14 Dec: a gentle, optional live-classes note → only students without a plan
-- Each kind replaces its own previous notification on the phone (OneSignal web_push_topic), so they never pile up.
-- cbt.kairo_push_plan(slot) decides the words and the audience; the kairo-push Edge Function sends them and
-- cbt.push_log makes every send happen at most once.

create table if not exists cbt.daily_quotes (
  id int generated always as identity primary key,
  text text not null check (length(text) between 10 and 160),
  active boolean not null default true
);
alter table cbt.daily_quotes enable row level security;
create policy read_quotes on cbt.daily_quotes for select using (true);
grant select on cbt.daily_quotes to authenticated;

insert into cbt.daily_quotes (text)
select t from unnest(array[
  'Small daily practice beats big last-minute panic.',
  'Ten questions today is ten fewer surprises in JAMB.',
  'You don''t need a perfect day. You need a practice day.',
  'Every explanation you read is a mark you are building.',
  'Discipline is choosing what you want most over what you want now.',
  'The score you want is built on ordinary days like this one.',
  'Show up for five minutes. Momentum will do the rest.',
  'Mistakes in practice are cheap. Learn from them today.',
  'Consistency is louder than talent.',
  'Your future self is counting on today''s effort.',
  'Hard questions are just topics you have not mastered yet.',
  'One topic at a time, one day at a time.',
  'Builders don''t guess. They prepare.',
  'Think smart. Perform elite.',
  'Progress, not perfection.',
  'A little practice every day adds up to a lot of confidence.',
  'The best time to start was yesterday. The next best time is now.',
  'Read the explanation, then try one more.',
  'You are not behind. You are building.',
  'Focus on the next question, not the whole syllabus.',
  'Practice makes the exam hall feel familiar.',
  'Strong scores are built quietly, one session at a time.',
  'Doubt kills more dreams than failure ever will. Keep going.',
  'Your effort today is a vote for the student you are becoming.',
  'Five minutes of focus beats an hour of scrolling.',
  'Get one more right than yesterday.',
  'The syllabus is big. Your habit is bigger.',
  'Practise until the hard ones feel normal.',
  'Confidence comes from preparation, not luck.',
  'Today''s practice is tomorrow''s calm.',
  'Learn the why, and the what takes care of itself.',
  'Keep the streak alive. Future you will thank you.',
  'Don''t count the days. Make the days count.',
  'Every expert was once a beginner who kept practising.',
  'Push a little further than comfortable today.',
  'Your goal is waiting on the other side of your routine.',
  'It is not about being the best. It is about being better than yesterday.',
  'Rest if you must, but don''t quit.',
  'A focused five minutes is still a win.',
  'Turn ''I hope'' into ''I practised''.',
  'The questions you miss today are the ones you will never miss again.',
  'Steady wins. Keep stacking days.',
  'You have done hard things before. This is one more.',
  'Let your results surprise the doubters.',
  'Practice is how you make your own luck.'
]) t
where not exists (select 1 from cbt.daily_quotes);

create table if not exists cbt.push_log (
  key text primary key,
  sent_at timestamptz not null default now(),
  audience int,
  detail jsonb
);
alter table cbt.push_log enable row level security;
revoke all on cbt.push_log from anon, authenticated;

-- What to send for a slot, and to whom. Called by the kairo-push Edge Function with the service role.
-- Returns null when there is nothing to send (already sent today, not an enrolment day, nobody to remind).
create or replace function cbt.kairo_push_plan(p_slot text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_day int := v_today - date '2026-11-10';
  v_key text := 'kairo:' || p_slot || ':' || v_today;
  v_quote text; q cbt.assessments; v_label text; v_ids uuid[];
begin
  if exists (select 1 from cbt.push_log where key = v_key) then return null; end if;
  select * into q from cbt.assessments
  where type = 'daily_quiz' and status = 'live' and (opens_at at time zone 'Africa/Lagos')::date = v_today limit 1;
  v_label := coalesce(regexp_replace(q.title, '^.*—\s*Day \d+:\s*', ''), 'today''s quiz');

  if p_slot = 'morning' then
    select text into v_quote from cbt.daily_quotes where active order by id
      offset (v_day % greatest((select count(*) from cbt.daily_quotes where active), 1)) limit 1;
    return jsonb_build_object('key', v_key, 'topic', 'kairo-morning', 'audience', 'all',
      'title', '☀️ Morning Charge · Day ' || v_day,
      'body', '“' || v_quote || '” ' || case when q.id is not null then 'Today: ' || v_label || '. 10 questions, 5 minutes.' else 'Practise a topic on KAIRO today.' end,
      'url', case when q.id is not null then 'https://kairo.techmedng.com/q/' || q.id else 'https://kairo.techmedng.com/practice' end);

  elsif p_slot = 'evening' then
    -- Students active on KAIRO in the last 30 days who have not practised today.
    select array_agg(distinct t.user_id) into v_ids from cbt.attempts t
    where t.started_at > p_now - interval '30 days'
      and not exists (select 1 from cbt.attempts x where x.user_id = t.user_id
                      and (x.started_at at time zone 'Africa/Lagos')::date = v_today);
    if v_ids is null then return null; end if;
    return jsonb_build_object('key', v_key, 'topic', 'kairo-evening', 'audience', 'users', 'user_ids', to_jsonb(v_ids),
      'title', (array['⏳ Five minutes before bed?', '📚 Quick practice tonight?', '💪 Keep your streak going', '🧠 One quiz, then rest'])[v_day % 4 + 1],
      'body', case when q.id is not null then v_label || ' is still open: 10 questions, 5 minutes, with an explanation for every answer.'
                   else 'A short practice session tonight keeps the topics fresh. Your questions are waiting on KAIRO.' end,
      'url', case when q.id is not null then 'https://kairo.techmedng.com/q/' || q.id else 'https://kairo.techmedng.com/practice' end);

  elsif p_slot = 'enrol' then
    if v_today > date '2026-12-14' or v_day % 2 <> 0 then return null; end if;
    -- KAIRO students without an active TECHMED plan (read only; entitlements live in the website's schema).
    select array_agg(p.id) into v_ids from cbt.profiles p
    where exists (select 1 from cbt.attempts t where t.user_id = p.id and t.started_at > p_now - interval '30 days')
      and not exists (select 1 from public.entitlements e where e.user_id = p.id and e.is_active and e.revoked_at is null
                      and e.resource_id like 'cohort-%' and (e.expires_at is null or e.expires_at > p_now));
    if v_ids is null then return null; end if;
    return jsonb_build_object('key', v_key, 'topic', 'kairo-classes', 'audience', 'users', 'user_ids', to_jsonb(v_ids),
      'title', case when v_today < date '2026-11-30' then 'Live classes start 30 November' else 'TECHMED live classes are running' end,
      'body', 'Want a tutor alongside your KAIRO practice? Live classes run 7 PM, Monday to Saturday. Totally optional: KAIRO stays free either way.',
      'url', 'https://techmedng.com/pricing/?utm_source=kairo&utm_medium=push&utm_campaign=classes');
  end if;
  raise exception 'unknown slot %', p_slot using errcode = '22023';
end $$;
revoke execute on function cbt.kairo_push_plan(text, timestamptz) from public, anon, authenticated;
grant execute on function cbt.kairo_push_plan(text, timestamptz) to service_role;

create or replace function cbt.kairo_push_done(p_key text, p_audience int, p_detail jsonb)
returns void language sql volatile security definer set search_path = cbt, pg_temp as
$$ insert into cbt.push_log (key, audience, detail) values (p_key, p_audience, p_detail) on conflict (key) do nothing $$;
revoke execute on function cbt.kairo_push_done(text, int, jsonb) from public, anon, authenticated;
grant execute on function cbt.kairo_push_done(text, int, jsonb) to service_role;

-- Schedule (applied separately as cbt_kairo_push_schedule). Lagos = UTC+1.
select cron.schedule('kairo-push-morning', '0 5 * * *', $c$select net.http_post(url := 'https://unbgborbhxzsotaieiun.supabase.co/functions/v1/kairo-push', body := '{"slot":"morning"}'::jsonb, headers := jsonb_build_object('Content-Type','application/json','x-techmed-notify',(select value from public.app_secrets where name='notify_hook_secret')), timeout_milliseconds := 30000)$c$);
select cron.schedule('kairo-push-evening', '30 18 * * *', $c$select net.http_post(url := 'https://unbgborbhxzsotaieiun.supabase.co/functions/v1/kairo-push', body := '{"slot":"evening"}'::jsonb, headers := jsonb_build_object('Content-Type','application/json','x-techmed-notify',(select value from public.app_secrets where name='notify_hook_secret')), timeout_milliseconds := 30000)$c$);
select cron.schedule('kairo-push-classes', '0 12 * * *', $c$select net.http_post(url := 'https://unbgborbhxzsotaieiun.supabase.co/functions/v1/kairo-push', body := '{"slot":"enrol"}'::jsonb, headers := jsonb_build_object('Content-Type','application/json','x-techmed-notify',(select value from public.app_secrets where name='notify_hook_secret')), timeout_milliseconds := 30000)$c$);
