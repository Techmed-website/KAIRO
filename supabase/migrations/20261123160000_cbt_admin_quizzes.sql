-- Batch 6: editors and admins create and run their own quizzes, challenges and competitions from KAIRO.
-- Every function here checks cbt.is_staff() and writes what it did to cbt.audit_log. Nothing is removed: quizzes are
-- closed or archived, attempts are rejected (with a reason), questions are retired.
--
--   admin_question_search(p)         find questions by subject / topic / years / text; or pick N at random
--   admin_save_quiz(p)               create or edit a quiz (questions, timing, ranking, passcode, prize, result images)
--   admin_quiz_action(id, action)    publish_now / close / reopen / archive / duplicate
--   admin_quiz_list(p)               quizzes with players, attempts and state
--   admin_quiz_detail(id)            one quiz: settings, questions, caption and link
--   admin_quiz_results(id)           every attempt (for the results table and CSV export)
--   admin_set_attempt(id, reject, reason) take an attempt off the leaderboard, or put it back
--   admin_question_update(id, p)     retire / restore a question, set difficulty 1-5

create or replace function cbt._require_staff() returns uuid language plpgsql stable security definer set search_path = cbt, pg_temp as $$
begin
  if auth.uid() is null or not cbt.is_staff() then raise exception 'editors only' using errcode = '42501'; end if;
  return auth.uid();
end $$;
revoke execute on function cbt._require_staff() from public, anon, authenticated;

create or replace function cbt._audit(p_action text, p_entity text, p_id text, p_diff jsonb default null) returns void
language sql volatile security definer set search_path = cbt, pg_temp as
$$ insert into cbt.audit_log (actor, action, entity, entity_id, diff) values (auth.uid(), p_action, p_entity, p_id, p_diff) $$;
revoke execute on function cbt._audit(text, text, text, jsonb) from public, anon, authenticated;

-- A unique, clean web address from a title: "june-mock-challenge", then "-2", "-3"... if taken.
create or replace function cbt._unique_slug(p_title text, p_except uuid default null) returns text
language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare base text := coalesce(nullif(cbt.slugify(p_title), ''), 'quiz'); s text := base; n int := 1;
begin
  while exists (select 1 from cbt.assessments where slug = s and id is distinct from p_except) loop
    n := n + 1; s := left(base, 75) || '-' || n;
  end loop;
  return s;
end $$;
revoke execute on function cbt._unique_slug(text, uuid) from public, anon, authenticated;

-- The WhatsApp caption for quizzes made by editors (daily quizzes keep their own caption from the builder).
create or replace function cbt._quiz_caption(a cbt.assessments, p_has_passcode boolean) returns text
language sql stable security definer set search_path = cbt, pg_temp as $$
  select concat_ws(E'\n',
    case a.type when 'challenge' then '🏆 ' when 'mock' then '📝 ' else '🎯 ' end || a.title,
    nullif(btrim(coalesce(a.description, '')), ''),
    '',
    '📝 ' || (select count(*) from cbt.assessment_questions aq where aq.assessment_id = a.id) || ' questions'
      || coalesce(' · ' || round(a.time_limit_sec / 60.0) || ' minutes', '')
      || case when a.ranked then ' · leaderboard' else '' end,
    case when a.prize_text is not null then '🎁 Prize: ' || a.prize_text || coalesce(' (top ' || a.max_winners || ')', '') end,
    case when a.opens_at > now() then '⏰ Opens ' || to_char(a.opens_at at time zone 'Africa/Lagos', 'Dy DD Mon, HH12:MI AM') || ' (Lagos time)' end,
    case when a.closes_at is not null then '⌛ Closes ' || to_char(a.closes_at at time zone 'Africa/Lagos', 'Dy DD Mon, HH12:MI AM') end,
    '👉 https://techmedng.com/quizzes/' || a.slug,
    case when p_has_passcode then '🔐 Private: ask your class or group for the passcode.' end,
    '',
    'Builders don''t guess — they prepare. Practise free on KAIRO, no activation code or PIN: https://kairo.techmedng.com',
    '',
    '#TECHMED #UTME2027') $$;
revoke execute on function cbt._quiz_caption(cbt.assessments, boolean) from public, anon, authenticated;

