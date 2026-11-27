-- PROUDLY KAIRO · Learn. Refer. Inspire.  Recognition-only referral programme (no money, no prizes, no balances).
--
-- Reuses: cbt.profiles.referral_code (existing column, now filled), cbt.badges + cbt.user_badges (existing achievement
-- framework: six badges in a new 'referral' category, earned once, never revoked), cbt.attempts / attempt_answers
-- (activation is proven by the server's own learning records), cbt.is_admin() / _require_admin() (Founder Intelligence).
-- New: referral_settings (on/pause), referral_visits (link opens), referrals (one row per referred student),
--      referral_notices (one row per badge earned: push / email / in-app celebration done once).
--
-- Rules
--   Code        one per signed-up student, e.g. ADA7K2Q; link https://<app>/r/<code> (any page also accepts ?ref=<code>).
--   Attribution first touch: a student can be referred once (referred_id is the primary key) and it never changes.
--   Genuinely   the referred account (auth.users) is at most 7 days old when the referral is recorded, is not a guest,
--   new         is not the referrer, and did not refer the referrer. Same email (ignoring dots and +tags) → rejected;
--               same phone or same device as the referrer → flagged for the founder (not counted until approved).
--   Registered  the referral row exists (valid).
--   Activated   the referred student finished a practice, quiz or mock with 10+ answered questions, started after their
--               account was created. Taken from cbt.attempts / attempt_answers, never from a client event.
--   Retained    after activating, the referred student started learning again on a later Lagos calendar day.
--   Badges      by activated referrals: 1, 3, 5, 10, 25, 50 (cbt.badges.goal). Inserted once; threshold changes never revoke.
--   XP          referral badges give no XP: the academic XP boards are unchanged by referrals.

-- ───────────────────────── tables ─────────────────────────
create table if not exists cbt.referral_settings (
  id          boolean primary key default true check (id),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
insert into cbt.referral_settings (id, enabled) values (true, true) on conflict (id) do nothing;

create table if not exists cbt.referral_visits (
  id           bigint generated always as identity primary key,
  code         text not null,
  referrer_id  uuid not null references cbt.profiles(id) on delete cascade,
  anon_id      text,
  user_id      uuid,
  created_at   timestamptz not null default now()
);
create index if not exists referral_visits_referrer_idx on cbt.referral_visits (referrer_id, created_at);
create index if not exists referral_visits_created_idx on cbt.referral_visits (created_at);

create table if not exists cbt.referrals (
  referred_id         uuid primary key references cbt.profiles(id) on delete cascade,
  referrer_id         uuid not null references cbt.profiles(id) on delete cascade,
  code                text not null,
  source              text not null check (source in ('link', 'code')),
  anon_id             text,
  status              text not null default 'valid' check (status in ('valid', 'flagged', 'rejected')),
  flag_reason         text,
  created_at          timestamptz not null default now(),
  activated_at        timestamptz,
  activation_attempt  uuid,
  retained_at         timestamptz,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on cbt.referrals (referrer_id);
create index if not exists referrals_created_idx on cbt.referrals (created_at);

create table if not exists cbt.referral_notices (
  user_id        uuid not null references cbt.profiles(id) on delete cascade,
  badge_code     text not null references cbt.badges(code),
  earned_at      timestamptz not null default now(),
  pushed_at      timestamptz,
  emailed_at     timestamptz,
  celebrated_at  timestamptz,
  primary key (user_id, badge_code)
);

-- No direct client access at all: every read and write goes through the functions below.
alter table cbt.referral_settings enable row level security;
alter table cbt.referral_visits   enable row level security;
alter table cbt.referrals         enable row level security;
alter table cbt.referral_notices  enable row level security;
revoke all on cbt.referral_settings, cbt.referral_visits, cbt.referrals, cbt.referral_notices from anon, authenticated;

-- ───────────────────────── badges (existing framework, new category) ─────────────────────────
insert into cbt.badges (code, title, description, icon, goal, sort, category) values
  ('ref_1',  'Proud KAIRO User', 'Your first friend joined KAIRO and started learning through you.', '🛡️', 1,  70, 'referral'),
  ('ref_3',  'KAIRO Advocate',   '3 friends joined and started learning through you.',               '🛡️', 3,  71, 'referral'),
  ('ref_5',  'KAIRO Ambassador', '5 friends joined and started learning through you.',               '🎖️', 5,  72, 'referral'),
  ('ref_10', 'KAIRO Champion',   '10 friends joined and started learning through you.',              '🏆', 10, 73, 'referral'),
  ('ref_25', 'KAIRO Legend',     '25 friends joined and started learning through you.',              '🌿', 25, 74, 'referral'),
  ('ref_50', 'KAIRO Icon',       '50 friends joined and started learning through you.',              '💎', 50, 75, 'referral')
on conflict (code) do nothing;

-- ───────────────────────── XP: referral badges never earn XP ─────────────────────────
create or replace function cbt._xp_events(p_uid uuid)
returns table (user_id uuid, at timestamptz, kind text, xp int)
language sql stable security definer set search_path = cbt, pg_temp as $$
  with fa as (
    select t.id, t.user_id, t.assessment_id, t.score, t.total, t.server_received_at at_,
           (t.server_received_at at time zone 'Africa/Lagos')::date d, a.type::text atype
    from cbt.attempts t
    join cbt.assessments a on a.id = t.assessment_id
    join auth.users u on u.id = t.user_id
    where t.status = 'final' and t.server_received_at is not null and not coalesce(u.is_anonymous, false)
      and (p_uid is null or t.user_id = p_uid)
  ), ans as (
    select distinct on (fa.user_id, fa.d, aa.question_id) fa.id attempt_id, fa.user_id, fa.d, fa.at_, coalesce(aa.is_correct, false) ok
    from fa join cbt.attempt_answers aa on aa.attempt_id = fa.id
    where aa.selected_option is not null
    order by fa.user_id, fa.d, aa.question_id, fa.at_, fa.id
  ), per_att as (
    select attempt_id, user_id, d, min(at_) at_, sum(1 + 2 * ok::int)::int raw, count(*)::int n from ans group by 1, 2, 3
  ), capped as (
    select *, sum(raw) over (partition by user_id, d order by at_, attempt_id) cum from per_att
  ), cnt as (
    select fa.*,
      (select count(*) from cbt.attempt_answers aa where aa.attempt_id = fa.id and aa.selected_option is not null) answered,
      row_number() over (partition by fa.user_id, fa.assessment_id order by fa.at_, fa.id) nth
    from fa
  ), sess as (
    select c.user_id, c.at_, row_number() over (partition by c.user_id, c.d order by c.at_, c.id) k
    from cnt c join per_att p on p.attempt_id = c.id
    where c.nth = 1 and p.n >= 10 and c.atype not in ('daily_quiz', 'challenge', 'mock')
  ), mocks as (
    select user_id, at_, row_number() over (partition by user_id, d order by at_, id) k
    from cnt where atype = 'mock' and answered >= 120
  ), days as (
    select distinct on (user_id, d) user_id, at_ from fa order by user_id, d, at_
  )
  select user_id, at_, 'answers', (least(cum, 300) - least(cum - raw, 300))::int from capped
  union all select user_id, at_, 'session', 10 from sess where k <= 5
  union all select user_id, at_, 'daily_quiz', 20 from cnt where nth = 1 and atype in ('daily_quiz', 'challenge')
  union all select user_id, at_, 'daily_quiz_strong', 10 from cnt where nth = 1 and atype in ('daily_quiz', 'challenge') and total > 0 and score >= 0.8 * total
  union all select user_id, at_, 'mock', 50 from mocks where k = 1
  union all select user_id, at_, 'day', 5 from days
  union all select ub.user_id, ub.earned_at, 'badge', 25 from cbt.user_badges ub join auth.users u on u.id = ub.user_id
            join cbt.badges b on b.code = ub.badge_code
            where not coalesce(u.is_anonymous, false) and (p_uid is null or ub.user_id = p_uid)
              and b.category is distinct from 'referral' $$;

-- Highest referral badge of a student (null when none). Display only.
create or replace function cbt._ref_level(p_uid uuid) returns text
language sql stable security definer set search_path = cbt, pg_temp as $$
  select ub.badge_code from cbt.user_badges ub join cbt.badges b on b.code = ub.badge_code
  where ub.user_id = p_uid and b.category = 'referral' order by b.goal desc limit 1 $$;
revoke execute on function cbt._ref_level(uuid) from public, anon, authenticated;

-- Academic XP board: identical ranking; each row also carries 'ref' (highest referral badge) for a small marker.
create or replace function cbt._xp_board(p_uid uuid, p_period text, p_limit int, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  with w as (
    select case p_period when 'day' then cbt.day_start(p_now) when 'week' then cbt.week_start(p_now) else '-infinity'::timestamptz end s,
           case p_period when 'day' then cbt.day_start(p_now) + interval '1 day' when 'week' then cbt.week_start(p_now) + interval '7 days' end e
  ), ev as (select * from cbt._xp_events(null) where at <= p_now),
  life as (select user_id, sum(xp)::int total from ev group by 1),
  cur as (select ev.user_id, sum(ev.xp)::int xp, max(ev.at) last_at from ev, w where ev.at >= w.s group by 1 having sum(ev.xp) > 0),
  ranked as (select *, row_number() over (order by xp desc, last_at asc) rnk from cur),
  prev as (
    select user_id, row_number() over (order by sum(xp) desc, max(at) asc) rnk from ev, w
    where (p_period = 'all' and ev.at < cbt.day_start(p_now))
       or (p_period = 'week' and ev.at >= w.s - interval '7 days' and ev.at < w.s)
    group by user_id having sum(xp) > 0 and p_period in ('all', 'week')
  ), rows as (
    select r.rnk, r.xp, r.user_id = p_uid is_me, (cbt.level_for(l.total) ->> 'level')::int lvl, p.rnk prev_rnk,
           coalesce(nullif(split_part(btrim(pr.full_name), ' ', 1)
             || coalesce(' ' || left(nullif(split_part(btrim(pr.full_name), ' ', 2), ''), 1) || '.', ''), ''), 'Builder') nm,
           cbt._ref_level(r.user_id) ref
    from ranked r join life l using (user_id) left join prev p using (user_id) left join cbt.profiles pr on pr.id = r.user_id
  )
  select jsonb_build_object(
    'period', p_period, 'starts_at', case when p_period = 'all' then null else (select s from w) end, 'ends_at', (select e from w),
    'participants', (select count(*) from ranked),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rnk, 'name', nm, 'xp', xp, 'level', lvl, 'is_me', is_me, 'prev_rank', prev_rnk, 'ref', ref) order by rnk)
                      from rows where rnk <= least(greatest(coalesce(p_limit, 50), 1), 100)), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rnk, 'xp', xp, 'level', lvl, 'prev_rank', prev_rnk) from rows where is_me)) $$;

