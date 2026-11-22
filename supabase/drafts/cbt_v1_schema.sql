-- KAIRO v1 assessment engine: schema `cbt`
-- Applied 18 Nov 2026. Behaviour tests: supabase/drafts/tests/run.sh (runs this file's draft copy).
-- Target: Supabase project unbgborbhxzsotaieiun (shared with techmedng.com).
--
-- Principles:
--   * The server marks. Clients send selections and the server decides correctness.
--   * Answer keys live in tables students can never SELECT. Students read
--     them only through RPCs that check the assessment's feedback rules.
--   * attempts.id is a UUID made on the phone, so re-sending an attempt
--     can never create a duplicate.
--   * Answers point at an immutable question version.
--   * RLS on every table. anon has no table access at all.

create schema if not exists cbt;
revoke all on schema cbt from public;
grant usage on schema cbt to authenticated, service_role;

-- ───────────────────────── Types ─────────────────────────
create type cbt.user_role        as enum ('student','editor','admin');
create type cbt.track            as enum ('medical','engineering','other');
create type cbt.question_status  as enum ('draft','reviewed','published','retired');
create type cbt.assessment_type  as enum ('practice','topic_test','daily_quiz','weekly_drill','mock');
create type cbt.assessment_status as enum ('draft','scheduled','live','closed','archived');
create type cbt.answers_visibility as enum ('per_question','after_submit','after_close');
create type cbt.attempt_status   as enum ('in_progress','final','rejected');
create type cbt.attempt_origin   as enum ('online','offline');

-- ───────────────────────── Reference ─────────────────────────
create table cbt.subjects (
  id    smallint generated always as identity primary key,
  code  text not null unique,           -- 'ENG','MTH','PHY','CHM','BIO'
  name  text not null unique
);

create table cbt.topics (
  id              integer generated always as identity primary key,
  subject_id      smallint not null references cbt.subjects(id),
  parent_topic_id integer references cbt.topics(id),
  name            text not null,
  unique (subject_id, parent_topic_id, name)
);

-- ───────────────────────── People ─────────────────────────
create table cbt.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  email       text,
  role        cbt.user_role not null default 'student',
  track       cbt.track,
  exam_year   smallint check (exam_year between 2024 and 2035),
  subjects    smallint[] not null default '{}',
  referral_code text unique,
  created_at  timestamptz not null default now()
);

create or replace function cbt.my_role() returns cbt.user_role
language sql stable security definer set search_path = cbt, pg_temp as
$$ select coalesce((select role from cbt.profiles where id = auth.uid()), 'student'::cbt.user_role) $$;

create or replace function cbt.is_staff() returns boolean
language sql stable security definer set search_path = cbt, pg_temp as
$$ select cbt.my_role() in ('editor','admin') $$;

-- ───────────────────────── Question bank ─────────────────────────
create table cbt.questions (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text,                              -- e.g. kairo.questions.id 'physics_0543'
  source_ref   text unique,                       -- e.g. 'myschool:q15470', so re-scraped files update in place
  subject_id   smallint not null references cbt.subjects(id),
  topic_id     integer references cbt.topics(id),
  year         smallint,
  source       text not null default 'jamb',
  stem         text not null check (length(btrim(stem)) > 0),
  stem_html    text,                              -- KaTeX pre-rendered at save time
  passage_id   uuid,                              -- comprehension passage shared by several questions
  options      jsonb not null,                    -- [{key:'A',html}, ...] 4 options, or 5 (A-E) for pre-2000 papers
  media_url    text,
  difficulty   smallint check (difficulty between 1 and 5),
  status       cbt.question_status not null default 'draft',
  version      integer not null default 1,
  content_hash text not null,                     -- normalised stem, for finding duplicates
  reviewed_by  uuid references cbt.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint options_shape check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 4 and 5
  )
);
create index on cbt.questions (subject_id, topic_id, status);
create index on cbt.questions (content_hash);

create table cbt.passages (
  id        uuid primary key default gen_random_uuid(),
  source_ref text unique,                          -- e.g. myschool 'ref:2'
  html      text not null
);
alter table cbt.questions add constraint questions_passage_fk foreign key (passage_id) references cbt.passages(id);