-- ── Questions ───────────────────────────────────────────────────────────────────────────────
-- p = {subject:'CHM', topic_id?, year_from?, year_to?, q?: 'text', explained_only?: true, exclude_recent_days?: 60,
--      include_retired?: false, random?: false, limit?: 50}
create or replace function cbt.admin_question_search(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_limit int := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 200);
        v_recent int := coalesce((p ->> 'exclude_recent_days')::int, 0);
        v_res jsonb;
begin
  perform cbt._require_staff();
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_res from (
    select q.id, s.code subject, t.name topic, q.topic_id, q.year, q.status, q.difficulty, q.source,
           left(regexp_replace(coalesce(q.stem, ''), '<[^>]+>', '', 'g'), 220) stem,
           q.media_url is not null diagram, q.passage_id is not null passage,
           nullif(btrim(k.explanation), '') is not null explained, k.key_source,
           exists (select 1 from cbt.key_reviews r where r.question_id = q.id and r.status = 'open')
             or exists (select 1 from cbt.question_reports r where r.question_id = q.id and r.status = 'open') flagged,
           (select max(coalesce(a.opens_at, a.created_at)) from cbt.assessment_questions aq join cbt.assessments a on a.id = aq.assessment_id
             where aq.question_id = q.id and not a.personal and a.status <> 'archived') last_used
    from cbt.questions q
    join cbt.subjects s on s.id = q.subject_id
    left join cbt.topics t on t.id = q.topic_id
    left join cbt.question_keys k on k.question_id = q.id
    where (q.status = 'published' or (coalesce((p ->> 'include_retired')::boolean, false) and q.status = 'retired'))
      and (p ->> 'subject' is null or s.code = p ->> 'subject')
      and (p ->> 'topic_id' is null or q.topic_id = (p ->> 'topic_id')::int)
      and (p ->> 'year_from' is null or q.year >= (p ->> 'year_from')::int)
      and (p ->> 'year_to' is null or q.year <= (p ->> 'year_to')::int)
      and (coalesce(btrim(p ->> 'q'), '') = '' or q.stem ilike '%' || btrim(p ->> 'q') || '%')
      and (not coalesce((p ->> 'explained_only')::boolean, true) or nullif(btrim(k.explanation), '') is not null)
      and (not coalesce((p ->> 'random')::boolean, false) or (q.passage_id is null
           and not exists (select 1 from cbt.key_reviews r where r.question_id = q.id and r.status = 'open')
           and not exists (select 1 from cbt.question_reports r where r.question_id = q.id and r.status = 'open')))
      and (v_recent <= 0 or not exists (
             select 1 from cbt.assessment_questions aq join cbt.assessments a on a.id = aq.assessment_id
             where aq.question_id = q.id and not a.personal and a.status <> 'archived'
               and coalesce(a.opens_at, a.created_at) > now() - make_interval(days => v_recent)))
    order by case when coalesce((p ->> 'random')::boolean, false) then random() end, q.year desc nulls last, q.id
    limit v_limit) x;
  return v_res;
end $$;

