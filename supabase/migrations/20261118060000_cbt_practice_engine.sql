-- Practice engine for the KAIRO app: personal practice sessions, a catalogue for the menus, and safe edits.
--
-- create_practice(p) builds a personal assessment from filters and returns its id; the app then calls
-- start_attempt + get_paper as for any assessment. Modes:
--   year   {subject, year, count?, time_limit_sec?, feedback?}        a past paper, in source order
--   topic  {subject, topic_ids[], count?, time_limit_sec?, feedback?}  trusted topics only
--   mixed  {subjects: [{code, count}], years?: [from, to], topic_ids?, time_limit_sec?, feedback?}
--   mock   {subjects: [3 codes besides ENG]}                           JAMB standard: ENG 60 + 3 x 40, 2 hours
-- feedback: 'instant' (show the answer after each question) or 'end' (after submitting). Default instant,
-- except mock (always end). Unseen questions are preferred, so practice adapts to the student.

alter table cbt.assessments add column personal boolean not null default false;
create index on cbt.assessments (created_by) where personal;

-- Students see shared live/closed assessments and their own personal sessions only.
drop policy read_assessments on cbt.assessments;
create policy read_assessments on cbt.assessments for select to authenticated
  using ((status in ('live','closed') and (not personal or created_by = auth.uid())) or cbt.is_staff());

-- get_paper / start_attempt: a personal session belongs to its creator.
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
  with_keys := not a.ranked and a.offline_allowed;
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
     or (a.closes_at is not null and now() >= a.closes_at)
     or (a.personal and a.created_by is distinct from uid) then
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

-- Build a personal practice session. Returns {assessment_id, question_count, time_limit_sec}.
create or replace function cbt.create_practice(p jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_mode text := p ->> 'mode';
  v_feedback text := coalesce(p ->> 'feedback', 'instant');
  v_time int := nullif(p ->> 'time_limit_sec', '')::int;
  v_count int := least(coalesce(nullif(p ->> 'count', '')::int, 40), 200);
  v_a uuid; v_title text; v_type cbt.assessment_type := 'practice'; v_n int;
  sub jsonb; v_subject smallint; v_years int[]; v_topics int[];
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform cbt.ensure_profile();
  if v_mode not in ('year','topic','mixed','mock') then raise exception 'unknown mode %', v_mode using errcode = '22023'; end if;
  if v_mode = 'mock' then v_feedback := 'end'; v_time := 7200; v_type := 'mock'; end if;
  if v_time is not null and v_mode <> 'mock' then v_type := 'topic_test'; end if;
  if p ? 'years' then v_years := array(select jsonb_array_elements_text(p -> 'years')::int); end if;
  if p ? 'topic_ids' then v_topics := array(select jsonb_array_elements_text(p -> 'topic_ids')::int); end if;

  -- Per-student rate limit: at most 60 sessions an hour.
  if (select count(*) from cbt.assessments where personal and created_by = uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many practice sessions; try again later' using errcode = '54000';
  end if;

  insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility,
                               ranked, offline_allowed, status, created_by, personal)
  values (v_type, 'Practice', v_time, now(), null,
          case when v_feedback = 'instant' then 'per_question' else 'after_submit' end::cbt.answers_visibility,
          false, true, 'live', uid, true)
  returning id into v_a;

  create temp table if not exists _pick (question_id uuid, version int, grp int, ord float8) on commit drop;
  truncate _pick;

  if v_mode = 'year' then
    select id into v_subject from cbt.subjects where code = p ->> 'subject';
    insert into _pick
    select q.id, q.version, 0, row_number() over (order by length(q.source_ref), q.source_ref)
    from cbt.questions q where q.status = 'published' and q.subject_id = v_subject and q.year = (p ->> 'year')::int
    order by length(q.source_ref), q.source_ref limit v_count;
    v_title := (p ->> 'subject') || ' ' || (p ->> 'year');

  elsif v_mode = 'topic' then
    select id into v_subject from cbt.subjects where code = p ->> 'subject';
    insert into _pick
    select q.id, q.version, 0, (exists (select 1 from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
                                        where t.user_id = uid and aa.question_id = q.id))::int + random()
    from cbt.questions q
    where q.status = 'published' and q.subject_id = v_subject and q.topic_id = any(v_topics)
      and (q.topic_auto or q.topic_source = 'editor')
    order by 4 limit v_count;
    v_title := (p ->> 'subject') || ' topic practice';

  else
    -- mixed / mock: one group per subject, unseen first, random within.
    for sub in select * from jsonb_array_elements(
        case when v_mode = 'mock'
             then jsonb_build_array(jsonb_build_object('code','ENG','count',60))
                  || (select jsonb_agg(jsonb_build_object('code', c, 'count', 40)) from jsonb_array_elements_text(p -> 'subjects') c where c <> 'ENG')
             else p -> 'subjects' end) loop
      select id into v_subject from cbt.subjects where code = sub ->> 'code';
      if v_subject is null then raise exception 'unknown subject %', sub ->> 'code' using errcode = '22023'; end if;
      insert into _pick
      select q.id, q.version, v_subject, (exists (select 1 from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
                                                  where t.user_id = uid and aa.question_id = q.id))::int + random()
      from cbt.questions q
      where q.status = 'published' and q.subject_id = v_subject
        and (v_years is null or q.year between v_years[1] and v_years[2])
        and (v_topics is null or q.topic_id = any(v_topics))
      order by 4 limit least(coalesce((sub ->> 'count')::int, 10), 100);
    end loop;
    if v_mode = 'mock' and (select count(distinct grp) from _pick) <> 4 then
      raise exception 'a mock needs English plus exactly 3 other subjects' using errcode = '22023';
    end if;
    v_title := case when v_mode = 'mock' then 'JAMB mock' else 'Mixed practice' end;
  end if;

  insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
  select v_a, question_id, version, row_number() over (order by grp, ord) from _pick;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no questions match these choices' using errcode = 'P0002'; end if;

  update cbt.assessments set title = v_title where id = v_a;
  return jsonb_build_object('assessment_id', v_a, 'question_count', v_n, 'time_limit_sec', v_time, 'title', v_title);
end $$;

-- Menu data: published question counts by subject, by year and by trusted topic.
create or replace function cbt.catalog()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object(
    'subjects', (select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name,
        'count', (select count(*) from cbt.questions q where q.subject_id = s.id and q.status = 'published'),
        'years', (select jsonb_agg(jsonb_build_object('year', y, 'count', n) order by y desc)
                  from (select year y, count(*) n from cbt.questions q where q.subject_id = s.id and q.status = 'published'
                        group by year) yy),
        'topics', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'count', n) order by t.name)
                   from (select topic_id, count(*) n from cbt.questions q where q.subject_id = s.id and q.status = 'published'
                           and (q.topic_auto or q.topic_source = 'editor') group by topic_id) tt
                   join cbt.topics t on t.id = tt.topic_id))
      order by s.id) from cbt.subjects s));