-- ───────────────────────── codes ─────────────────────────
-- e.g. "ADA" + "7K2Q": up to 5 letters of the first name, then 4 characters without look-alikes (no 0/O, 1/I/L).
create or replace function cbt._ref_new_code(p_name text) returns text
language plpgsql volatile set search_path = cbt, pg_temp as $$
declare v_prefix text := upper(left(regexp_replace(coalesce(split_part(btrim(p_name), ' ', 1), ''), '[^A-Za-z]', '', 'g'), 5));
        v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_code text; i int;
begin
  if length(v_prefix) < 2 then v_prefix := 'KAIRO'; end if;
  loop
    v_code := v_prefix;
    for i in 1..4 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists (select 1 from cbt.profiles where referral_code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function cbt._ref_code_for(p_uid uuid) returns text
language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v_code text;
begin
  select referral_code into v_code from cbt.profiles where id = p_uid;
  if v_code is not null then return v_code; end if;
  if exists (select 1 from auth.users where id = p_uid and is_anonymous) then return null; end if;   -- guests: no code
  update cbt.profiles set referral_code = cbt._ref_new_code(full_name) where id = p_uid and referral_code is null
  returning referral_code into v_code;
  return coalesce(v_code, (select referral_code from cbt.profiles where id = p_uid));
end $$;
revoke execute on function cbt._ref_new_code(text), cbt._ref_code_for(uuid) from public, anon, authenticated;

-- Every signed-up student gets their code now (guests get one when they register).
do $$ declare r record; begin
  for r in select p.id, p.full_name from cbt.profiles p join auth.users u on u.id = p.id
           where p.referral_code is null and not coalesce(u.is_anonymous, false) loop
    update cbt.profiles set referral_code = cbt._ref_new_code(r.full_name) where id = r.id and referral_code is null;
  end loop;
end $$;

create or replace function cbt._ref_enabled() returns boolean
language sql stable security definer set search_path = cbt, pg_temp as
$$ select coalesce((select enabled from cbt.referral_settings where id), true) $$;

create or replace function cbt._ref_norm_email(p text) returns text language sql immutable set search_path = cbt, pg_temp as $$
  select case when split_part(lower(btrim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
              then replace(split_part(split_part(lower(btrim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
              else split_part(split_part(lower(btrim(p)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(p)), '@', 2) end $$;
create or replace function cbt._ref_norm_phone(p text) returns text language sql immutable set search_path = cbt, pg_temp as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '') $$;

-- ───────────────────────── link visits ─────────────────────────
-- Records that a referral link was opened (server time). Counts visits only; it never makes a referral successful.
create or replace function cbt.referral_visit(p_code text, p_anon text default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare v_ref cbt.profiles; v_code text := upper(btrim(coalesce(p_code, ''))); v_anon text := left(p_anon, 64);
begin
  if v_code !~ '^[A-Z0-9]{4,12}$' then return jsonb_build_object('valid', false); end if;
  select p.* into v_ref from cbt.profiles p join auth.users u on u.id = p.id
   where p.referral_code = v_code and not coalesce(u.is_anonymous, false);
  if v_ref.id is null then return jsonb_build_object('valid', false); end if;
  -- one visit per code and install per hour; at most 300 visits per code per day
  if not exists (select 1 from cbt.referral_visits where code = v_code and anon_id is not distinct from v_anon and created_at > now() - interval '1 hour')
     and (select count(*) from cbt.referral_visits where code = v_code and created_at > now() - interval '1 day') < 300 then
    insert into cbt.referral_visits (code, referrer_id, anon_id, user_id) values (v_code, v_ref.id, v_anon, auth.uid());
  end if;
  return jsonb_build_object('valid', true, 'code', v_code, 'enabled', cbt._ref_enabled(),
    'referrer_first_name', nullif(split_part(btrim(v_ref.full_name), ' ', 1), ''));
exception when others then
  return jsonb_build_object('valid', false);
end $$;
revoke execute on function cbt.referral_visit(text, text) from public;
grant execute on function cbt.referral_visit(text, text) to anon, authenticated;

-- ───────────────────────── attribution ─────────────────────────
-- Called by the app once the student is signed in with a real account. p_code may be null: then the code saved in the
-- sign-up metadata (ref_code) is used, so attribution survives email confirmation on another device.
create or replace function cbt.claim_referral(p_code text default null, p_anon text default null, p_source text default 'link')
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid(); u auth.users; me cbt.profiles; v_ref cbt.profiles; v_ref_email text;
  v_code text; v_status text := 'valid'; v_reason text; v_anon text := left(p_anon, 64);
  v_source text := case when p_source = 'code' then 'code' else 'link' end;
begin
  if uid is null or cbt.is_guest() then return jsonb_build_object('status', 'not_signed_in'); end if;
  select * into u from auth.users where id = uid;
  if coalesce(u.is_anonymous, false) then return jsonb_build_object('status', 'not_signed_in'); end if;
  if exists (select 1 from cbt.referrals where referred_id = uid) then return jsonb_build_object('status', 'already_referred'); end if;
  v_code := upper(btrim(coalesce(nullif(p_code, ''), u.raw_user_meta_data ->> 'ref_code', '')));
  if v_code = '' then return jsonb_build_object('status', 'no_code'); end if;
  if not cbt._ref_enabled() then return jsonb_build_object('status', 'paused'); end if;
  perform cbt.ensure_profile();
  select * into me from cbt.profiles where id = uid;
  if me.role <> 'student' then return jsonb_build_object('status', 'not_eligible'); end if;
  select p.* into v_ref from cbt.profiles p join auth.users ru on ru.id = p.id
   where p.referral_code = v_code and not coalesce(ru.is_anonymous, false);
  if v_ref.id is null then return jsonb_build_object('status', 'invalid_code'); end if;
  if v_ref.id = uid then return jsonb_build_object('status', 'self_referral'); end if;
  if u.created_at < now() - interval '7 days' then return jsonb_build_object('status', 'existing_account'); end if;
  if exists (select 1 from cbt.referrals where referred_id = v_ref.id and referrer_id = uid) then
    return jsonb_build_object('status', 'circular');
  end if;
  select email into v_ref_email from auth.users where id = v_ref.id;
  if v_ref_email is not null and u.email is not null and cbt._ref_norm_email(v_ref_email) = cbt._ref_norm_email(u.email) then
    return jsonb_build_object('status', 'self_referral');
  end if;
  -- Suspicious but not certain: counted only once the founder approves.
  if cbt._ref_norm_phone(coalesce(me.phone, u.raw_user_meta_data ->> 'phone')) is not null
     and cbt._ref_norm_phone(coalesce(me.phone, u.raw_user_meta_data ->> 'phone'))
       = cbt._ref_norm_phone(coalesce(v_ref.phone, (select raw_user_meta_data ->> 'phone' from auth.users where id = v_ref.id))) then
    v_status := 'flagged'; v_reason := 'same phone number as the referrer';
  elsif v_anon is not null and (
        exists (select 1 from cbt.events e where e.user_id = v_ref.id and e.anon_id = v_anon)
     or exists (select 1 from cbt.attempts t where t.user_id = v_ref.id and t.device_id = v_anon)) then
    v_status := 'flagged'; v_reason := 'same device as the referrer';
  end if;
  insert into cbt.referrals (referred_id, referrer_id, code, source, anon_id, status, flag_reason)
  values (uid, v_ref.id, v_code, v_source, v_anon, v_status, v_reason)
  on conflict (referred_id) do nothing;
  if not found then return jsonb_build_object('status', 'already_referred'); end if;
  perform cbt._ref_code_for(uid);
  return jsonb_build_object('status', case when v_status = 'valid' then 'recorded' else 'under_review' end,
                            'referrer_first_name', nullif(split_part(btrim(v_ref.full_name), ' ', 1), ''));
end $$;
revoke execute on function cbt.claim_referral(text, text, text) from public, anon;
grant execute on function cbt.claim_referral(text, text, text) to authenticated;

-- ───────────────────────── activation, retention, badges ─────────────────────────
-- Brings referrals up to date from the learning records and awards badges. p_referrer null = everyone.
-- Returns the badges newly awarded by this call.
create or replace function cbt._ref_refresh(p_referrer uuid default null)
returns table (user_id uuid, badge_code text)
language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
#variable_conflict use_column
begin
  update cbt.referrals r set activated_at = x.at, activation_attempt = x.id
  from (
    select r2.referred_id, q.id, q.at
    from cbt.referrals r2 join auth.users u on u.id = r2.referred_id
    cross join lateral (
      select t.id, coalesce(t.submitted_at, t.server_received_at, t.started_at) at
      from cbt.attempts t
      where t.user_id = r2.referred_id and t.status = 'final' and t.started_at >= u.created_at - interval '1 minute'
        and (select count(*) from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null) >= 10
      order by coalesce(t.submitted_at, t.server_received_at, t.started_at) limit 1) q
    where r2.activated_at is null and r2.status <> 'rejected' and (p_referrer is null or r2.referrer_id = p_referrer)
  ) x
  where r.referred_id = x.referred_id;

  update cbt.referrals r set retained_at = x.at
  from (
    select r2.referred_id, (select min(t.started_at) from cbt.attempts t
                             where t.user_id = r2.referred_id and t.status <> 'rejected'
                               and (t.started_at at time zone 'Africa/Lagos')::date > (r2.activated_at at time zone 'Africa/Lagos')::date) at
    from cbt.referrals r2
    where r2.activated_at is not null and r2.retained_at is null and r2.status <> 'rejected' and (p_referrer is null or r2.referrer_id = p_referrer)
  ) x
  where r.referred_id = x.referred_id and x.at is not null;

  return query
  with counts as (
    select r.referrer_id, count(*) n from cbt.referrals r
    where r.status = 'valid' and r.activated_at is not null and (p_referrer is null or r.referrer_id = p_referrer)
    group by 1
  ), ins as (
    insert into cbt.user_badges (user_id, badge_code)
    select c.referrer_id, b.code from counts c join cbt.badges b on b.category = 'referral' and b.goal <= c.n
    on conflict do nothing
    returning user_badges.user_id, user_badges.badge_code, user_badges.earned_at
  ), note as (
    insert into cbt.referral_notices (user_id, badge_code, earned_at) select i.user_id, i.badge_code, i.earned_at from ins i
    on conflict do nothing returning referral_notices.user_id, referral_notices.badge_code
  )
  select note.user_id, note.badge_code from note;
end $$;
revoke execute on function cbt._ref_refresh(uuid) from public, anon, authenticated;

-- Shared numbers for one referrer.
create or replace function cbt._ref_stats(p_uid uuid) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object(
    'visits', (select count(*) from cbt.referral_visits v where v.referrer_id = p_uid),
    'unique_visitors', (select count(distinct coalesce(v.anon_id, v.id::text)) from cbt.referral_visits v where v.referrer_id = p_uid),
    'registrations', (select count(*) from cbt.referrals r where r.referrer_id = p_uid and r.status = 'valid'),
    'activated', (select count(*) from cbt.referrals r where r.referrer_id = p_uid and r.status = 'valid' and r.activated_at is not null),
    'retained', (select count(*) from cbt.referrals r where r.referrer_id = p_uid and r.status = 'valid' and r.retained_at is not null),
    'under_review', (select count(*) from cbt.referrals r where r.referrer_id = p_uid and r.status = 'flagged')) $$;
revoke execute on function cbt._ref_stats(uuid) from public, anon, authenticated;

-- ───────────────────────── student RPCs ─────────────────────────
create or replace function cbt.my_referrals()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_code text; s jsonb; v_n int; u auth.users;
begin
  if uid is null or cbt.is_guest() then return null; end if;
  perform cbt.ensure_profile();
  perform cbt._ref_refresh(uid);
  v_code := cbt._ref_code_for(uid);
  s := cbt._ref_stats(uid);
  v_n := (s ->> 'activated')::int;
  select * into u from auth.users where id = uid;
  return jsonb_build_object(
    'enabled', cbt._ref_enabled(),
    'code', v_code,
    'stats', s,
    'level', cbt._ref_level(uid),
    'badges', (select jsonb_agg(jsonb_build_object('code', b.code, 'title', b.title, 'description', b.description, 'goal', b.goal,
                                  'earned_at', ub.earned_at) order by b.goal)
                 from cbt.badges b left join cbt.user_badges ub on ub.badge_code = b.code and ub.user_id = uid
                 where b.category = 'referral'),
    'next', (select jsonb_build_object('code', b.code, 'title', b.title, 'goal', b.goal, 'remaining', b.goal - v_n)
               from cbt.badges b where b.category = 'referral' and b.goal > v_n order by b.goal limit 1),
    'celebrate', (select coalesce(jsonb_agg(jsonb_build_object('code', n.badge_code, 'title', b.title, 'goal', b.goal) order by b.goal), '[]'::jsonb)
                    from cbt.referral_notices n join cbt.badges b on b.code = n.badge_code
                    where n.user_id = uid and n.celebrated_at is null),
    -- friends: no names, emails or phones; just how far each one got
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('joined_at', r.created_at, 'activated', r.activated_at is not null,
                                   'retained', r.retained_at is not null, 'under_review', r.status = 'flagged') order by r.created_at desc), '[]'::jsonb)
                  from (select * from cbt.referrals where referrer_id = uid and status <> 'rejected' order by created_at desc limit 50) r),
    'referred', exists (select 1 from cbt.referrals where referred_id = uid),
    'can_enter_code', not exists (select 1 from cbt.referrals where referred_id = uid) and u.created_at >= now() - interval '7 days');
end $$;
revoke execute on function cbt.my_referrals() from public, anon;
grant execute on function cbt.my_referrals() to authenticated;

-- Light call for the app shell: any referral badge not yet celebrated on screen.
create or replace function cbt.referral_celebrations()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or cbt.is_guest() then return '[]'::jsonb; end if;
  perform cbt._ref_refresh(uid);
  return (select coalesce(jsonb_agg(jsonb_build_object('code', n.badge_code, 'title', b.title, 'goal', b.goal,
                                    'activated', (cbt._ref_stats(uid) ->> 'activated')::int) order by b.goal), '[]'::jsonb)
          from cbt.referral_notices n join cbt.badges b on b.code = n.badge_code where n.user_id = uid and n.celebrated_at is null);
end $$;
revoke execute on function cbt.referral_celebrations() from public, anon;
grant execute on function cbt.referral_celebrations() to authenticated;

create or replace function cbt.referral_celebrated(p_codes text[])
returns void language sql volatile security definer set search_path = cbt, pg_temp as $$
  update cbt.referral_notices set celebrated_at = now()
  where user_id = auth.uid() and badge_code = any(p_codes) and celebrated_at is null $$;
revoke execute on function cbt.referral_celebrated(text[]) from public, anon;
grant execute on function cbt.referral_celebrated(text[]) to authenticated;

-- KAIRO Ambassadors board. Ranked by activated referrals (ties: earlier latest activation first). 'all' or 'month' (Lagos).
create or replace function cbt.referral_board(p_period text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_me uuid := auth.uid();
        v_from timestamptz := case when p_period = 'month' then (date_trunc('month', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos' else '-infinity' end;
        r jsonb;
begin
  if v_me is null then return null; end if;
  with c as (
    select r.referrer_id rid, count(*) n, count(*) filter (where r.retained_at is not null) ret, max(r.activated_at) last_at
    from cbt.referrals r join cbt.profiles p on p.id = r.referrer_id
    where r.status = 'valid' and r.activated_at is not null and r.activated_at >= v_from and p.role = 'student'
    group by 1
  ), ranked as (select c.*, row_number() over (order by n desc, last_at asc) rnk from c),
  rows as (
    select k.rnk, k.n, k.ret, k.rid = v_me is_me, cbt._ref_level(k.rid) lvl,
           coalesce(nullif(split_part(btrim(pr.full_name), ' ', 1)
             || coalesce(' ' || left(nullif(split_part(btrim(pr.full_name), ' ', 2), ''), 1) || '.', ''), ''), 'Builder') nm
    from ranked k join cbt.profiles pr on pr.id = k.rid
  )
  select jsonb_build_object(
    'period', case when p_period = 'month' then 'month' else 'all' end,
    'participants', (select count(*) from ranked),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rnk, 'name', nm, 'activated', n, 'retained', ret, 'badge', lvl, 'is_me', is_me) order by rnk)
                      from (select * from rows order by rnk limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rnk, 'activated', n, 'retained', ret, 'badge', lvl) from rows where is_me))
  into r;
  return r;
end $$;
revoke execute on function cbt.referral_board(text, int, int) from public, anon;
grant execute on function cbt.referral_board(text, int, int) to authenticated;

-- Monthly recognition (non-monetary): this Lagos month's top ambassador, most sign-ups, strongest retention (3+ activated).
create or replace function cbt.referral_month()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with m as (select (date_trunc('month', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos' s),
  base as (
    select r.referrer_id uid,
           count(*) filter (where r.activated_at >= m.s) act,
           count(*) filter (where r.created_at >= m.s) reg,
           count(*) filter (where r.activated_at >= m.s and r.retained_at is not null) ret,
           max(r.activated_at) last_at
    from cbt.referrals r join cbt.profiles p on p.id = r.referrer_id, m
    where r.status = 'valid' and p.role = 'student' group by 1
  ), named as (
    select b.*, coalesce(nullif(split_part(btrim(pr.full_name), ' ', 1)
             || coalesce(' ' || left(nullif(split_part(btrim(pr.full_name), ' ', 2), ''), 1) || '.', ''), ''), 'Builder') nm
    from base b join cbt.profiles pr on pr.id = b.uid
  )
  select jsonb_build_object(
    'month', to_char(now() at time zone 'Africa/Lagos', 'FMMonth YYYY'),
    'top_ambassador', (select jsonb_build_object('name', nm, 'value', act) from named where act > 0 order by act desc, last_at asc limit 1),
    'most_signups', (select jsonb_build_object('name', nm, 'value', reg) from named where reg > 0 order by reg desc, last_at asc limit 1),
    'best_retention', (select jsonb_build_object('name', nm, 'value', round(100.0 * ret / act), 'activated', act)
                         from named where act >= 3 and ret > 0 order by ret::numeric / act desc, act desc limit 1)) $$;
revoke execute on function cbt.referral_month() from public, anon;
grant execute on function cbt.referral_month() to authenticated;

-- ───────────────────────── notifications (service role only, from the kairo-referrals Edge Function) ─────────────────────────
create or replace function cbt.referral_tick()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._ref_refresh(null);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', n.user_id, 'badge_code', n.badge_code, 'title', b.title, 'goal', b.goal,
            'activated', (cbt._ref_stats(n.user_id) ->> 'activated')::int,
            'email', c.email, 'first_name', nullif(split_part(btrim(c.full_name), ' ', 1), ''),
            'needs_push', n.pushed_at is null, 'needs_email', n.emailed_at is null)), '[]'::jsonb)
          from cbt.referral_notices n join cbt.badges b on b.code = n.badge_code
          cross join lateral cbt._fi_contact(n.user_id) c
          where (n.pushed_at is null or n.emailed_at is null) and n.earned_at > now() - interval '7 days');
end $$;
create or replace function cbt.referral_notice_done(p_user uuid, p_code text, p_channel text)
returns void language sql volatile security definer set search_path = cbt, pg_temp as $$
  update cbt.referral_notices set pushed_at = case when p_channel = 'push' then now() else pushed_at end,
                                  emailed_at = case when p_channel = 'email' then now() else emailed_at end
  where user_id = p_user and badge_code = p_code $$;
-- Launch announcement audience: every signed-up student with an email, with their own code for a personal link.
create or replace function cbt.referral_launch_audience()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'email', c.email, 'first_name', nullif(split_part(btrim(c.full_name), ' ', 1), ''),
                                               'code', p.referral_code)), '[]'::jsonb)
  from cbt.profiles p join auth.users u on u.id = p.id cross join lateral cbt._fi_contact(p.id) c
  where p.role = 'student' and not coalesce(u.is_anonymous, false) and c.email is not null and p.referral_code is not null $$;
revoke execute on function cbt.referral_tick(), cbt.referral_notice_done(uuid, text, text), cbt.referral_launch_audience()
  from public, anon, authenticated;
grant execute on function cbt.referral_tick(), cbt.referral_notice_done(uuid, text, text), cbt.referral_launch_audience() to service_role;

-- ───────────────────────── Founder Intelligence: Referral Intelligence (admin only) ─────────────────────────
create or replace function cbt.fi_referrals(p_from date, p_to date)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);
  perform cbt._ref_refresh(null);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'enabled', cbt._ref_enabled(),
    'settings', (select jsonb_build_object('enabled', enabled, 'updated_at', updated_at) from cbt.referral_settings where id),
    'thresholds', (select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'goal', goal) order by goal) from cbt.badges where category = 'referral'),
    'totals', jsonb_build_object(
      'visits', (select count(*) from cbt.referral_visits where created_at >= f and created_at < t),
      'unique_visitors', (select count(distinct coalesce(anon_id, id::text)) from cbt.referral_visits where created_at >= f and created_at < t),
      'registrations', (select count(*) from cbt.referrals where status = 'valid' and created_at >= f and created_at < t),
      'activated', (select count(*) from cbt.referrals where status = 'valid' and activated_at >= f and activated_at < t),
      'retained', (select count(*) from cbt.referrals where status = 'valid' and retained_at >= f and retained_at < t),
      'cohort_activated', (select count(*) from cbt.referrals where status = 'valid' and created_at >= f and created_at < t and activated_at is not null),
      'cohort_retained', (select count(*) from cbt.referrals where status = 'valid' and created_at >= f and created_at < t and retained_at is not null),
      'flagged', (select count(*) from cbt.referrals where status = 'flagged'),
      'rejected', (select count(*) from cbt.referrals where status = 'rejected' and created_at >= f and created_at < t),
      'referrers', (select count(distinct referrer_id) from cbt.referrals where status = 'valid' and created_at >= f and created_at < t),
      'sharers', (select count(distinct referrer_id) from cbt.referral_visits where created_at >= f and created_at < t)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
                'visits', (select count(*) from cbt.referral_visits v where cbt._fi_day(v.created_at) = d::date),
                'registrations', (select count(*) from cbt.referrals r where r.status = 'valid' and cbt._fi_day(r.created_at) = d::date),
                'activated', (select count(*) from cbt.referrals r where r.status = 'valid' and cbt._fi_day(r.activated_at) = d::date)) order by d), '[]'::jsonb)
              from generate_series(p_from, least(p_to, cbt._fi_day(now())), interval '1 day') d),
    'top_referrers', (select coalesce(jsonb_agg(x order by (x ->> 'activated')::int desc, (x ->> 'registrations')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('user_id', r.referrer_id, 'student', cbt._fi_code(r.referrer_id), 'name', c.full_name, 'email', c.email, 'phone', c.phone,
                 'code', p.referral_code, 'badge', cbt._ref_level(r.referrer_id),
                 'visits', (select count(*) from cbt.referral_visits v where v.referrer_id = r.referrer_id),
                 'registrations', count(*) filter (where r.status = 'valid'),
                 'activated', count(*) filter (where r.status = 'valid' and r.activated_at is not null),
                 'retained', count(*) filter (where r.status = 'valid' and r.retained_at is not null),
                 'flagged', count(*) filter (where r.status = 'flagged')) x
        from cbt.referrals r join cbt.profiles p on p.id = r.referrer_id cross join lateral cbt._fi_contact(r.referrer_id) c
        group by r.referrer_id, p.referral_code, c.full_name, c.email, c.phone
        order by count(*) filter (where r.status = 'valid' and r.activated_at is not null) desc limit 50) y),
    'badges', (select jsonb_agg(jsonb_build_object('code', b.code, 'title', b.title, 'goal', b.goal,
                 'holders', (select count(*) from cbt.user_badges ub where ub.badge_code = b.code)) order by b.goal)
               from cbt.badges b where b.category = 'referral'),
    'awards', (select coalesce(jsonb_agg(jsonb_build_object('at', ub.earned_at, 'badge', ub.badge_code, 'student', cbt._fi_code(ub.user_id),
                 'name', (select full_name from cbt._fi_contact(ub.user_id))) order by ub.earned_at desc), '[]'::jsonb)
               from (select ub.* from cbt.user_badges ub join cbt.badges b on b.code = ub.badge_code where b.category = 'referral'
                     order by ub.earned_at desc limit 50) ub),
    'cohorts', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'registrations', n, 'activated', a, 'retained', rt) order by w), '[]'::jsonb) from (
        select date_trunc('week', cbt._fi_day(created_at))::date w, count(*) n, count(activated_at) a, count(retained_at) rt
        from cbt.referrals where status = 'valid' and created_at >= f and created_at < t group by 1) z),
    'review', (select coalesce(jsonb_agg(jsonb_build_object('referred_id', r.referred_id, 'referred', cbt._fi_code(r.referred_id),
                 'referred_name', (select full_name from cbt._fi_contact(r.referred_id)),
                 'referrer', cbt._fi_code(r.referrer_id), 'referrer_name', (select full_name from cbt._fi_contact(r.referrer_id)),
                 'status', r.status, 'reason', r.flag_reason, 'source', r.source, 'created_at', r.created_at,
                 'activated', r.activated_at is not null) order by r.created_at desc), '[]'::jsonb)
               from (select * from cbt.referrals where status in ('flagged', 'rejected') order by created_at desc limit 50) r),
    'coverage', cbt._fi_coverage());
