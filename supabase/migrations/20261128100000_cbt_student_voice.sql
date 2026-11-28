-- KAIRO STUDENT VOICE: satisfaction ratings, contextual feedback, moderated public testimonials, founder analytics.
--
-- Principles enforced here (not in the app):
--   * Private by default. Feedback is readable only by its author and the KAIRO admin.
--   * Public only with explicit consent: a testimonial needs consent = true at submission, an admin approval, and no
--     withdrawal. public_reviews() is the only public read path and returns display fields only.
--   * Prompts are rationed by the server (one claim per prompt, frequency limits from voice_settings), so two phones
--     cannot both show the same prompt and dismissals are respected everywhere.
--   * Every moderation and consent change is written to voice_audit.
-- Everything is additive; the down section at the end drops only objects created here.

-- ───────────────────────── settings (admin-adjustable frequency limits) ─────────────────────────
create table if not exists cbt.voice_settings (
  id                         boolean primary key default true check (id),
  enabled                    boolean not null default true,   -- master switch for unsolicited prompts
  unsolicited_gap_days       int not null default 7  check (unsolicited_gap_days between 1 and 90),
  rating_gap_days            int not null default 30 check (rating_gap_days between 7 and 365),
  practice_gap_days          int not null default 21 check (practice_gap_days between 1 and 365),
  testimonial_gap_days       int not null default 60 check (testimonial_gap_days between 7 and 365),
  practice_min_questions     int not null default 5  check (practice_min_questions between 1 and 100),
  rating_after_sessions      int not null default 3  check (rating_after_sessions between 1 and 50),
  testimonial_after_days     int not null default 7  check (testimonial_after_days between 1 and 90),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid
);
insert into cbt.voice_settings (id) values (true) on conflict (id) do nothing;

-- ───────────────────────── feedback (private) ─────────────────────────
create table if not exists cbt.feedback (
  id           uuid primary key,                            -- generated on the phone: a resent submission is a no-op
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null check (category in ('overall','practice','question_quality','explanations','technical','suggestion','general')),
  rating       smallint check (rating between 1 and 5),     -- overall-experience stars (category 'overall' only)
  helpful      text check (helpful in ('very','okay','not')), -- contextual practice answer
  reasons      text[] not null default '{}',
  body         text check (char_length(body) <= 1000),
  feature      text,                                        -- one of cbt._fi_features() or null
  attempt_id   uuid,                                        -- the student's own attempt (validated), never question text
  trigger      text not null check (trigger in ('practice_prompt','rating_prompt','periodic_invite','voluntary')),
  created_at   timestamptz not null default now(),
  status       text not null default 'new' check (status in ('new','reviewed','actioned','archived','deleted')),
  admin_note   text check (char_length(admin_note) <= 1000),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  check (category <> 'overall' or rating is not null)
);
create index if not exists feedback_created_idx on cbt.feedback (created_at);
create index if not exists feedback_user_idx on cbt.feedback (user_id, created_at desc);