-- Keys and explanations are kept apart so a plain SELECT can never leak them.
create table cbt.question_keys (
  question_id    uuid primary key references cbt.questions(id) on delete cascade,
  correct_option char(1) not null check (correct_option in ('A','B','C','D','E')),
  key_source     text not null default 'source' check (key_source in ('source','editor','ai_legacy')),
  explanation    text,
  explanation_html text
);

-- Immutable snapshot of every published version. Attempts point here.
create table cbt.question_versions (
  question_id    uuid not null references cbt.questions(id),
  version        integer not null,
  stem_html      text not null,
  options        jsonb not null,
  correct_option char(1) not null,
  explanation_html text,
  passage_html   text,
  topic_id       integer references cbt.topics(id),
  created_at     timestamptz not null default now(),
  primary key (question_id, version)
);

-- Snapshot on publish; publishing an edit bumps the version.
create or replace function cbt.snapshot_question() returns trigger
language plpgsql security definer set search_path = cbt, pg_temp as $$
declare k cbt.question_keys;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published'
     or old.stem is distinct from new.stem or old.options is distinct from new.options) then
    if tg_op = 'UPDATE' and old.status = 'published' then
      new.version := old.version + 1;
    end if;
    select * into k from cbt.question_keys where question_id = new.id;
    if k is null then raise exception 'question % has no answer key', new.id; end if;
    insert into cbt.question_versions (question_id, version, stem_html, options, correct_option, explanation_html,
                                       passage_html, topic_id)
    values (new.id, new.version, coalesce(new.stem_html, new.stem), new.options, k.correct_option,
            coalesce(k.explanation_html, k.explanation),
            (select html from cbt.passages where id = new.passage_id), new.topic_id)
    on conflict (question_id, version) do update
      set stem_html = excluded.stem_html, options = excluded.options,
          correct_option = excluded.correct_option, explanation_html = excluded.explanation_html,
          passage_html = excluded.passage_html, topic_id = excluded.topic_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger questions_snapshot before insert or update on cbt.questions
  for each row execute function cbt.snapshot_question();

create table cbt.question_reports (
  id          bigint generated always as identity primary key,
  question_id uuid not null references cbt.questions(id),
  user_id     uuid not null references cbt.profiles(id),
  reason      text not null check (reason in ('wrong_key','typo','unclear','missing_content','other')),
  note        text check (length(note) <= 1000),
  status      text not null default 'open' check (status in ('open','resolved','rejected')),
  created_at  timestamptz not null default now(),
  unique (question_id, user_id)
);

-- ───────────────────────── Assessments ─────────────────────────
create table cbt.assessments (
  id                 uuid primary key default gen_random_uuid(),
  type               cbt.assessment_type not null,
  title              text not null,
  subject_id         smallint references cbt.subjects(id),  -- null = mixed
  track              cbt.track,                             -- weekly drill version
  time_limit_sec     integer check (time_limit_sec > 0),     -- null = untimed
  opens_at           timestamptz,
  closes_at          timestamptz,
  attempts_allowed   smallint,                              -- null = unlimited
  shuffle_questions  boolean not null default false,
  shuffle_options    boolean not null default false,
  answers_visibility cbt.answers_visibility not null default 'after_submit',
  ranked             boolean not null default false,
  offline_allowed    boolean not null default false,
  status             cbt.assessment_status not null default 'draft',
  created_by         uuid references cbt.profiles(id),
  created_at         timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at > opens_at),
  check (not (ranked and offline_allowed))
);
create index on cbt.assessments (type, opens_at);
-- Only one daily quiz per WAT calendar day.
create unique index one_daily_quiz_per_day on cbt.assessments (((opens_at at time zone 'Africa/Lagos')::date))
  where type = 'daily_quiz' and status <> 'archived';

create table cbt.assessment_questions (
  assessment_id    uuid not null references cbt.assessments(id) on delete cascade,
  question_id      uuid not null,
  question_version integer not null,
  position         smallint not null,
  primary key (assessment_id, question_id),
  unique (assessment_id, position),
  foreign key (question_id, question_version) references cbt.question_versions(question_id, version)
);