end $$;

create or replace function cbt.fi_referral_set(p_enabled boolean)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin();
begin
  update cbt.referral_settings set enabled = coalesce(p_enabled, enabled), updated_at = now(), updated_by = uid where id;
  perform cbt._audit('referral_programme', 'referral_settings', 'singleton', jsonb_build_object('enabled', p_enabled));
  return (select jsonb_build_object('enabled', enabled, 'updated_at', updated_at) from cbt.referral_settings where id);
end $$;

-- Approve (valid) or reject a referral. Rejecting never removes a badge already earned.
create or replace function cbt.fi_referral_review(p_referred uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin();
begin
  if p_status not in ('valid', 'rejected') then raise exception 'status must be valid or rejected' using errcode = '22023'; end if;
  update cbt.referrals set status = p_status, flag_reason = coalesce(nullif(p_reason, ''), flag_reason), reviewed_by = uid, reviewed_at = now()
  where referred_id = p_referred;
  if not found then raise exception 'referral not found' using errcode = 'P0002'; end if;
  perform cbt._audit('referral_review', 'referrals', p_referred::text, jsonb_build_object('status', p_status, 'reason', p_reason));
  perform cbt._ref_refresh((select referrer_id from cbt.referrals where referred_id = p_referred));
  return jsonb_build_object('status', p_status);
end $$;

do $$ declare fn text; begin
  foreach fn in array array['cbt.fi_referrals(date, date)', 'cbt.fi_referral_set(boolean)', 'cbt.fi_referral_review(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