-- ───────────────────────── testimonials (public only after consent + approval) ─────────────────────────
create table if not exists cbt.testimonials (
  id                    uuid primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  body                  text not null check (char_length(body) between 20 and 600),
  rating                smallint check (rating between 1 and 5),
  display_mode          text not null check (display_mode in ('chosen','first','anon')),
  display_name          text check (char_length(display_name) <= 40),
  consent               boolean not null check (consent),     -- cannot exist without an explicit yes
  consent_at            timestamptz not null default now(),
  consent_withdrawn_at  timestamptz,
  status                text not null default 'pending' check (status in ('pending','approved','rejected','hidden','withdrawn')),
  published_at          timestamptz,
  moderated_by          uuid,
  moderated_at          timestamptz,
  moderation_note       text check (char_length(moderation_note) <= 1000),
  edited_body           text check (char_length(edited_body) between 20 and 600),
  edit_status           text not null default 'none' check (edit_status in ('none','awaiting_student','accepted','declined')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- consent is a check (true) so it can never be stored false; a withdrawal is recorded in consent_withdrawn_at.
create index if not exists testimonials_status_idx on cbt.testimonials (status, published_at desc);
create index if not exists testimonials_user_idx on cbt.testimonials (user_id, created_at desc);

-- ───────────────────────── prompt state ─────────────────────────
create table if not exists cbt.feedback_prompts (
  user_id       uuid not null references auth.users(id) on delete cascade,
  prompt        text not null check (prompt in ('practice_helpful','experience_rating','testimonial_invite')),
  context       text not null default '',                  -- attempt id for practice prompts
  shown_at      timestamptz not null default now(),
  responded_at  timestamptz,
  dismissed_at  timestamptz,
  primary key (user_id, prompt, context)
);
create index if not exists feedback_prompts_shown_idx on cbt.feedback_prompts (shown_at);
create index if not exists feedback_prompts_user_idx on cbt.feedback_prompts (user_id, shown_at desc);

-- ───────────────────────── audit trail (moderation + consent) ─────────────────────────
create table if not exists cbt.voice_audit (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  entity     text not null check (entity in ('feedback','testimonial','settings','identity')),
  entity_id  text,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists voice_audit_entity_idx on cbt.voice_audit (entity, entity_id, at);

do $$ declare t text; begin
  foreach t in array array['voice_settings','feedback','testimonials','feedback_prompts','voice_audit'] loop
    execute format('alter table cbt.%I enable row level security', t);
    execute format('revoke all on cbt.%I from anon, authenticated', t);
  end loop;
end $$;
-- No policies: every read and write goes through the SECURITY DEFINER functions below.

-- ───────────────────────── analytics events ─────────────────────────
create or replace function cbt._fi_event_names() returns text[] language sql immutable set search_path = cbt, pg_temp as $$ select array[
  'user_registered','user_login','user_logout','user_session_started','user_session_ended',
  'page_viewed','feature_opened','navigation_clicked','search_performed',
  'practice_started','question_viewed','question_answered','practice_paused','practice_resumed','practice_completed','practice_abandoned',
  'question_bank_opened','subject_selected','topic_selected','year_filter_selected','question_search_performed',
  'daily_builder_quiz_viewed','daily_builder_quiz_started','quiz_started','quiz_answered','quiz_completed','quiz_abandoned',
  'mock_started','mock_question_answered','mock_submitted','mock_completed','result_viewed','answer_review_opened',
  'offline_pack_viewed','offline_pack_downloaded','leaderboard_viewed','profile_viewed','achievement_viewed',
  'study_planner_opened','study_plan_saved','share_clicked',
  'guest_prompt_shown','guest_gate_shown','guest_converted',
  'feedback_prompt_eligible','feedback_prompt_shown','feedback_prompt_dismissed','feedback_submitted',
  'experience_rating_submitted','contextual_feedback_submitted','testimonial_submitted','testimonial_consent_given',
  'testimonial_consent_withdrawn','testimonial_published','public_reviews_viewed'] $$;

-- Server-side event with a deterministic id (same key → same row), so a retried call never double counts.
-- Properties are ids and small enums only: never feedback text.
create or replace function cbt._voice_event(p_name text, p_user uuid, p_key text, p_entity text default null, p_props jsonb default '{}')
returns void language sql volatile security definer set search_path = cbt, pg_temp as $$
  insert into cbt.events (id, user_id, name, entity_id, props, created_at)
  values (md5(p_name || '|' || coalesce(p_user::text, '') || '|' || p_key)::uuid, p_user, p_name, left(p_entity, 64), coalesce(p_props, '{}'), now())
  on conflict (id) do nothing $$;
revoke execute on function cbt._voice_event(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- Removes email addresses and phone numbers from free text (students sometimes type them; we do not need them).
create or replace function cbt._voice_clean(p text, p_max int) returns text language sql immutable set search_path = cbt, pg_temp as $$
  select nullif(btrim(left(
           regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'),
             '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email removed]', 'g'),
             '(\+?\d[\d\s().-]{8,}\d)', '[number removed]', 'g'), p_max)), '') $$;

create or replace function cbt._voice_student() returns uuid language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  if auth.uid() is null or cbt.is_guest() then raise exception 'Create your free account to send feedback.' using errcode = '28000'; end if;
  return auth.uid();
end $$;
revoke execute on function cbt._voice_student() from public, anon, authenticated;

-- Completed learning sessions that count ("meaningful": at least practice_min_questions answered).
create or replace function cbt._voice_sessions(p_user uuid, p_min int) returns int language sql stable security definer set search_path = cbt, pg_temp as $$
  select count(*)::int from cbt.attempts t
  where t.user_id = p_user and t.status = 'final'
    and (select count(*) from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null) >= p_min $$;
revoke execute on function cbt._voice_sessions(uuid, int) from public, anon, authenticated;

-- ───────────────────────── prompts ─────────────────────────
-- Asks the server whether to show a feedback prompt here, and claims it if so (atomic: one claim per prompt and
-- context, so a second phone or tab gets nothing). p_where: 'result' (with the attempt just finished) or 'home'.
-- Returns null when nothing should be shown.
create or replace function cbt.voice_prompt(p_where text, p_attempt uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid(); s cbt.voice_settings; v_prompt text; v_ctx text := ''; v_feature text; n int; v_rows int;
begin
  if uid is null or cbt.is_guest() then return null; end if;
  select * into s from cbt.voice_settings where id;
  if not s.enabled then return null; end if;
  -- Never during a live timed exam.
  if exists (select 1 from cbt.attempts where user_id = uid and status = 'in_progress' and deadline_at > now()) then return null; end if;
  -- One unsolicited prompt per student per unsolicited_gap_days, whatever its type.
  if exists (select 1 from cbt.feedback_prompts where user_id = uid and shown_at > now() - make_interval(days => s.unsolicited_gap_days)) then return null; end if;
  -- Serialise claims for this student so two devices cannot both win.
  perform pg_advisory_xact_lock(hashtext('voice:' || uid::text));
  if exists (select 1 from cbt.feedback_prompts where user_id = uid and shown_at > now() - make_interval(days => s.unsolicited_gap_days)) then return null; end if;

  if p_where = 'result' and p_attempt is not null then
    -- Trigger 1: a completed practice session of the student's own, with enough answers.
    select cbt._fi_feature(a.type, a.personal, a.title) into v_feature
    from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    where t.id = p_attempt and t.user_id = uid and t.status = 'final' and a.personal and a.type <> 'mock'
      and (select count(*) from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null) >= s.practice_min_questions;
    if v_feature is not null
       and not exists (select 1 from cbt.feedback_prompts where user_id = uid and prompt = 'practice_helpful' and shown_at > now() - make_interval(days => s.practice_gap_days)) then
      v_prompt := 'practice_helpful'; v_ctx := p_attempt::text;
    end if;
  end if;

  if v_prompt is null and p_where in ('home', 'result') then
    -- Trigger 2: enough completed sessions, no rating prompt and no rating of any kind in rating_gap_days.
    n := cbt._voice_sessions(uid, s.practice_min_questions);
    if n >= s.rating_after_sessions
       and not exists (select 1 from cbt.feedback_prompts where user_id = uid and prompt = 'experience_rating' and shown_at > now() - make_interval(days => s.rating_gap_days))
       and not exists (select 1 from cbt.feedback where user_id = uid and category = 'overall' and created_at > now() - make_interval(days => s.rating_gap_days)) then
      v_prompt := 'experience_rating';
    end if;
  end if;

  if v_prompt is null and p_where = 'home' then
    -- Trigger 3: active on testimonial_after_days different days, no testimonial yet, not invited recently.
    select count(distinct (started_at at time zone 'Africa/Lagos')::date) into n from cbt.attempts where user_id = uid and status <> 'rejected';
    if n >= s.testimonial_after_days
       and not exists (select 1 from cbt.testimonials where user_id = uid and status in ('pending','approved'))
       and not exists (select 1 from cbt.feedback_prompts where user_id = uid and prompt = 'testimonial_invite' and shown_at > now() - make_interval(days => s.testimonial_gap_days)) then
      v_prompt := 'testimonial_invite';
    end if;
  end if;

  if v_prompt is null then return null; end if;
  insert into cbt.feedback_prompts (user_id, prompt, context, shown_at) values (uid, v_prompt, v_ctx, now())
  on conflict (user_id, prompt, context) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return null; end if;   -- this exact prompt was already shown once: never repeat it
  perform cbt._voice_event('feedback_prompt_eligible', uid, v_prompt || ':' || v_ctx || ':' || now()::text, nullif(v_ctx, ''), jsonb_build_object('source', v_prompt));
  return jsonb_build_object('prompt', v_prompt, 'context', nullif(v_ctx, ''), 'feature', v_feature);
end $$;

-- Skip / dismiss. Idempotent.
create or replace function cbt.voice_prompt_dismiss(p_prompt text, p_context text default null)
returns void language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_rows int;
begin
  if uid is null then return; end if;
  update cbt.feedback_prompts set dismissed_at = coalesce(dismissed_at, now())
  where user_id = uid and prompt = p_prompt and context = coalesce(p_context, '') and responded_at is null;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then perform cbt._voice_event('feedback_prompt_dismissed', uid, p_prompt || ':' || coalesce(p_context, ''), p_context, jsonb_build_object('source', p_prompt)); end if;
end $$;

create or replace function cbt._voice_responded(p_user uuid, p_prompt text, p_context text) returns void
language sql volatile security definer set search_path = cbt, pg_temp as $$
  update cbt.feedback_prompts set responded_at = coalesce(responded_at, now())
  where user_id = p_user and prompt = p_prompt and context = coalesce(p_context, '') $$;
revoke execute on function cbt._voice_responded(uuid, text, text) from public, anon, authenticated;

-- ───────────────────────── student: feedback ─────────────────────────
-- p: {id, category, rating?, helpful?, reasons?, body?, feature?, attempt_id?, trigger, prompt?}
create or replace function cbt.voice_submit_feedback(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := cbt._voice_student(); v_id uuid; v_cat text := p ->> 'category'; v_trigger text := coalesce(p ->> 'trigger', 'voluntary');
  v_rating smallint; v_attempt uuid; v_feature text; v_reasons text[]; v_body text; v_rows int; v_prompt text := p ->> 'prompt';
begin
  begin v_id := (p ->> 'id')::uuid; exception when others then raise exception 'bad id' using errcode = '22023'; end;
  if v_id is null then raise exception 'bad id' using errcode = '22023'; end if;
  if exists (select 1 from cbt.feedback where id = v_id) then          -- resent (slow network): already saved
    if exists (select 1 from cbt.feedback where id = v_id and user_id = uid) then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
    raise exception 'bad id' using errcode = '22023';
  end if;
  if v_cat not in ('overall','practice','question_quality','explanations','technical','suggestion','general') then raise exception 'bad category' using errcode = '22023'; end if;
  if v_trigger not in ('practice_prompt','rating_prompt','periodic_invite','voluntary') then raise exception 'bad trigger' using errcode = '22023'; end if;
  if (select count(*) from cbt.feedback where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Thanks! You have sent a lot of feedback today. Please try again tomorrow.' using errcode = '54000';
  end if;
  begin v_rating := (p ->> 'rating')::smallint; exception when others then v_rating := null; end;
  if v_rating is not null and (v_rating < 1 or v_rating > 5) then v_rating := null; end if;
  if v_cat = 'overall' and v_rating is null then raise exception 'Choose a star rating.' using errcode = '22023'; end if;
  if v_cat <> 'overall' then v_rating := null; end if;
  begin v_attempt := (p ->> 'attempt_id')::uuid; exception when others then v_attempt := null; end;
  if v_attempt is not null then
    select cbt._fi_feature(a.type, a.personal, a.title) into v_feature from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    where t.id = v_attempt and t.user_id = uid;
    if not found then v_attempt := null; end if;                        -- someone else's or unknown: drop the link
  end if;
  v_feature := coalesce(v_feature, case when p ->> 'feature' = any(cbt._fi_features()) then p ->> 'feature' end);
  select coalesce(array_agg(distinct r), '{}') into v_reasons
  from jsonb_array_elements_text(case when jsonb_typeof(p -> 'reasons') = 'array' then p -> 'reasons' else '[]' end) r
  where r in ('unclear','too_hard','too_easy','weak_explanations','technical','other','questions','explanations','design','speed','content','subjects');
  v_body := cbt._voice_clean(p ->> 'body', 1000);
  if v_cat <> 'overall' and v_body is null and p ->> 'helpful' is null and cardinality(v_reasons) = 0 then
    raise exception 'Tell us a little more first.' using errcode = '22023';
  end if;

  insert into cbt.feedback (id, user_id, category, rating, helpful, reasons, body, feature, attempt_id, trigger)
  values (v_id, uid, v_cat, v_rating, case when p ->> 'helpful' in ('very','okay','not') then p ->> 'helpful' end, v_reasons, v_body, v_feature, v_attempt, v_trigger)
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;

  if v_prompt in ('practice_helpful','experience_rating','testimonial_invite') then
    perform cbt._voice_responded(uid, v_prompt, case when v_prompt = 'practice_helpful' then v_attempt::text end);
  end if;
  perform cbt._voice_event('feedback_submitted', uid, v_id::text, v_id::text, jsonb_build_object('source', v_trigger, 'mode', v_cat));
  if v_cat = 'overall' then perform cbt._voice_event('experience_rating_submitted', uid, v_id::text, v_id::text, jsonb_build_object('level', v_rating, 'source', v_trigger)); end if;
  if v_trigger = 'practice_prompt' then perform cbt._voice_event('contextual_feedback_submitted', uid, v_id::text, v_attempt::text, jsonb_build_object('mode', coalesce(p ->> 'helpful', ''))); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- A low rating can carry a short follow-up (same record, once): "What should we improve?"
create or replace function cbt.voice_add_detail(p_id uuid, p_reasons jsonb, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._voice_student(); v_rows int;
begin
  update cbt.feedback f set
    reasons = (select coalesce(array_agg(distinct r), '{}') from (select unnest(f.reasons) r union
                 select r from jsonb_array_elements_text(case when jsonb_typeof(p_reasons) = 'array' then p_reasons else '[]' end) r
                 where r in ('unclear','too_hard','too_easy','weak_explanations','technical','other','questions','explanations','design','speed','content','subjects')) x),
    body = coalesce(f.body, cbt._voice_clean(p_body, 1000))
  where f.id = p_id and f.user_id = uid and f.created_at > now() - interval '1 day';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', v_rows > 0);
end $$;

-- ───────────────────────── student: testimonials ─────────────────────────
-- p: {id, body, rating?, display_mode: chosen|first|anon, display_name?, consent: true}
create or replace function cbt.voice_submit_testimonial(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._voice_student(); v_id uuid; v_body text; v_mode text := p ->> 'display_mode'; v_name text; v_rating smallint; v_old uuid;
begin
  begin v_id := (p ->> 'id')::uuid; exception when others then raise exception 'bad id' using errcode = '22023'; end;
  if v_id is null then raise exception 'bad id' using errcode = '22023'; end if;
  if exists (select 1 from cbt.testimonials where id = v_id) then
    if exists (select 1 from cbt.testimonials where id = v_id and user_id = uid) then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
    raise exception 'bad id' using errcode = '22023';
  end if;
  if coalesce((p ->> 'consent')::boolean, false) is not true then
    raise exception 'Tick the consent box to let KAIRO show your review publicly.' using errcode = '22023';
  end if;
  v_body := cbt._voice_clean(p ->> 'body', 600);
  if v_body is null or char_length(v_body) < 20 then raise exception 'Write at least 20 characters.' using errcode = '22023'; end if;
  if v_mode not in ('chosen','first','anon') then raise exception 'Choose how your name appears.' using errcode = '22023'; end if;
  v_name := cbt._voice_clean(p ->> 'display_name', 40);
  if v_mode = 'chosen' and v_name is null then raise exception 'Enter the name to show.' using errcode = '22023'; end if;
  if v_mode <> 'chosen' then v_name := null; end if;
  begin v_rating := (p ->> 'rating')::smallint; exception when others then v_rating := null; end;
  if v_rating is not null and (v_rating < 1 or v_rating > 5) then v_rating := null; end if;
  if (select count(*) from cbt.testimonials where user_id = uid and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You can send up to 3 reviews a day.' using errcode = '54000';
  end if;
  -- One review waiting at a time: a new one replaces the one still pending.
  for v_old in select id from cbt.testimonials where user_id = uid and status = 'pending' loop
    update cbt.testimonials set status = 'withdrawn', consent_withdrawn_at = now(), updated_at = now() where id = v_old;
    insert into cbt.voice_audit (actor, action, entity, entity_id, detail) values (uid, 'replaced_by_student', 'testimonial', v_old::text, jsonb_build_object('by', v_id));
  end loop;
  insert into cbt.testimonials (id, user_id, body, rating, display_mode, display_name, consent, consent_at)
  values (v_id, uid, v_body, v_rating, v_mode, v_name, true, now());
  insert into cbt.voice_audit (actor, action, entity, entity_id, detail) values (uid, 'consent_given', 'testimonial', v_id::text, jsonb_build_object('display_mode', v_mode));
  perform cbt._voice_responded(uid, 'testimonial_invite', '');
  perform cbt._voice_event('testimonial_submitted', uid, v_id::text, v_id::text, jsonb_build_object('level', coalesce(v_rating, 0)));
  perform cbt._voice_event('testimonial_consent_given', uid, v_id::text, v_id::text, '{}');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Withdraw publication consent (also takes a published review down immediately). Idempotent.
create or replace function cbt.voice_withdraw_testimonial(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._voice_student(); v_rows int;
begin
  update cbt.testimonials set status = 'withdrawn', consent_withdrawn_at = coalesce(consent_withdrawn_at, now()), updated_at = now()
  where id = p_id and user_id = uid and status <> 'withdrawn';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    insert into cbt.voice_audit (actor, action, entity, entity_id) values (uid, 'consent_withdrawn', 'testimonial', p_id::text);
    perform cbt._voice_event('testimonial_consent_withdrawn', uid, p_id::text, p_id::text, '{}');
  end if;
  return jsonb_build_object('ok', true, 'changed', v_rows > 0);
end $$;

-- Erase: the text is removed for good (the audit keeps only that it happened).
create or replace function cbt.voice_delete_testimonial(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._voice_student(); v_rows int;
begin
  delete from cbt.testimonials where id = p_id and user_id = uid;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    insert into cbt.voice_audit (actor, action, entity, entity_id) values (uid, 'deleted_by_student', 'testimonial', p_id::text);
    perform cbt._voice_event('testimonial_consent_withdrawn', uid, p_id::text, p_id::text, '{}');
  end if;
  return jsonb_build_object('ok', v_rows > 0);
end $$;

-- The student answers an admin's suggested presentation edit. Only an accepted edit is ever shown publicly.
create or replace function cbt.voice_answer_edit(p_id uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._voice_student(); v_rows int;
begin
  update cbt.testimonials set edit_status = case when p_accept then 'accepted' else 'declined' end, updated_at = now()
  where id = p_id and user_id = uid and edit_status = 'awaiting_student';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then insert into cbt.voice_audit (actor, action, entity, entity_id) values (uid, case when p_accept then 'edit_accepted' else 'edit_declined' end, 'testimonial', p_id::text); end if;
  return jsonb_build_object('ok', v_rows > 0);
end $$;

-- The student's own submissions (never anyone else's).
create or replace function cbt.my_voice()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select case when auth.uid() is null or cbt.is_guest() then null else jsonb_build_object(
    'testimonials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'body', body, 'rating', rating, 'display_mode', display_mode,
                       'display_name', display_name, 'status', status, 'created_at', created_at, 'published_at', published_at,
                       'consent_withdrawn_at', consent_withdrawn_at, 'edited_body', case when edit_status <> 'none' then edited_body end,
                       'edit_status', edit_status) order by created_at desc), '[]'::jsonb)
                     from cbt.testimonials where user_id = auth.uid()),
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'category', category, 'rating', rating, 'helpful', helpful,
                   'body', body, 'created_at', created_at, 'status', case when status = 'deleted' then 'archived' else status end) order by created_at desc), '[]'::jsonb)
                 from (select * from cbt.feedback where user_id = auth.uid() order by created_at desc limit 20) f)) end $$;

-- ───────────────────────── public reviews ─────────────────────────
-- The only public read path: approved, consented, not withdrawn. Display fields only.
create or replace function cbt._voice_public_name(t cbt.testimonials) returns text
language sql stable security definer set search_path = cbt, pg_temp as $$
  select case t.display_mode
    when 'chosen' then coalesce(t.display_name, 'KAIRO student')
    when 'first' then coalesce(nullif(initcap(split_part(btrim(coalesce((select full_name from cbt.profiles where id = t.user_id), '')), ' ', 1)), ''), 'KAIRO student')
    else 'KAIRO student' end $$;
revoke execute on function cbt._voice_public_name(cbt.testimonials) from public, anon, authenticated;

create or replace function cbt.public_reviews(p_limit int default 12, p_offset int default 0, p_rating int default null)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with pub as (select * from cbt.testimonials where status = 'approved' and consent and consent_withdrawn_at is null and published_at is not null)
  select jsonb_build_object(
    'total', (select count(*) from pub where p_rating is null or rating = p_rating),
    'rated', (select count(*) from pub where rating is not null),
    'avg_rating', (select round(avg(rating)::numeric, 1) from pub where rating is not null),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', x.id, 'body', case when x.edit_status = 'accepted' and x.edited_body is not null then x.edited_body else x.body end,
                  'rating', x.rating, 'name', cbt._voice_public_name(x), 'published_at', x.published_at,
                  'verified', exists (select 1 from cbt.attempts a where a.user_id = x.user_id and a.status = 'final')) order by x.published_at desc), '[]'::jsonb)
                from (select * from pub where p_rating is null or rating = p_rating order by published_at desc
                      limit least(greatest(coalesce(p_limit, 12), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) x)) $$;

