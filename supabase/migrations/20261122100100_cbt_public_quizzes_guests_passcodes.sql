-- Batch 2 (2/2): what the website shop window and the quiz runner need.
--   * assessments gain: slug, description, caption, topic_label, day_number, featured, guests_allowed, prize_text,
--     max_winners, result_config, share_image_url, source_note.
--   * Passcodes live in cbt.assessment_secrets (not a column on assessments): assessments are readable by every signed-in
--     student and get_paper serialises the whole row, so a hash there would leak. Staff set it with cbt.set_passcode().
--   * start_attempt: guests (Supabase anonymous sign-in) may play quizzes marked guests_allowed; their attempt is kept but
--     is not ranked until they create an account (claim_guest_rank). Unlimited attempts with only the FIRST counting for
--     rank; a quiz that sets attempts_allowed still caps attempts. A student who left mid-quiz resumes the same attempt
--     (any device) until deadline_at, with the answers already saved.
--   * save_answers: server-side autosave while the clock runs; never returns keys.
--   * public_quizzes / public_quiz / public_leaderboard: callable by the public website, no answers, initials only.
-- Scoring, keys and explanations stay server-side exactly as before (submit_attempt / get_review are unchanged).

-- ── 1. Columns ──────────────────────────────────────────────────────────────────────────────
alter table cbt.assessments
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists caption text,
  add column if not exists topic_label text,
  add column if not exists day_number int,
  add column if not exists featured boolean not null default false,
  add column if not exists guests_allowed boolean not null default false,
  add column if not exists prize_text text,
  add column if not exists max_winners smallint,
  add column if not exists result_config jsonb not null default '{}'::jsonb,
  add column if not exists share_image_url text,
  add column if not exists source_note text;
alter table cbt.assessments
  add constraint assessments_slug_format check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint assessments_max_winners_pos check (max_winners is null or max_winners > 0);
create unique index if not exists assessments_slug_key on cbt.assessments (slug) where slug is not null;
create index if not exists assessments_featured_idx on cbt.assessments (featured) where featured;

create table if not exists cbt.assessment_secrets (
  assessment_id uuid primary key references cbt.assessments(id),
  passcode_hash text            -- null = no passcode (cleared)
);
alter table cbt.assessment_secrets enable row level security;   -- no policies: only the functions below can touch it
revoke all on cbt.assessment_secrets from anon, authenticated;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────────────────────
create or replace function cbt.is_guest() returns boolean language sql stable set search_path = cbt, pg_temp as
$$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;

-- The state a runner needs to carry on an attempt: the attempt row, the server clock and the answers saved so far (no keys).
create or replace function cbt._attempt_state(t cbt.attempts, p_resumed boolean)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object('attempt', to_jsonb(t), 'resumed', p_resumed, 'server_now', now(),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', aa.question_id, 'selected', aa.selected_option,
                                                              'time_ms', aa.time_ms, 'flagged', aa.flagged))
                         from cbt.attempt_answers aa where aa.attempt_id = t.id), '[]'::jsonb)) $$;
revoke execute on function cbt._attempt_state(cbt.attempts, boolean) from public, anon, authenticated;

-- ── 3. Passcodes (staff only) ───────────────────────────────────────────────────────────────
create or replace function cbt.set_passcode(p_assessment uuid, p_passcode text)
returns void language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
begin
  if not cbt.is_staff() then raise exception 'editors only' using errcode = '42501'; end if;
  if not exists (select 1 from cbt.assessments where id = p_assessment) then raise exception 'unknown assessment' using errcode = 'P0002'; end if;
  insert into cbt.assessment_secrets (assessment_id, passcode_hash)
  values (p_assessment, case when nullif(btrim(p_passcode), '') is null then null
                             else extensions.crypt(btrim(p_passcode), extensions.gen_salt('bf')) end)
  on conflict (assessment_id) do update set passcode_hash = excluded.passcode_hash;
  insert into cbt.audit_log (actor, action, entity, entity_id, diff)
  values (auth.uid(), case when nullif(btrim(p_passcode), '') is null then 'passcode_cleared' else 'passcode_set' end, 'assessment', p_assessment::text, null);