$$;

-- Edits after publishing: an explanation change reaches students at once (it does not affect marking);
-- an answer-key change creates a new version, so past attempts keep the key they were marked against.
create or replace function cbt.sync_key_to_version() returns trigger
language plpgsql security definer set search_path = cbt, pg_temp as $$
declare q cbt.questions;
begin
  select * into q from cbt.questions where id = new.question_id;
  if q.status <> 'published' then return new; end if;
  if new.correct_option is distinct from old.correct_option then
    update cbt.questions set version = version + 1 where id = q.id;
    insert into cbt.question_versions (question_id, version, stem_html, options, correct_option, explanation_html, passage_html, topic_id)
    select q.id, q.version + 1, v.stem_html, v.options, new.correct_option,
           coalesce(new.explanation_html, new.explanation), v.passage_html, v.topic_id
    from cbt.question_versions v where v.question_id = q.id and v.version = q.version;
  elsif coalesce(new.explanation_html, new.explanation) is distinct from coalesce(old.explanation_html, old.explanation) then
    update cbt.question_versions set explanation_html = coalesce(new.explanation_html, new.explanation)
    where question_id = q.id and version = q.version;
  end if;
  return new;
end $$;
create trigger question_keys_sync after update on cbt.question_keys
  for each row execute function cbt.sync_key_to_version();

revoke execute on function cbt.create_practice(jsonb), cbt.catalog(), cbt.sync_key_to_version() from public;
grant execute on function cbt.create_practice(jsonb), cbt.catalog() to authenticated;
grant execute on function cbt.create_practice(jsonb), cbt.catalog() to service_role;