-- ───────────────────────── founder: settings ─────────────────────────
create or replace function cbt.fi_voice_settings()
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin perform cbt._require_admin(); return (select to_jsonb(s) - 'id' from cbt.voice_settings s where id); end $$;

create or replace function cbt.fi_voice_set_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin(); cur cbt.voice_settings;
begin
  select * into cur from cbt.voice_settings where id;
  update cbt.voice_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, cur.enabled),
    unsolicited_gap_days = coalesce((p ->> 'unsolicited_gap_days')::int, cur.unsolicited_gap_days),
    rating_gap_days = coalesce((p ->> 'rating_gap_days')::int, cur.rating_gap_days),
    practice_gap_days = coalesce((p ->> 'practice_gap_days')::int, cur.practice_gap_days),
    testimonial_gap_days = coalesce((p ->> 'testimonial_gap_days')::int, cur.testimonial_gap_days),
    practice_min_questions = coalesce((p ->> 'practice_min_questions')::int, cur.practice_min_questions),
    rating_after_sessions = coalesce((p ->> 'rating_after_sessions')::int, cur.rating_after_sessions),
    testimonial_after_days = coalesce((p ->> 'testimonial_after_days')::int, cur.testimonial_after_days),
    updated_at = now(), updated_by = uid
  where id;
  insert into cbt.voice_audit (actor, action, entity, detail) values (uid, 'settings_changed', 'settings', p);
  return cbt.fi_voice_settings();