end $$;
revoke execute on function cbt.set_passcode(uuid, text) from public, anon;
grant execute on function cbt.set_passcode(uuid, text) to authenticated;

-- ── 4. start_attempt ─────────────────────────────────────────────────────────────────────────
-- New 4-argument form (all arguments required, so calls are never ambiguous). The existing 3-argument form the app calls
-- today is kept and simply forwards with no passcode (see below), so the old form stays in place.
create or replace function cbt.start_attempt(p_attempt uuid, p_assessment uuid, p_device text, p_passcode text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; t cbt.attempts; uid uuid := auth.uid(); v_guest boolean := cbt.is_guest(); v_first boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform cbt.ensure_profile();

  -- Same attempt id again (refresh, retry): hand back the same attempt, the clock is not reset.
  select * into t from cbt.attempts where id = p_attempt;
  if t.id is not null then
    if t.user_id <> uid then raise exception 'attempt belongs to another user' using errcode = '42501'; end if;
    return cbt._attempt_state(t, true);
  end if;

  select * into a from cbt.assessments where id = p_assessment;
  if a.id is null or a.status <> 'live' or (a.opens_at is not null and now() < a.opens_at)
     or (a.closes_at is not null and now() >= a.closes_at)
     or (a.personal and a.created_by is distinct from uid) then
    raise exception 'assessment is not open' using errcode = 'P0001';
  end if;
  if v_guest and not a.guests_allowed then raise exception 'sign in to take this quiz' using errcode = '28000'; end if;

  -- Left mid-quiz (new phone, cleared storage): carry on with the unfinished attempt while time remains.
  select * into t from cbt.attempts
  where user_id = uid and assessment_id = a.id and status = 'in_progress' and (deadline_at is null or deadline_at > now())
  order by started_at desc limit 1;
  if t.id is not null then return cbt._attempt_state(t, true); end if;

  -- Passcode-protected: staff walk in; everyone else must know the code (only checked when starting afresh).
  if not cbt.is_staff() and exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null) then
    if nullif(btrim(p_passcode), '') is null or not exists (
         select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash = extensions.crypt(btrim(p_passcode), s.passcode_hash)) then
      raise exception 'wrong passcode' using errcode = '28P01';
    end if;
  end if;

  if a.attempts_allowed is not null and
     (select count(*) from cbt.attempts where user_id = uid and assessment_id = a.id and status in ('in_progress', 'final')) >= a.attempts_allowed then
    raise exception 'already attempted' using errcode = '23505';
  end if;

  -- Only the first attempt ever made counts for rank, and never a guest's until they have an account.
  v_first := a.ranked and not v_guest and not exists (select 1 from cbt.attempts where user_id = uid and assessment_id = a.id);

  insert into cbt.attempts (id, user_id, assessment_id, origin, counts_for_rank, shuffle_seed, started_at, deadline_at, device_id)
  values (p_attempt, uid, a.id, 'online', v_first, (random() * 2147483647)::int, now(),
          case when a.time_limit_sec is not null
               then least(now() + make_interval(secs => a.time_limit_sec), coalesce(a.closes_at, 'infinity')) end, p_device)
  returning * into t;
  return cbt._attempt_state(t, false);
end $$;
revoke execute on function cbt.start_attempt(uuid, uuid, text, text) from public, anon;
grant execute on function cbt.start_attempt(uuid, uuid, text, text) to authenticated;

create or replace function cbt.start_attempt(p_attempt uuid, p_assessment uuid, p_device text default null)
returns jsonb language sql volatile security definer set search_path = cbt, pg_temp as
$$ select cbt.start_attempt(p_attempt, p_assessment, p_device, null::text) $$;

