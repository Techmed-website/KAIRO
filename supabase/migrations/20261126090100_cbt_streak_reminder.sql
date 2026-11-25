-- Evening reminder speaks to streaks (handover 4B.2): students on a 2+ day streak who have not practised today get
-- "Keep your N-day streak", grouped by N in plan.groups; the kairo-push Edge Function sends each group separately.
-- Everything else in cbt.kairo_push_plan is unchanged from 20261125090000_cbt_kairo_push.sql.

create or replace function cbt.kairo_push_plan(p_slot text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_day int := v_today - date '2026-11-10';
  v_key text := 'kairo:' || p_slot || ':' || v_today;
  v_quote text; q cbt.assessments; v_label text; v_ids uuid[]; v_groups jsonb; v_streakers uuid[];
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
    -- Students on a streak of 2+ days get "keep your N-day streak", one group per N. Everyone else gets the general note.
    select coalesce(jsonb_agg(jsonb_build_object('user_ids', g.ids,
             'title', '🔥 Keep your ' || g.n || '-day streak',
             'body', case when q.id is not null then v_label || ' is still open. One quiz before midnight keeps your streak alive.'
                          else 'One short practice before midnight keeps your streak alive.' end)), '[]'::jsonb)
      into v_groups
      from (select s.n, jsonb_agg(s.uid) ids from (
              select uid, (cbt._streak(uid, p_now) ->> 'current')::int n from unnest(v_ids) uid) s
            where s.n >= 2 group by s.n) g;
    select coalesce(array_agg(uid), '{}') into v_streakers from unnest(v_ids) uid
     where (cbt._streak(uid, p_now) ->> 'current')::int >= 2;
    v_ids := array(select uid from unnest(v_ids) uid where uid <> all (v_streakers));
    return jsonb_build_object('key', v_key, 'topic', 'kairo-evening', 'audience', 'users', 'user_ids', to_jsonb(v_ids),
      'groups', v_groups,
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