-- ───────────────────────── Attempts ─────────────────────────
create table cbt.attempts (
  id                 uuid primary key,                -- generated on the phone
  user_id            uuid not null references cbt.profiles(id),
  assessment_id      uuid not null references cbt.assessments(id),
  status             cbt.attempt_status not null default 'in_progress',
  origin             cbt.attempt_origin not null,
  counts_for_rank    boolean not null default false,
  reject_reason      text,
  shuffle_seed       integer,
  started_at         timestamptz not null,            -- server time for online attempts
  deadline_at        timestamptz,                     -- server-set for timed online attempts
  submitted_at       timestamptz,                     -- as reported by the client
  duration_sec       integer check (duration_sec >= 0),
  score              smallint,
  total              smallint,
  device_id          text,
  server_received_at timestamptz,
  created_at         timestamptz not null default now()
);
-- One ranked attempt per student per assessment, enforced by the database.
create unique index one_ranked_attempt on cbt.attempts (user_id, assessment_id) where counts_for_rank;
create index on cbt.attempts (assessment_id, status) where counts_for_rank;
create index on cbt.attempts (user_id, server_received_at desc);

create table cbt.attempt_answers (
  attempt_id       uuid not null references cbt.attempts(id) on delete cascade,
  question_id      uuid not null,
  question_version integer not null,
  selected_option  char(1) check (selected_option in ('A','B','C','D','E')),  -- canonical key, after un-shuffling
  is_correct       boolean,                                               -- set only by the server
  time_ms          integer check (time_ms >= 0),
  flagged          boolean not null default false,
  primary key (attempt_id, question_id),
  foreign key (question_id, question_version) references cbt.question_versions(question_id, version)
);

create table cbt.topic_stats (
  user_id         uuid not null references cbt.profiles(id) on delete cascade,
  topic_id        integer not null references cbt.topics(id),
  attempted       integer not null default 0,
  correct         integer not null default 0,
  last_attempt_at timestamptz,
  primary key (user_id, topic_id)
);

create table cbt.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  diff       jsonb,
  at         timestamptz not null default now()
);

-- ───────────────────────── RLS ─────────────────────────
alter table cbt.subjects             enable row level security;
alter table cbt.topics               enable row level security;
alter table cbt.profiles             enable row level security;
alter table cbt.questions            enable row level security;
alter table cbt.question_keys        enable row level security;
alter table cbt.passages             enable row level security;
alter table cbt.question_versions    enable row level security;
alter table cbt.question_reports     enable row level security;
alter table cbt.assessments          enable row level security;
alter table cbt.assessment_questions enable row level security;
alter table cbt.attempts             enable row level security;
alter table cbt.attempt_answers      enable row level security;
alter table cbt.topic_stats          enable row level security;
alter table cbt.audit_log            enable row level security;

-- Reference data: readable by signed-in users.
create policy read_subjects on cbt.subjects for select to authenticated using (true);
create policy read_topics   on cbt.topics   for select to authenticated using (true);
grant select on cbt.subjects, cbt.topics to authenticated;

-- Profiles: read and update your own row, but students can never change role.
create policy own_profile_read   on cbt.profiles for select to authenticated using (id = auth.uid() or cbt.is_staff());
create policy own_profile_update on cbt.profiles for update to authenticated using (id = auth.uid());
grant select on cbt.profiles to authenticated;
grant update (full_name, phone, track, exam_year, subjects) on cbt.profiles to authenticated;

-- Question bank: staff only through tables. Students get questions only via RPCs.
create policy staff_questions on cbt.questions         for all to authenticated using (cbt.is_staff()) with check (cbt.is_staff());
create policy staff_keys      on cbt.question_keys     for all to authenticated using (cbt.is_staff()) with check (cbt.is_staff());
create policy staff_passages on cbt.passages          for all to authenticated using (cbt.is_staff()) with check (cbt.is_staff());
create policy staff_versions  on cbt.question_versions for select to authenticated using (cbt.is_staff());
grant select, insert, update on cbt.questions, cbt.question_keys, cbt.passages to authenticated;
grant select on cbt.question_versions to authenticated;