end $$;

-- ───────────────────────── founder: analytics ─────────────────────────
-- Overall-experience ratings exclude records the admin deleted. Public-review stars are reported separately.
create or replace function cbt.fi_voice_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_f timestamptz := cbt._fi_ts(p_from); v_t timestamptz := cbt._fi_ts(p_to + 1); v_out jsonb;
begin
  perform cbt._require_admin();
  with f as (select * from cbt.feedback where created_at >= v_f and created_at < v_t and status <> 'deleted'),
       rt as (select * from f where category = 'overall' and rating is not null),
       pr as (select * from cbt.feedback_prompts where shown_at >= v_f and shown_at < v_t),
       days as (select d::date d from generate_series(p_from, p_to, interval '1 day') d),
       themes(theme, rx) as (values
         ('Praise: questions & practice', '(great|love|amazing|helpful|good|nice|best|awesome|thank).*(question|practice|quiz|app|kairo)|(question|practice|quiz|app|kairo).*(great|love|amazing|helpful|good|nice|best|awesome)'),
         ('Explanations', 'explanation|explain|solution|working|steps'),
         ('Difficulty', 'too (hard|difficult|easy)|difficult|tough|easy'),
         ('Technical problems', 'bug|error|crash|slow|load|freez|stuck|not working|network|login|log in|sign in'),
         ('More subjects / topics', 'subject|topic|syllabus|add more|more questions|literature|commerce|government|economics|biology|physics|chemistry'),
         ('Unclear or wrong questions', 'unclear|wrong answer|mistake|typo|incorrect|confusing'),
         ('Design & ease of use', 'design|layout|button|confus|hard to find|navigation|dark mode|font'))
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'first_feedback_at', (select min(created_at) from cbt.feedback),
    'ratings', jsonb_build_object(
      'count', (select count(*) from rt), 'avg', (select round(avg(rating)::numeric, 2) from rt),
      'positive', (select count(*) from rt where rating >= 4), 'neutral', (select count(*) from rt where rating = 3),
      'negative', (select count(*) from rt where rating <= 2),
      'dist', (select jsonb_agg(jsonb_build_object('stars', s, 'n', (select count(*) from rt where rating = s)) order by s desc) from generate_series(1, 5) s),
      'prompted', (select count(*) from rt where trigger = 'rating_prompt'), 'voluntary', (select count(*) from rt where trigger <> 'rating_prompt')),
    'response', jsonb_build_object(
      'rating_shown', (select count(*) from pr where prompt = 'experience_rating'),
      'rating_answered', (select count(*) from pr where prompt = 'experience_rating' and responded_at is not null),
      'prompts', (select coalesce(jsonb_agg(jsonb_build_object('prompt', prompt, 'shown', shown, 'answered', answered, 'dismissed', dismissed) order by prompt), '[]'::jsonb)
                  from (select prompt, count(*) shown, count(*) filter (where responded_at is not null) answered,
                               count(*) filter (where dismissed_at is not null and responded_at is null) dismissed from pr group by prompt) x)),
    'submissions', (select count(*) from f), 'written', (select count(*) from f where body is not null),
    'helpful', jsonb_build_object('very', (select count(*) from f where helpful = 'very'), 'okay', (select count(*) from f where helpful = 'okay'),
                                  'not', (select count(*) from f where helpful = 'not')),
    'reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', r, 'n', n) order by n desc), '[]'::jsonb) from (select unnest(reasons) r, count(*) n from f group by 1) x),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'n', n) order by n desc), '[]'::jsonb) from (select category, count(*) n from f group by 1) x),
    'features', (select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'n', n, 'not_helpful', nh) order by n desc), '[]'::jsonb)
                 from (select feature, count(*) n, count(*) filter (where helpful = 'not') nh from f where feature is not null group by 1) x),
    'themes', (select coalesce(jsonb_agg(jsonb_build_object('theme', theme, 'n', n, 'examples', ex) order by n desc), '[]'::jsonb) from (
                 select th.theme, count(f.id) n, (array_agg(f.id order by f.created_at desc))[1:3] ex
                 from themes th join f on f.body ~* th.rx group by th.theme) x where n > 0),
    'series', (select jsonb_agg(jsonb_build_object('day', d, 'submissions', (select count(*) from f where cbt._fi_day(created_at) = d),
                 'ratings', (select count(*) from rt where cbt._fi_day(created_at) = d)) order by d) from days),
    'testimonials', jsonb_build_object(
      'pending', (select count(*) from cbt.testimonials where status = 'pending'),
      'published', (select count(*) from cbt.testimonials where status = 'approved' and consent_withdrawn_at is null),
      'submitted_in_period', (select count(*) from cbt.testimonials where created_at >= v_f and created_at < v_t),
      'awaiting_student', (select count(*) from cbt.testimonials where edit_status = 'awaiting_student' and status = 'pending'),
      'public_avg_rating', (select round(avg(rating)::numeric, 2) from cbt.testimonials where status = 'approved' and consent_withdrawn_at is null and rating is not null),
      'public_rated', (select count(*) from cbt.testimonials where status = 'approved' and consent_withdrawn_at is null and rating is not null))
  ) into v_out;
  return v_out;