-- ── 5. save_answers: autosave while the clock runs ──────────────────────────────────────────
create or replace function cbt.save_answers(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); t cbt.attempts; n int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from cbt.attempts where id = p_attempt for update;
  if t.id is null or t.user_id <> uid then raise exception 'unknown attempt' using errcode = 'P0002'; end if;
  if t.status <> 'in_progress' then raise exception 'attempt already finished' using errcode = 'P0001'; end if;
  if t.deadline_at is not null and now() > t.deadline_at then raise exception 'time is up' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'answers must be an array' using errcode = '22023'; end if;
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, time_ms, flagged)
  select t.id, aq.question_id, aq.question_version, nullif(upper(x ->> 'selected'), '')::char(1),
         greatest(0, coalesce((x ->> 'time_ms')::int, 0)), coalesce((x ->> 'flagged')::boolean, false)
  from jsonb_array_elements(p_answers) x
  join cbt.assessment_questions aq on aq.assessment_id = t.assessment_id and aq.question_id = (x ->> 'question_id')::uuid
  on conflict (attempt_id, question_id) do update
    set selected_option = excluded.selected_option, time_ms = excluded.time_ms, flagged = excluded.flagged;
  get diagnostics n = row_count;
  return jsonb_build_object('saved', n, 'server_now', now(), 'deadline_at', t.deadline_at);
end $$;
revoke execute on function cbt.save_answers(uuid, jsonb) from public, anon;
grant execute on function cbt.save_answers(uuid, jsonb) to authenticated;

-- ── 6. A guest who creates an account keeps their score and rank ────────────────────────────
-- Supabase keeps the same user id when an anonymous session gets an email/Google identity, so the finished attempt is
-- already theirs; this only switches on its rank, and only for the first attempt they ever made on that quiz.
create or replace function cbt.claim_guest_rank(p_attempt uuid)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); t cbt.attempts; a cbt.assessments;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if cbt.is_guest() then raise exception 'create an account first' using errcode = '28000'; end if;
  select * into t from cbt.attempts where id = p_attempt and user_id = uid for update;
  if t.id is null or t.status <> 'final' then raise exception 'no finished attempt' using errcode = 'P0002'; end if;
  select * into a from cbt.assessments where id = t.assessment_id;
  if a.ranked and not t.counts_for_rank and not exists (
       select 1 from cbt.attempts o where o.user_id = uid and o.assessment_id = t.assessment_id and o.id <> t.id and o.started_at < t.started_at) then
    update cbt.attempts set counts_for_rank = true where id = t.id returning * into t;
  end if;
  return jsonb_build_object('counts_for_rank', t.counts_for_rank, 'score', t.score, 'total', t.total);
end $$;
revoke execute on function cbt.claim_guest_rank(uuid) from public, anon;
grant execute on function cbt.claim_guest_rank(uuid) to authenticated;

-- ── 7. get_paper: passcode-protected quizzes hand out nothing before the code was accepted ──
create or replace function cbt.get_paper(p_assessment uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; with_keys boolean;
begin
  select * into a from cbt.assessments where id = p_assessment and status in ('live','closed');
  if a is null or (a.personal and a.created_by is distinct from auth.uid() and not cbt.is_staff()) then
    raise exception 'assessment not available' using errcode = 'P0002';
  end if;
  if a.ranked and a.status = 'live' and not cbt.is_staff() and not exists (
       select 1 from cbt.attempts where user_id = auth.uid() and assessment_id = a.id) then
    raise exception 'start the attempt first' using errcode = '42501';
  end if;
  if not cbt.is_staff() and exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null) and not exists (
       select 1 from cbt.attempts where user_id = auth.uid() and assessment_id = a.id) then
    raise exception 'enter the passcode first' using errcode = '42501';
  end if;
  -- Keys travel only with instant-feedback practice (offline marking). End-of-session papers stay keyless.
  with_keys := not a.ranked and a.offline_allowed and a.answers_visibility = 'per_question';
  return jsonb_build_object(
    'assessment', to_jsonb(a) - 'created_by',
    'questions', (select coalesce(jsonb_agg(
        jsonb_build_object('id', v.question_id, 'version', v.version, 'position', aq.position,
                           'stem_html', v.stem_html, 'passage_html', v.passage_html,
                           'options', v.options, 'topic_id', v.topic_id,
                           'subject', s.code, 'year', q.year, 'media_url', q.media_url)
        || case when with_keys then jsonb_build_object('correct_option', v.correct_option,
                                                         'explanation_html', v.explanation_html)
                else '{}'::jsonb end
        order by aq.position), '[]'::jsonb)
      from cbt.assessment_questions aq
      join cbt.question_versions v on v.question_id = aq.question_id and v.version = aq.question_version
      join cbt.questions q on q.id = aq.question_id
      join cbt.subjects s on s.id = q.subject_id
      where aq.assessment_id = a.id));
