-- Notifications done properly: per-category preferences (email + push), signed one-click unsubscribe links,
-- audiences that always respect opt-outs, and a send log so nothing goes out twice.
--
-- Categories (the same words appear in KAIRO Settings → Notifications):
--   recaps        weekly recap + monthly milestones            (email, push)
--   classes       TECHMED class reminders, offers, attendance  (email, push)
--   updates       KAIRO news and programme launches            (email)
--   reminders     daily practice reminder + morning quiz       (push)
--   achievements  badges, streaks, referral milestones         (push, email)
-- A missing row means "everything on" (students opted in when they created their account).

create table if not exists cbt.notification_prefs (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  email_recaps       boolean not null default true,
  email_classes      boolean not null default true,
  email_updates      boolean not null default true,
  email_achievements boolean not null default true,
  push_recaps        boolean not null default true,
  push_classes       boolean not null default true,
  push_reminders     boolean not null default true,
  push_achievements  boolean not null default true,
  email_all_off      boolean not null default false,       -- "unsubscribe from all emails"
  updated_at         timestamptz not null default now()
);
alter table cbt.notification_prefs enable row level security;
revoke all on cbt.notification_prefs from anon, authenticated;

-- Secret for signing unsubscribe links (never leaves the database).
create table if not exists cbt.mail_secret (id boolean primary key default true check (id), key text not null);
alter table cbt.mail_secret enable row level security;
revoke all on cbt.mail_secret from anon, authenticated;
insert into cbt.mail_secret (id, key) values (true, encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

-- One row per email sent (campaign key + user), so a retried send never duplicates.
create table if not exists cbt.mail_log (
  campaign    text not null,
  user_id     uuid not null,
  email       text not null,
  sent_at     timestamptz not null default now(),
  status      text not null default 'sent',             -- sent | failed
  error       text,
  primary key (campaign, user_id)
);
create index if not exists mail_log_sent_idx on cbt.mail_log (sent_at);
alter table cbt.mail_log enable row level security;
revoke all on cbt.mail_log from anon, authenticated;

create or replace function cbt._mail_categories() returns text[] language sql immutable set search_path = cbt, pg_temp as
$$ select array['recaps','classes','updates','achievements','all'] $$;

-- Signed token: <user uuid>.<category>.<first 24 hex of HMAC>. Cannot be guessed or changed to another user.
create or replace function cbt._unsub_token(p_user uuid, p_category text) returns text
language sql stable security definer set search_path = cbt, pg_temp as $$
  select p_user::text || '.' || p_category || '.' ||
         left(encode(extensions.hmac(p_user::text || '|' || p_category, (select key from cbt.mail_secret where id), 'sha256'), 'hex'), 24) $$;
revoke execute on function cbt._unsub_token(uuid, text) from public, anon, authenticated;

create or replace function cbt._prefs(p_user uuid) returns cbt.notification_prefs
language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce((select n from cbt.notification_prefs n where n.user_id = p_user), row(p_user, true, true, true, true, true, true, true, true, false, now())::cbt.notification_prefs) $$;
revoke execute on function cbt._prefs(uuid) from public, anon, authenticated;

create or replace function cbt._email_ok(p_user uuid, p_category text) returns boolean
language sql stable security definer set search_path = cbt, pg_temp as $$
  select not p.email_all_off and case p_category when 'recaps' then p.email_recaps when 'classes' then p.email_classes
                                                  when 'updates' then p.email_updates when 'achievements' then p.email_achievements else true end
  from cbt._prefs(p_user) p $$;
revoke execute on function cbt._email_ok(uuid, text) from public, anon, authenticated;

-- One-click unsubscribe (from the email link or the List-Unsubscribe header). Anyone holding a valid token may use it.
create or replace function cbt.email_unsubscribe(p_token text, p_resubscribe boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v_parts text[] := string_to_array(coalesce(p_token, ''), '.'); v_user uuid; v_cat text; v_email text;
begin
  if array_length(v_parts, 1) <> 3 or v_parts[1] !~* '^[0-9a-f-]{36}$' or not (v_parts[2] = any(cbt._mail_categories())) then
    return jsonb_build_object('ok', false);
  end if;
  v_user := v_parts[1]::uuid; v_cat := v_parts[2];
  if cbt._unsub_token(v_user, v_cat) <> p_token then return jsonb_build_object('ok', false); end if;
  insert into cbt.notification_prefs (user_id) values (v_user) on conflict (user_id) do nothing;
  update cbt.notification_prefs set
    email_recaps = case when v_cat = 'recaps' then p_resubscribe else email_recaps end,
    email_classes = case when v_cat = 'classes' then p_resubscribe else email_classes end,
    email_updates = case when v_cat = 'updates' then p_resubscribe else email_updates end,
    email_achievements = case when v_cat = 'achievements' then p_resubscribe else email_achievements end,
    email_all_off = case when v_cat = 'all' then not p_resubscribe else email_all_off end,
    updated_at = now()
  where user_id = v_user;
  select email into v_email from auth.users where id = v_user;
  return jsonb_build_object('ok', true, 'category', v_cat, 'subscribed', p_resubscribe,
    'email_hint', regexp_replace(coalesce(v_email, ''), '^(.).*(@.*)$', '\1•••\2'));
exception when others then return jsonb_build_object('ok', false);
end $$;
revoke execute on function cbt.email_unsubscribe(text, boolean) from public;
grant execute on function cbt.email_unsubscribe(text, boolean) to anon, authenticated;

-- The student's own preferences (KAIRO Settings).
create or replace function cbt.my_notification_prefs()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select case when auth.uid() is null then null else to_jsonb(cbt._prefs(auth.uid())) - 'user_id' end $$;
revoke execute on function cbt.my_notification_prefs() from public, anon;
grant execute on function cbt.my_notification_prefs() to authenticated;

create or replace function cbt.set_notification_prefs(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); cur cbt.notification_prefs;
begin
  if uid is null or cbt.is_guest() then raise exception 'sign in first' using errcode = '28000'; end if;
  cur := cbt._prefs(uid);
  insert into cbt.notification_prefs as n (user_id, email_recaps, email_classes, email_updates, email_achievements,
                                           push_recaps, push_classes, push_reminders, push_achievements, email_all_off, updated_at)
  values (uid,
    coalesce((p ->> 'email_recaps')::boolean, cur.email_recaps), coalesce((p ->> 'email_classes')::boolean, cur.email_classes),
    coalesce((p ->> 'email_updates')::boolean, cur.email_updates), coalesce((p ->> 'email_achievements')::boolean, cur.email_achievements),
    coalesce((p ->> 'push_recaps')::boolean, cur.push_recaps), coalesce((p ->> 'push_classes')::boolean, cur.push_classes),
    coalesce((p ->> 'push_reminders')::boolean, cur.push_reminders), coalesce((p ->> 'push_achievements')::boolean, cur.push_achievements),
    coalesce((p ->> 'email_all_off')::boolean, cur.email_all_off), now())
  on conflict (user_id) do update set
    email_recaps = excluded.email_recaps, email_classes = excluded.email_classes, email_updates = excluded.email_updates,
    email_achievements = excluded.email_achievements, push_recaps = excluded.push_recaps, push_classes = excluded.push_classes,
    push_reminders = excluded.push_reminders, push_achievements = excluded.push_achievements, email_all_off = excluded.email_all_off,
    updated_at = now();
  return cbt.my_notification_prefs();
end $$;
revoke execute on function cbt.set_notification_prefs(jsonb) from public, anon;
grant execute on function cbt.set_notification_prefs(jsonb) to authenticated;

-- Who has a paid TECHMED class plan right now.
create or replace function cbt._is_paid_student(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  return exists (select 1 from public.entitlements e where e.user_id = p_user and e.resource_id like 'cohort-%'
                 and e.is_active and e.revoked_at is null and (e.expires_at is null or e.expires_at > now()));
end $$;
revoke execute on function cbt._is_paid_student(uuid) from public, anon, authenticated;

-- Mail audiences (service role only). Every audience drops people who opted out of the category, people already
-- sent this campaign, guests and unconfirmed addresses.
--   techmed_unpaid   every TECHMED account without an active class plan
--   techmed_all      every TECHMED account
--   kairo_students   everyone with a KAIRO profile (students)
--   paid_students    active class plan holders
create or replace function cbt.mail_audience(p_audience text, p_category text, p_campaign text)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.id, 'email', lower(u.email),
           'first_name', nullif(split_part(btrim(coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
           'unsub', cbt._unsub_token(u.id, p_category), 'unsub_all', cbt._unsub_token(u.id, 'all'),
           'paid', cbt._is_paid_student(u.id), 'kairo', p.id is not null)), '[]'::jsonb)
  from auth.users u left join cbt.profiles p on p.id = u.id
  where not coalesce(u.is_anonymous, false) and u.email is not null and u.email_confirmed_at is not null
    and coalesce(p.role::text, 'student') = 'student'
    and cbt._email_ok(u.id, p_category)
    and not exists (select 1 from cbt.mail_log l where l.campaign = p_campaign and l.user_id = u.id and l.status = 'sent')
    and case p_audience
          when 'techmed_unpaid' then not cbt._is_paid_student(u.id)
          when 'techmed_all' then true
          when 'kairo_students' then p.id is not null
          when 'paid_students' then cbt._is_paid_student(u.id)
          else false end $$;

create or replace function cbt.mail_logged(p_campaign text, p_user uuid, p_email text, p_status text, p_error text default null)
returns void language sql volatile security definer set search_path = cbt, pg_temp as $$
  insert into cbt.mail_log (campaign, user_id, email, status, error) values (p_campaign, p_user, p_email, p_status, left(p_error, 300))
  on conflict (campaign, user_id) do update set status = excluded.status, error = excluded.error, sent_at = now() $$;

-- Push opt-outs for user-targeted pushes: which of these users still want this push category.
create or replace function cbt.push_allowed(p_users uuid[], p_category text) returns uuid[]
language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(array_agg(x), '{}') from unnest(p_users) x, lateral cbt._prefs(x) p
  where case p_category when 'recaps' then p.push_recaps when 'classes' then p.push_classes
                        when 'reminders' then p.push_reminders when 'achievements' then p.push_achievements else true end $$;

revoke execute on function cbt.mail_audience(text, text, text), cbt.mail_logged(text, uuid, text, text, text), cbt.push_allowed(uuid[], text)
  from public, anon, authenticated;
grant execute on function cbt.mail_audience(text, text, text), cbt.mail_logged(text, uuid, text, text, text), cbt.push_allowed(uuid[], text)
  to service_role;

-- Founder: how a campaign went.
create or replace function cbt.fi_mail_stats(p_campaign text)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_admin();
  return (select jsonb_build_object('campaign', p_campaign, 'sent', count(*) filter (where status = 'sent'),
            'failed', count(*) filter (where status = 'failed'), 'first', min(sent_at), 'last', max(sent_at))
          from cbt.mail_log where campaign = p_campaign);
end $$;
revoke execute on function cbt.fi_mail_stats(text) from public, anon;
grant execute on function cbt.fi_mail_stats(text) to authenticated;