end $$;

-- Feedback explorer. Students appear as a stable pseudonymous reference; identity is a separate, audited call.
create or replace function cbt.fi_voice_feedback(p_from date, p_to date, p_filters jsonb default '{}', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_f timestamptz := cbt._fi_ts(p_from); v_t timestamptz := cbt._fi_ts(p_to + 1); r jsonb;
begin
  perform cbt._require_admin();
  with f as (
    select fb.* from cbt.feedback fb
    where fb.created_at >= v_f and fb.created_at < v_t
      and (p_filters ->> 'rating' is null or fb.rating = (p_filters ->> 'rating')::int)
      and (p_filters ->> 'category' is null or fb.category = p_filters ->> 'category')
      and (p_filters ->> 'feature' is null or fb.feature = p_filters ->> 'feature')
      and (p_filters ->> 'trigger' is null or fb.trigger = p_filters ->> 'trigger')
      and (p_filters ->> 'helpful' is null or fb.helpful = p_filters ->> 'helpful')
      and (case when p_filters ->> 'status' is null then fb.status <> 'deleted' else fb.status = p_filters ->> 'status' end)
      and (p_filters ->> 'written' is null or fb.body is not null)
      and (p_filters ->> 'ids' is null or fb.id::text = any(string_to_array(p_filters ->> 'ids', ','))))
  select jsonb_build_object('total', (select count(*) from f),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'category', x.category, 'rating', x.rating, 'helpful', x.helpful,
               'reasons', x.reasons, 'body', x.body, 'feature', x.feature, 'trigger', x.trigger, 'status', x.status, 'admin_note', x.admin_note,
               'has_attempt', x.attempt_id is not null, 'student', 'S-' || upper(left(md5(x.user_id::text), 6)),
               'consent', (select case when exists (select 1 from cbt.testimonials t where t.user_id = x.user_id and t.status = 'approved' and t.consent_withdrawn_at is null) then 'published review'
                                  when exists (select 1 from cbt.testimonials t where t.user_id = x.user_id and t.status = 'pending') then 'review pending'
                                  else 'private only' end)) order by x.created_at desc), '[]'::jsonb)
             from (select * from f order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x)) into r;
  return r;