end $$;

-- ── 8. Public shop-window functions (no sign-in; no answers; nothing personal) ──────────────
create or replace function cbt._public_card(a cbt.assessments)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'title', a.title, 'description', a.description, 'type', a.type,
    'subject', (select s.name from cbt.subjects s where s.id = a.subject_id),
    'subject_code', (select s.code from cbt.subjects s where s.id = a.subject_id),
    'topic_label', a.topic_label, 'day_number', a.day_number,
    'question_count', (select count(*) from cbt.assessment_questions aq where aq.assessment_id = a.id),
    'time_limit_sec', a.time_limit_sec, 'opens_at', a.opens_at, 'closes_at', a.closes_at, 'status', a.status,
    'featured', a.featured, 'ranked', a.ranked, 'guests_allowed', a.guests_allowed,
    'prize_text', a.prize_text, 'max_winners', a.max_winners, 'share_image_url', a.share_image_url,
    'has_passcode', exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null),
    'attempts_count', (select count(*) from cbt.attempts t where t.assessment_id = a.id and t.status = 'final'),
    'players', (select count(distinct t.user_id) from cbt.attempts t where t.assessment_id = a.id and t.status = 'final'),
    'url', 'https://kairo.techmedng.com/q/' || a.id) $$;
revoke execute on function cbt._public_card(cbt.assessments) from public, anon, authenticated;

-- Live and scheduled quizzes, plus ones that closed in the last 30 days. Featured first, then newest.
create or replace function cbt.public_quizzes()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(cbt._public_card(a) order by a.featured desc, coalesce(a.opens_at, a.created_at) desc), '[]'::jsonb)
  from cbt.assessments a
  where a.slug is not null and not a.personal
    and (a.status in ('live', 'scheduled') or (a.status = 'closed' and a.closes_at > now() - interval '30 days')) $$;
revoke execute on function cbt.public_quizzes() from public;
grant execute on function cbt.public_quizzes() to anon, authenticated;

-- One quiz by its public slug (any visible state, so an old WhatsApp link still shows its result board).
create or replace function cbt.public_quiz(p_slug text)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select cbt._public_card(a) from cbt.assessments a
  where a.slug = p_slug and not a.personal and a.status in ('live', 'scheduled', 'closed', 'archived') $$;
revoke execute on function cbt.public_quiz(text) from public;
grant execute on function cbt.public_quiz(text) to anon, authenticated;

-- Top scorers: score, then fastest. Initials only (privacy), first attempts of real accounts only.
create or replace function cbt.public_leaderboard(p_assessment uuid, p_limit int default 10)
returns table(rank bigint, initials text, score smallint, total smallint, duration_sec int)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select r.rank, r.initials, r.score, r.total, r.duration_sec from (
    select rank() over (order by t.score desc, t.duration_sec asc, t.server_received_at asc) rank,
           coalesce(nullif(
             upper(left(split_part(btrim(p.full_name), ' ', 1), 1)) ||
             coalesce('.' || nullif(upper(left(nullif(split_part(btrim(p.full_name), ' ', 2), ''), 1)), '') || '.', '.'), '.'), 'Builder') initials,
           t.score, t.total, t.duration_sec, t.server_received_at
    from cbt.attempts t join cbt.profiles p on p.id = t.user_id join cbt.assessments a on a.id = t.assessment_id
    where t.assessment_id = p_assessment and t.counts_for_rank and t.status = 'final'
      and not a.personal and a.slug is not null and a.status in ('live', 'closed', 'archived')) r
  order by r.rank, r.server_received_at
  limit least(greatest(coalesce(p_limit, 10), 1), 100) $$;
revoke execute on function cbt.public_leaderboard(uuid, int) from public;
grant execute on function cbt.public_leaderboard(uuid, int) to anon, authenticated;