-- Reports: students file and read their own; staff see and resolve all.
create policy file_report  on cbt.question_reports for insert to authenticated with check (user_id = auth.uid());
create policy read_reports on cbt.question_reports for select to authenticated using (user_id = auth.uid() or cbt.is_staff());
create policy staff_resolve on cbt.question_reports for update to authenticated using (cbt.is_staff());
grant select, insert on cbt.question_reports to authenticated;
grant update (status) on cbt.question_reports to authenticated;

-- Assessments: students see live/closed ones; staff manage everything.
create policy read_assessments  on cbt.assessments for select to authenticated using (status in ('live','closed') or cbt.is_staff());
create policy staff_assessments on cbt.assessments for all to authenticated using (cbt.is_staff()) with check (cbt.is_staff());
create policy staff_aq          on cbt.assessment_questions for all to authenticated using (cbt.is_staff()) with check (cbt.is_staff());
grant select, insert, update on cbt.assessments, cbt.assessment_questions to authenticated;

-- Attempts: read your own; all writes go through RPCs.
create policy own_attempts on cbt.attempts        for select to authenticated using (user_id = auth.uid() or cbt.is_staff());
create policy own_answers  on cbt.attempt_answers for select to authenticated
  using (exists (select 1 from cbt.attempts a where a.id = attempt_id and (a.user_id = auth.uid() or cbt.is_staff())));
create policy own_stats    on cbt.topic_stats     for select to authenticated using (user_id = auth.uid() or cbt.is_staff());
create policy staff_audit  on cbt.audit_log       for select to authenticated using (cbt.my_role() = 'admin');
grant select on cbt.attempts, cbt.attempt_answers, cbt.topic_stats, cbt.audit_log to authenticated;

-- ───────────────────────── RPCs ─────────────────────────

-- Create the caller's KAIRO profile on first visit (auth.users is shared with TECHMED,
-- so we don't put a trigger on it).
create or replace function cbt.ensure_profile(p_full_name text default null)
returns cbt.profiles language plpgsql security definer set search_path = cbt, pg_temp as $$
declare r cbt.profiles;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into cbt.profiles (id, full_name, email)
  values (auth.uid(), coalesce(p_full_name, ''), auth.jwt() ->> 'email')
  on conflict (id) do nothing;
  select * into r from cbt.profiles where id = auth.uid();
  return r;
end $$;