end $$;

-- Who wrote this? Only when needed (e.g. to follow up a bug report). Every lookup is audited.
create or replace function cbt.fi_voice_identity(p_kind text, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin(); v_user uuid;
begin
  if p_kind = 'feedback' then select user_id into v_user from cbt.feedback where id = p_id;
  elsif p_kind = 'testimonial' then select user_id into v_user from cbt.testimonials where id = p_id;
  else raise exception 'bad kind' using errcode = '22023'; end if;
  if v_user is null then return null; end if;
  insert into cbt.voice_audit (actor, action, entity, entity_id, detail) values (uid, 'identity_viewed', 'identity', p_id::text, jsonb_build_object('kind', p_kind));
  return (select jsonb_build_object('user_id', v_user, 'name', c.full_name, 'email', c.email, 'phone', c.phone) from cbt._fi_contact(v_user) c);
end $$;

create or replace function cbt.fi_voice_set_feedback(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin(); v_rows int;
begin
  if p_status not in ('new','reviewed','actioned','archived','deleted') then raise exception 'bad status' using errcode = '22023'; end if;
  update cbt.feedback set status = p_status, admin_note = coalesce(left(p_note, 1000), admin_note), reviewed_by = uid, reviewed_at = now() where id = p_id;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then insert into cbt.voice_audit (actor, action, entity, entity_id, detail) values (uid, 'feedback_' || p_status, 'feedback', p_id::text, jsonb_build_object('note', p_note is not null)); end if;
  return jsonb_build_object('ok', v_rows > 0);
end $$;

-- ───────────────────────── founder: moderation ─────────────────────────
create or replace function cbt.fi_voice_testimonials(p_status text default 'pending', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  perform cbt._require_admin();
  return (select jsonb_build_object('total', (select count(*) from cbt.testimonials where p_status = 'all' or status = p_status),
    'rows', coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'body', t.body, 'rating', t.rating, 'display_mode', t.display_mode, 'display_name', t.display_name,
      'public_name', cbt._voice_public_name(t), 'consent', t.consent and t.consent_withdrawn_at is null, 'consent_at', t.consent_at,
      'consent_withdrawn_at', t.consent_withdrawn_at, 'status', t.status, 'created_at', t.created_at, 'published_at', t.published_at,
      'moderated_at', t.moderated_at, 'moderation_note', t.moderation_note, 'edited_body', t.edited_body, 'edit_status', t.edit_status,
      'student', 'S-' || upper(left(md5(t.user_id::text), 6)),
      'verified', exists (select 1 from cbt.attempts a where a.user_id = t.user_id and a.status = 'final'),
      'history', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'by_admin', a.actor is distinct from t.user_id) order by a.at), '[]'::jsonb)
                  from cbt.voice_audit a where a.entity = 'testimonial' and a.entity_id = t.id::text)) order by t.created_at desc), '[]'::jsonb))
    from (select * from cbt.testimonials where p_status = 'all' or status = p_status order by created_at desc
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) t);
end $$;