create or replace function cbt.admin_question_update(p_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare q cbt.questions;
begin
  perform cbt._require_staff();
  select * into q from cbt.questions where id = p_id for update;
  if q.id is null then raise exception 'unknown question' using errcode = 'P0002'; end if;
  if p ? 'difficulty' then
    if p ->> 'difficulty' is not null and (p ->> 'difficulty')::int not between 1 and 5 then raise exception 'difficulty is 1 to 5' using errcode = '22023'; end if;
    update cbt.questions set difficulty = (p ->> 'difficulty')::smallint where id = p_id;
  end if;
  if p ->> 'status' = 'retired' and q.status = 'published' then
    update cbt.questions set status = 'retired' where id = p_id;
  elsif p ->> 'status' = 'published' and q.status = 'retired' then
    update cbt.questions set status = 'published' where id = p_id;
  end if;
  perform cbt._audit('question_update', 'question', p_id::text,
    jsonb_build_object('before', jsonb_build_object('status', q.status, 'difficulty', q.difficulty), 'change', p));
  return (select jsonb_build_object('id', id, 'status', status, 'difficulty', difficulty) from cbt.questions where id = p_id);
end $$;

-- ── Quizzes ─────────────────────────────────────────────────────────────────────────────────
-- p = {id?, type, title, description?, subject?: 'CHM', topic_label?, time_limit_sec?, opens_at?, closes_at?,
--      ranked?, attempts_allowed?, guests_allowed?, shuffle?, prize_text?, max_winners?, result_config?,
--      question_ids: [uuid…] (in order), passcode?: text ('' clears; absent keeps), publish: true|false}
create or replace function cbt.admin_save_quiz(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := cbt._require_staff();
  v_id uuid := (p ->> 'id')::uuid;
  a cbt.assessments; v_before jsonb;
  v_has_attempts boolean := false;
  v_ids uuid[];
  v_type cbt.assessment_type := coalesce(p ->> 'type', 'challenge')::cbt.assessment_type;
  v_opens timestamptz := (p ->> 'opens_at')::timestamptz;
  v_closes timestamptz := (p ->> 'closes_at')::timestamptz;
  v_publish boolean := coalesce((p ->> 'publish')::boolean, false);
  v_status cbt.assessment_status;
  v_bad int;
  v_old uuid; v_old_slug text;
begin
  if coalesce(btrim(p ->> 'title'), '') = '' then raise exception 'a title is required' using errcode = '22023'; end if;
  if v_type = 'practice' then raise exception 'practice sets are made by students' using errcode = '22023'; end if;
  if v_closes is not null and v_closes <= coalesce(v_opens, now()) then raise exception 'closing time must be after opening time' using errcode = '22023'; end if;
  if p ? 'question_ids' then
    select array_agg(x::uuid order by o) into v_ids from jsonb_array_elements_text(p -> 'question_ids') with ordinality t(x, o);
    if coalesce(cardinality(v_ids), 0) not between 1 and 200 then raise exception 'pick between 1 and 200 questions' using errcode = '22023'; end if;
    if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'a question is in the list twice' using errcode = '22023'; end if;
    select count(*) into v_bad from unnest(v_ids) x where not exists (select 1 from cbt.questions q where q.id = x and q.status = 'published');
    if v_bad > 0 then raise exception '% of the chosen questions are not published', v_bad using errcode = '22023'; end if;
  end if;

  if v_id is not null then
    select * into a from cbt.assessments where id = v_id for update;
    if a.id is null or a.personal or a.type = 'practice' then raise exception 'unknown quiz' using errcode = 'P0002'; end if;
    v_before := to_jsonb(a);
    v_has_attempts := exists (select 1 from cbt.attempts where assessment_id = v_id);
    if v_has_attempts and (v_ids is not null or (p ? 'time_limit_sec' and (p ->> 'time_limit_sec')::int is distinct from a.time_limit_sec)
                           or (p ? 'ranked' and (p ->> 'ranked')::boolean is distinct from a.ranked)
                           or (p ? 'type' and v_type is distinct from a.type)) then
      raise exception 'students have already taken this quiz: questions, time, ranking and type are locked. Duplicate it to make a new version.' using errcode = '55000';
    end if;
  end if;

  v_status := case when not v_publish then (case when a.status in ('live', 'closed') then a.status else 'draft' end)
                   when coalesce(v_opens, now()) <= now() then 'live' else 'scheduled' end;

  -- New question list on a quiz nobody has taken: the old version is archived and a fresh one takes its web address
  -- (nothing is removed; the old rows stay for the record).
  if v_id is not null and v_ids is not null and v_ids is distinct from
     (select array_agg(question_id order by position) from cbt.assessment_questions where assessment_id = v_id) then
    v_old := v_id; v_old_slug := a.slug;
    update cbt.assessments set status = 'archived', slug = null, featured = false where id = v_old;
    insert into cbt.assessments (type, title, slug, created_by, status, featured)
    values (v_type, btrim(p ->> 'title'), v_old_slug, uid, 'draft', a.featured) returning * into a;
    v_id := a.id;
    insert into cbt.assessment_secrets (assessment_id, passcode_hash)
    select v_id, passcode_hash from cbt.assessment_secrets where assessment_id = v_old;
  end if;

  if v_id is null then
    insert into cbt.assessments (type, title, slug, created_by, status)
    values (v_type, btrim(p ->> 'title'), cbt._unique_slug(p ->> 'title'), uid, 'draft') returning * into a;
    v_id := a.id;
  end if;

  update cbt.assessments set
    type = v_type,
    title = btrim(p ->> 'title'),
    description = nullif(btrim(coalesce(p ->> 'description', '')), ''),
    subject_id = (select id from cbt.subjects where code = p ->> 'subject'),
    topic_label = nullif(btrim(coalesce(p ->> 'topic_label', '')), ''),
    time_limit_sec = nullif((p ->> 'time_limit_sec')::int, 0),
    opens_at = coalesce(v_opens, case when v_publish then now() end),
    closes_at = v_closes,
    ranked = coalesce((p ->> 'ranked')::boolean, true),
    attempts_allowed = nullif((p ->> 'attempts_allowed')::int, 0),
    guests_allowed = coalesce((p ->> 'guests_allowed')::boolean, false),
    shuffle_questions = coalesce((p ->> 'shuffle')::boolean, true),
    shuffle_options = coalesce((p ->> 'shuffle')::boolean, true),
    answers_visibility = coalesce(p ->> 'answers_visibility', 'after_submit')::cbt.answers_visibility,
    offline_allowed = false,
    prize_text = nullif(btrim(coalesce(p ->> 'prize_text', '')), ''),
    max_winners = nullif((p ->> 'max_winners')::int, 0),
    result_config = coalesce(p -> 'result_config', a.result_config, '{}'::jsonb),
    status = v_status
  where id = v_id;

  if v_ids is not null and not exists (select 1 from cbt.assessment_questions where assessment_id = v_id) then
    insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
    select v_id, q.id, q.version, o from unnest(v_ids) with ordinality u(x, o) join cbt.questions q on q.id = u.x;
  end if;
  if not exists (select 1 from cbt.assessment_questions where assessment_id = v_id) and v_publish then
    raise exception 'add questions before publishing' using errcode = '22023';
  end if;

  if p ? 'passcode' then
    insert into cbt.assessment_secrets (assessment_id, passcode_hash)
    values (v_id, case when nullif(btrim(p ->> 'passcode'), '') is null then null else extensions.crypt(btrim(p ->> 'passcode'), extensions.gen_salt('bf')) end)
    on conflict (assessment_id) do update set passcode_hash = excluded.passcode_hash;
  end if;

  select * into a from cbt.assessments where id = v_id;
  update cbt.assessments set caption = cbt._quiz_caption(a, exists (select 1 from cbt.assessment_secrets s where s.assessment_id = v_id and s.passcode_hash is not null))
  where id = v_id and type <> 'daily_quiz'
  returning * into a;
  if a.id is null then select * into a from cbt.assessments where id = v_id; end if;

  perform cbt._audit(case when v_before is null then 'quiz_create' else 'quiz_edit' end, 'assessment', v_id::text,
    jsonb_build_object('before', v_before, 'request', p - 'passcode', 'passcode_changed', p ? 'passcode', 'replaced', v_old));
  return jsonb_build_object('id', v_id, 'replaced', v_old, 'slug', a.slug, 'status', a.status, 'caption', a.caption,
                            'url', 'https://techmedng.com/quizzes/' || a.slug, 'kairo_url', 'https://kairo.techmedng.com/q/' || v_id);
end $$;

-- publish_now | close | reopen | archive | feature | unfeature | duplicate
create or replace function cbt.admin_quiz_action(p_id uuid, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := cbt._require_staff(); a cbt.assessments; v_new uuid;
begin
  select * into a from cbt.assessments where id = p_id for update;
  if a.id is null or a.personal or a.type = 'practice' then raise exception 'unknown quiz' using errcode = 'P0002'; end if;
  case p_action
    when 'publish_now' then
      if a.status not in ('draft', 'scheduled') then raise exception 'only a draft or scheduled quiz can be published now' using errcode = '55000'; end if;
      if not exists (select 1 from cbt.assessment_questions where assessment_id = p_id) then raise exception 'add questions before publishing' using errcode = '22023'; end if;
      update cbt.assessments set status = 'live', opens_at = now() where id = p_id;
    when 'close' then
      if a.status not in ('live', 'scheduled') then raise exception 'this quiz is not open' using errcode = '55000'; end if;
      -- A quiz closed before (or the moment) it opened gets its opening moved just before, so closing stays after opening.
      update cbt.assessments set status = 'closed', featured = false,
        opens_at = case when coalesce(opens_at, now()) >= least(coalesce(closes_at, now()), now())
                        then least(coalesce(closes_at, now()), now()) - interval '1 second' else opens_at end,
        closes_at = least(coalesce(closes_at, now()), now())
      where id = p_id;
    when 'reopen' then
      if a.status <> 'closed' then raise exception 'only a closed quiz can be reopened' using errcode = '55000'; end if;
      update cbt.assessments set status = 'live', closes_at = null where id = p_id;
    when 'archive' then
      update cbt.assessments set status = 'archived', featured = false where id = p_id;
    when 'feature' then
      update cbt.assessments set featured = true where id = p_id;
    when 'unfeature' then
      update cbt.assessments set featured = false where id = p_id;
    when 'duplicate' then
      insert into cbt.assessments (type, title, slug, description, subject_id, topic_label, time_limit_sec, attempts_allowed,
             shuffle_questions, shuffle_options, answers_visibility, ranked, offline_allowed, guests_allowed, prize_text,
             max_winners, result_config, share_image_url, created_by, status)
      select type, title || ' (copy)', cbt._unique_slug(title || ' copy'), description, subject_id, topic_label, time_limit_sec,
             attempts_allowed, shuffle_questions, shuffle_options, answers_visibility, ranked, false, guests_allowed, prize_text,
             max_winners, result_config, share_image_url, uid, 'draft'
      from cbt.assessments where id = p_id returning id into v_new;
      insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
      select v_new, aq.question_id, q.version, aq.position from cbt.assessment_questions aq join cbt.questions q on q.id = aq.question_id
      where aq.assessment_id = p_id and q.status = 'published';
      insert into cbt.assessment_secrets (assessment_id, passcode_hash) select v_new, passcode_hash from cbt.assessment_secrets where assessment_id = p_id;
      perform cbt._audit('quiz_duplicate', 'assessment', v_new::text, jsonb_build_object('from', p_id));
      return jsonb_build_object('id', v_new, 'duplicated_from', p_id);
    else raise exception 'unknown action %', p_action using errcode = '22023';
  end case;
  perform cbt._audit('quiz_' || p_action, 'assessment', p_id::text, jsonb_build_object('before_status', a.status));
  return (select jsonb_build_object('id', id, 'status', status, 'featured', featured, 'opens_at', opens_at, 'closes_at', closes_at)
          from cbt.assessments where id = p_id);
end $$;

-- p = {type?, status?, q?}
create or replace function cbt.admin_quiz_list(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_res jsonb;
begin
  perform cbt._require_staff();
  select coalesce(jsonb_agg(x order by x.sort_at desc), '[]'::jsonb) into v_res from (
    select a.id, a.title, a.slug, a.type, a.status, a.opens_at, a.closes_at, a.featured, a.ranked, a.prize_text, a.day_number,
           coalesce(a.opens_at, a.created_at) sort_at,
           (select count(*) from cbt.assessment_questions aq where aq.assessment_id = a.id) question_count,
           (select count(*) from cbt.attempts t where t.assessment_id = a.id) attempts,
           (select count(distinct t.user_id) from cbt.attempts t where t.assessment_id = a.id and t.status = 'final') players,
           exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null) has_passcode
    from cbt.assessments a
    where not a.personal and a.type <> 'practice'
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (case when p ->> 'status' is null then a.status <> 'archived' else a.status::text = p ->> 'status' end)
      and (coalesce(btrim(p ->> 'q'), '') = '' or a.title ilike '%' || btrim(p ->> 'q') || '%')
    order by coalesce(a.opens_at, a.created_at) desc
    limit 200) x;
  return v_res;
end $$;

create or replace function cbt.admin_quiz_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments;
begin
  perform cbt._require_staff();
  select * into a from cbt.assessments where id = p_id and not personal;
  if a.id is null then raise exception 'unknown quiz' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'quiz', to_jsonb(a) || jsonb_build_object(
      'subject', (select code from cbt.subjects where id = a.subject_id),
      'has_passcode', exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null),
      'has_attempts', exists (select 1 from cbt.attempts t where t.assessment_id = a.id),
      'url', 'https://techmedng.com/quizzes/' || a.slug, 'kairo_url', 'https://kairo.techmedng.com/q/' || a.id),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'position', aq.position, 'subject', s.code, 'topic', t.name,
                    'year', q.year, 'status', q.status, 'difficulty', q.difficulty,
                    'stem', left(regexp_replace(coalesce(q.stem, ''), '<[^>]+>', '', 'g'), 220)) order by aq.position), '[]'::jsonb)
                  from cbt.assessment_questions aq join cbt.questions q on q.id = aq.question_id
                  join cbt.subjects s on s.id = q.subject_id left join cbt.topics t on t.id = q.topic_id
                  where aq.assessment_id = a.id));