-- Paper for an assessment, without keys. Practice packs (offline_allowed and unranked)
-- include keys and explanations so marking works offline.
create or replace function cbt.get_paper(p_assessment uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; with_keys boolean;
begin
  select * into a from cbt.assessments where id = p_assessment and status in ('live','closed');
  if a is null then raise exception 'assessment not available' using errcode = 'P0002'; end if;
  -- A live ranked paper is visible only to someone whose timer has started.
  if a.ranked and a.status = 'live' and not cbt.is_staff() and not exists (
       select 1 from cbt.attempts where user_id = auth.uid() and assessment_id = a.id) then
    raise exception 'start the attempt first' using errcode = '42501';
  end if;
  with_keys := not a.ranked and a.offline_allowed;
  return jsonb_build_object(
    'assessment', to_jsonb(a) - 'created_by',
    'questions', (select coalesce(jsonb_agg(
        jsonb_build_object('id', v.question_id, 'version', v.version, 'position', aq.position,
                           'stem_html', v.stem_html, 'passage_html', v.passage_html,
                           'options', v.options, 'topic_id', v.topic_id)
        || case when with_keys then jsonb_build_object('correct_option', v.correct_option,
                                                         'explanation_html', v.explanation_html)
                else '{}'::jsonb end
        order by aq.position), '[]'::jsonb)
      from cbt.assessment_questions aq
      join cbt.question_versions v on v.question_id = aq.question_id and v.version = aq.question_version
      where aq.assessment_id = a.id));
end $$;

-- Start (or resume) an online attempt. The server sets the start time and deadline,
-- so refreshing the page or changing the phone clock can't buy extra time.
create or replace function cbt.start_attempt(p_attempt uuid, p_assessment uuid, p_device text default null)
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; t cbt.attempts; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform cbt.ensure_profile();
  select * into t from cbt.attempts where id = p_attempt;
  if t.id is not null then
    if t.user_id <> uid then raise exception 'attempt belongs to another user' using errcode = '42501'; end if;
    return jsonb_build_object('attempt', to_jsonb(t), 'resumed', true, 'server_now', now());
  end if;
  select * into a from cbt.assessments where id = p_assessment;
  if a is null or a.status <> 'live' or (a.opens_at is not null and now() < a.opens_at)
     or (a.closes_at is not null and now() >= a.closes_at) then
    raise exception 'assessment is not open' using errcode = 'P0001';
  end if;
  if a.ranked and exists (select 1 from cbt.attempts where user_id = uid and assessment_id = a.id and counts_for_rank) then
    raise exception 'already attempted' using errcode = '23505';
  end if;
  insert into cbt.attempts (id, user_id, assessment_id, origin, counts_for_rank, shuffle_seed,
                            started_at, deadline_at, device_id)
  values (p_attempt, uid, a.id, 'online', a.ranked, (random() * 2147483647)::int, now(),
          case when a.time_limit_sec is not null
               then least(now() + make_interval(secs => a.time_limit_sec), coalesce(a.closes_at, 'infinity'))
          end, p_device)
  returning * into t;
  return jsonb_build_object('attempt', to_jsonb(t), 'resumed', false, 'server_now', now());
end $$;

-- Submit an attempt. Idempotent on attempt id: re-sending returns the stored result.
-- payload: {id, assessment_id, origin, started_at, submitted_at, duration_sec, device_id,
--           answers:[{question_id, version, selected, time_ms, flagged}]}
create or replace function cbt.submit_attempt(p jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  a cbt.assessments; t cbt.attempts;
  v_id uuid := (p ->> 'id')::uuid;
  v_origin cbt.attempt_origin := coalesce(p ->> 'origin', 'offline')::cbt.attempt_origin;
  v_grace interval := interval '10 minutes';   -- covers a short signal drop at time-up
  v_reject text;
  v_score int; v_total int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if v_id is null then raise exception 'attempt id required' using errcode = '22023'; end if;
  perform cbt.ensure_profile();

  -- Lock per attempt id so two sends at the same moment can't both mark it.
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  select * into t from cbt.attempts where id = v_id;
  if t.id is not null and t.user_id <> uid then
    raise exception 'attempt belongs to another user' using errcode = '42501';
  end if;
  if t.status in ('final','rejected') then
    return jsonb_build_object('status', t.status, 'already_received', true, 'score', t.score,
                              'total', t.total, 'reject_reason', t.reject_reason);
  end if;

  select * into a from cbt.assessments where id = coalesce(t.assessment_id, (p ->> 'assessment_id')::uuid);
  if a is null then raise exception 'unknown assessment' using errcode = 'P0002'; end if;

  if t.id is null then
    -- Never started online: allowed only for offline-capable, unranked assessments.
    if a.ranked or not a.offline_allowed then
      v_reject := 'must_start_online';
    end if;
    insert into cbt.attempts (id, user_id, assessment_id, origin, counts_for_rank, started_at, device_id)
    values (v_id, uid, a.id, v_origin, false,
            coalesce((p ->> 'started_at')::timestamptz, now()), p ->> 'device_id')
    returning * into t;
  elsif t.deadline_at is not null and now() > t.deadline_at + v_grace then
    v_reject := 'submitted_after_deadline';
  end if;

  if a.attempts_allowed is not null and not a.ranked and
     (select count(*) from cbt.attempts where user_id = uid and assessment_id = a.id and status = 'final')
       >= a.attempts_allowed then
    v_reject := 'attempt_limit_reached';
  end if;

  -- Record the answers, keeping only questions that belong to this assessment.
  insert into cbt.attempt_answers (attempt_id, question_id, question_version, selected_option, time_ms, flagged)
  select t.id, aq.question_id, aq.question_version,
         nullif(upper(x ->> 'selected'), '')::char(1),
         greatest(0, coalesce((x ->> 'time_ms')::int, 0)),
         coalesce((x ->> 'flagged')::boolean, false)
  from jsonb_array_elements(coalesce(p -> 'answers', '[]'::jsonb)) x
  join cbt.assessment_questions aq on aq.assessment_id = a.id and aq.question_id = (x ->> 'question_id')::uuid
  on conflict (attempt_id, question_id) do update
    set selected_option = excluded.selected_option, time_ms = excluded.time_ms, flagged = excluded.flagged;

  -- Mark against the frozen version.
  update cbt.attempt_answers aa set is_correct = (aa.selected_option = v.correct_option)
  from cbt.question_versions v
  where aa.attempt_id = t.id and v.question_id = aa.question_id and v.version = aa.question_version;

  select count(*) into v_total from cbt.assessment_questions where assessment_id = a.id;
  select count(*) filter (where is_correct) into v_score from cbt.attempt_answers where attempt_id = t.id;

  update cbt.attempts set
    status = case when v_reject is null then 'final' else 'rejected' end::cbt.attempt_status,
    counts_for_rank = counts_for_rank and v_reject is null,
    reject_reason = v_reject,
    score = v_score, total = v_total,
    submitted_at = coalesce((p ->> 'submitted_at')::timestamptz, now()),
    duration_sec = case
      when t.deadline_at is not null   -- online timed: server clock, capped at the time limit
        then least(extract(epoch from (now() - t.started_at))::int, coalesce(a.time_limit_sec, 2147483647))
      else least(greatest(coalesce((p ->> 'duration_sec')::int, 0), 0), coalesce(a.time_limit_sec, 86400))
    end,
    server_received_at = now()
  where id = t.id
  returning * into t;

  -- Topic mastery counts final attempts only (rejected ranked attempts still count as practice).
  insert into cbt.topic_stats (user_id, topic_id, attempted, correct, last_attempt_at)
  select uid, v.topic_id, count(*), count(*) filter (where aa.is_correct), now()
  from cbt.attempt_answers aa
  join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
  where aa.attempt_id = t.id and aa.selected_option is not null and v.topic_id is not null
  group by v.topic_id
  on conflict (user_id, topic_id) do update
    set attempted = topic_stats.attempted + excluded.attempted,
        correct = topic_stats.correct + excluded.correct,
        last_attempt_at = excluded.last_attempt_at;

  return jsonb_build_object('status', t.status, 'already_received', false, 'score', t.score,
                            'total', t.total, 'reject_reason', t.reject_reason,
                            'duration_sec', t.duration_sec);
end $$;

-- Review: correct answers and explanations, only once the assessment's rules allow it.
create or replace function cbt.get_review(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare t cbt.attempts; a cbt.assessments; reveal boolean;
begin
  select * into t from cbt.attempts where id = p_attempt and (user_id = auth.uid() or cbt.is_staff());
  if t is null or t.status = 'in_progress' then raise exception 'no finished attempt' using errcode = 'P0002'; end if;
  select * into a from cbt.assessments where id = t.assessment_id;
  reveal := case a.answers_visibility
              when 'after_close' then a.closes_at is not null and now() >= a.closes_at
              else true end;
  return jsonb_build_object(
    'attempt', to_jsonb(t), 'answers_revealed', reveal,
    'items', (select jsonb_agg(jsonb_build_object(
        'question_id', aa.question_id, 'stem_html', v.stem_html, 'passage_html', v.passage_html, 'options', v.options,
        'selected', aa.selected_option, 'is_correct', aa.is_correct, 'flagged', aa.flagged)
        || case when reveal then jsonb_build_object('correct_option', v.correct_option,
                                                     'explanation_html', v.explanation_html)
                else '{}'::jsonb end
        order by aq.position)
      from cbt.attempt_answers aa
      join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
      join cbt.assessment_questions aq on aq.assessment_id = t.assessment_id and aq.question_id = aa.question_id
      where aa.attempt_id = t.id));
end $$;

-- Leaderboard: server-marked first ranked attempts only.
-- Tie-break: score, then shorter duration, then earlier submit. Names shown as first name + last initial.
create or replace function cbt.leaderboard(p_assessment uuid, p_limit int default 100)
returns table (rank bigint, user_id uuid, display_name text, score smallint, total smallint,
               accuracy numeric, duration_sec int, is_me boolean)
language sql stable security definer set search_path = cbt, pg_temp as $$
  with ranked as (
    select t.user_id, t.score, t.total, t.duration_sec, t.server_received_at,
           rank() over (order by t.score desc, t.duration_sec asc, t.server_received_at asc) as rank
    from cbt.attempts t
    where t.assessment_id = p_assessment and t.counts_for_rank and t.status = 'final'
  )
  select r.rank, case when r.user_id = auth.uid() then r.user_id end,
         split_part(p.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', ''),
         r.score, r.total, round(100.0 * r.score / nullif(r.total, 0), 1), r.duration_sec,
         r.user_id = auth.uid()
  from ranked r join cbt.profiles p on p.id = r.user_id
  where r.rank <= p_limit or r.user_id = auth.uid()   -- your own row is always included
  order by r.rank;
$$;

-- TECHMED dashboard contract: the caller's finalised results since a given time.
create or replace function cbt.my_results(p_since timestamptz default '-infinity')
returns table (attempt_id uuid, assessment_id uuid, assessment_type cbt.assessment_type, title text,
               score smallint, total smallint, percentage numeric, rank bigint,
               submitted_at timestamptz, topics jsonb)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select t.id, a.id, a.type, a.title, t.score, t.total,
         round(100.0 * t.score / nullif(t.total, 0), 1),
         case when t.counts_for_rank then (
           select 1 + count(*) from cbt.attempts o
           where o.assessment_id = t.assessment_id and o.counts_for_rank and o.status = 'final'
             and (o.score > t.score
                  or (o.score = t.score and o.duration_sec < t.duration_sec)
                  or (o.score = t.score and o.duration_sec = t.duration_sec and o.server_received_at < t.server_received_at)))
         end,
         t.server_received_at,
         (select jsonb_agg(jsonb_build_object('topic_id', topic_id, 'correct', c, 'attempted', n))
          from (select v.topic_id, count(*) filter (where aa.is_correct) c, count(*) n
                from cbt.attempt_answers aa
                join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
                where aa.attempt_id = t.id group by v.topic_id) s)
  from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
  where t.user_id = auth.uid() and t.status = 'final' and t.server_received_at > p_since
  order by t.server_received_at desc;
$$;

-- "Take today's quiz" card for techmedng.com (works signed out too).
create or replace function cbt.todays_quiz()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object('id', id, 'title', title, 'opens_at', opens_at, 'closes_at', closes_at,
                            'url', 'https://kairo.techmedng.com/q/' || id)
  from cbt.assessments
  -- Daily quizzes stay open forever (spec v0.2): "today's" quiz is the most recent one that has opened.
  where type = 'daily_quiz' and status = 'live' and now() >= opens_at and (closes_at is null or now() < closes_at)
  order by opens_at desc limit 1;
$$;

-- Lock down execution: nothing is callable unless granted below.
revoke execute on all functions in schema cbt from public;
grant execute on function cbt.ensure_profile(text), cbt.get_paper(uuid), cbt.start_attempt(uuid, uuid, text),
  cbt.submit_attempt(jsonb), cbt.get_review(uuid), cbt.leaderboard(uuid, int), cbt.my_results(timestamptz),
  cbt.todays_quiz(), cbt.my_role(), cbt.is_staff()
  to authenticated;
grant execute on function cbt.todays_quiz() to anon;
grant usage on schema cbt to anon;
-- Server-side jobs (cron, Edge Functions) use service_role: it bypasses RLS but still needs grants.
grant all on all tables in schema cbt to service_role;
grant all on all sequences in schema cbt to service_role;
grant execute on all functions in schema cbt to service_role;

-- TODO (Phase 2): publish/import RPCs, auto-pull at 3+ open reports, audit triggers,
-- daily-quiz pg_cron jobs (publish 05:00 UTC, check 19:00 UTC, auto-build 04:30 UTC).