-- action: approve | reject | hide | note | suggest_edit | clear_edit
create or replace function cbt.fi_voice_moderate(p_id uuid, p_action text, p_note text default null, p_edited text default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_admin(); t cbt.testimonials; v_edit text;
begin
  select * into t from cbt.testimonials where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if not t.consent or t.consent_withdrawn_at is not null or t.status = 'withdrawn' then
      raise exception 'The student has withdrawn consent. This review cannot be published.' using errcode = '42501';
    end if;
    if t.edit_status = 'awaiting_student' then
      raise exception 'Waiting for the student to approve your edited version. Publish the original by clearing the edit first.' using errcode = '55000';
    end if;
    update cbt.testimonials set status = 'approved', published_at = coalesce(published_at, now()), moderated_by = uid, moderated_at = now(),
      moderation_note = coalesce(left(p_note, 1000), moderation_note), updated_at = now() where id = p_id;
    -- One published review per student: an older one steps down.
    update cbt.testimonials set status = 'hidden', updated_at = now() where user_id = t.user_id and id <> p_id and status = 'approved';
    perform cbt._voice_event('testimonial_published', t.user_id, p_id::text, p_id::text, '{}');
  elsif p_action = 'reject' then
    if t.status = 'withdrawn' then raise exception 'Already withdrawn by the student.' using errcode = '55000'; end if;
    update cbt.testimonials set status = 'rejected', moderated_by = uid, moderated_at = now(), moderation_note = coalesce(left(p_note, 1000), moderation_note), updated_at = now() where id = p_id;
  elsif p_action = 'hide' then
    if t.status <> 'approved' then raise exception 'Only a published review can be hidden.' using errcode = '55000'; end if;
    update cbt.testimonials set status = 'hidden', moderated_by = uid, moderated_at = now(), moderation_note = coalesce(left(p_note, 1000), moderation_note), updated_at = now() where id = p_id;
  elsif p_action = 'note' then
    update cbt.testimonials set moderation_note = left(p_note, 1000), updated_at = now() where id = p_id;
  elsif p_action = 'suggest_edit' then
    v_edit := cbt._voice_clean(p_edited, 600);
    if v_edit is null or char_length(v_edit) < 20 then raise exception 'The edited version needs at least 20 characters.' using errcode = '22023'; end if;
    if t.status not in ('pending', 'hidden', 'rejected') then raise exception 'Suggest edits before publishing (hide it first).' using errcode = '55000'; end if;
    update cbt.testimonials set edited_body = v_edit, edit_status = 'awaiting_student', status = 'pending', moderated_by = uid, moderated_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'clear_edit' then
    update cbt.testimonials set edited_body = null, edit_status = 'none', updated_at = now() where id = p_id;
  else
    raise exception 'bad action' using errcode = '22023';
  end if;
  insert into cbt.voice_audit (actor, action, entity, entity_id, detail)
  values (uid, 'moderation_' || p_action, 'testimonial', p_id::text, jsonb_build_object('note', p_note is not null, 'from_status', t.status));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────── grants ─────────────────────────
do $$ declare fn text; begin
  foreach fn in array array['cbt.voice_prompt(text, uuid)', 'cbt.voice_prompt_dismiss(text, text)', 'cbt.voice_submit_feedback(jsonb)',
      'cbt.voice_add_detail(uuid, jsonb, text)', 'cbt.voice_submit_testimonial(jsonb)', 'cbt.voice_withdraw_testimonial(uuid)',
      'cbt.voice_delete_testimonial(uuid)', 'cbt.voice_answer_edit(uuid, boolean)', 'cbt.my_voice()',
      'cbt.fi_voice_settings()', 'cbt.fi_voice_set_settings(jsonb)', 'cbt.fi_voice_overview(date, date)',
      'cbt.fi_voice_feedback(date, date, jsonb, int, int)', 'cbt.fi_voice_identity(text, uuid)', 'cbt.fi_voice_set_feedback(uuid, text, text)',
      'cbt.fi_voice_testimonials(text, int, int)', 'cbt.fi_voice_moderate(uuid, text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
revoke execute on function cbt.public_reviews(int, int, int) from public;
grant execute on function cbt.public_reviews(int, int, int) to anon, authenticated;
revoke execute on function cbt._voice_clean(text, int) from public, anon, authenticated;

-- Down (manual): drop function cbt.voice_* / cbt.fi_voice_* / cbt.public_reviews / cbt._voice_*;
--   drop table cbt.voice_audit, cbt.feedback_prompts, cbt.testimonials, cbt.feedback, cbt.voice_settings;
--   and restore the previous cbt._fi_event_names() (the 44 names before 'feedback_prompt_eligible').