end $$;

-- Every attempt, best first: for the results table, CSV export and rejecting an attempt.
create or replace function cbt.admin_quiz_results(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare v_res jsonb;
begin
  perform cbt._require_staff();
  select coalesce(jsonb_agg(x order by x.rank nulls last, x.score desc nulls last, x.submitted_at), '[]'::jsonb) into v_res from (
    select t.id attempt_id, t.user_id, coalesce(nullif(p.full_name, ''), 'Guest') full_name, p.email, p.phone,
           coalesce(u.is_anonymous, false) guest, t.status, t.counts_for_rank, t.reject_reason, t.origin,
           t.score, t.total, case when t.total > 0 then round(100.0 * t.score / t.total, 1) end pct, t.duration_sec,
           t.started_at, t.submitted_at,
           case when t.counts_for_rank and t.status = 'final'
                then rank() over (partition by (t.counts_for_rank and t.status = 'final') order by t.score desc, t.duration_sec asc, t.server_received_at asc) end rank
    from cbt.attempts t
    join cbt.profiles p on p.id = t.user_id
    left join auth.users u on u.id = t.user_id
    where t.assessment_id = p_id) x;
  return v_res;
end $$;

-- Take an attempt off the leaderboard (with a reason), or put it back.
create or replace function cbt.admin_set_attempt(p_attempt uuid, p_reject boolean, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare t cbt.attempts; v_first boolean;
begin
  perform cbt._require_staff();
  select * into t from cbt.attempts where id = p_attempt for update;
  if t.id is null then raise exception 'unknown attempt' using errcode = 'P0002'; end if;
  if p_reject then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason' using errcode = '22023'; end if;
    update cbt.attempts set status = 'rejected', counts_for_rank = false, reject_reason = 'staff: ' || btrim(p_reason) where id = p_attempt;
  else
    if t.status <> 'rejected' or t.score is null then raise exception 'only a rejected, marked attempt can be restored' using errcode = '55000'; end if;
    v_first := (select a.ranked from cbt.assessments a where a.id = t.assessment_id)
               and not exists (select 1 from cbt.attempts o where o.user_id = t.user_id and o.assessment_id = t.assessment_id
                               and o.started_at < t.started_at);
    update cbt.attempts set status = 'final', counts_for_rank = v_first, reject_reason = null where id = p_attempt;
  end if;
  perform cbt._audit(case when p_reject then 'attempt_reject' else 'attempt_restore' end, 'attempt', p_attempt::text,
    jsonb_build_object('before', jsonb_build_object('status', t.status, 'counts_for_rank', t.counts_for_rank, 'reject_reason', t.reject_reason), 'reason', p_reason));
  return (select jsonb_build_object('id', id, 'status', status, 'counts_for_rank', counts_for_rank, 'reject_reason', reject_reason) from cbt.attempts where id = p_attempt);
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_question_search(jsonb)', 'admin_question_update(uuid, jsonb)', 'admin_save_quiz(jsonb)',
    'admin_quiz_action(uuid, text)', 'admin_quiz_list(jsonb)', 'admin_quiz_detail(uuid)', 'admin_quiz_results(uuid)',
    'admin_set_attempt(uuid, boolean, text)'] loop
    execute format('revoke execute on function cbt.%s from public, anon', f);
    execute format('grant execute on function cbt.%s to authenticated', f);
  end loop;
end $$;
