-- Spaced review of missed questions, and a predicted UTME score from mocks.
--
-- A question enters review the first time a student gets it wrong. After that:
--   last answer wrong                     → due 1 day after that answer
--   right once since the last mistake     → due 3 days after
--   right twice in a row                  → due 7 days after
--   right three times in a row            → learnt, leaves review
-- review_due()        {due, upcoming, by_subject: [{code, due}]}  for the Home screen
-- create_review(p)    {count?, subject?} → a personal instant-feedback session of due questions (current versions)
-- my_mock_scores()    the caller's finished mocks: total /400 and each subject /100, newest first (for the prediction)
-- get_paper / get_review now also say who wrote each explanation (explanation_source), so the app can label AI-written ones.

create or replace function cbt._review_state(p_uid uuid)
returns table (question_id uuid, subject_id smallint, due_at timestamptz)
language sql stable security definer set search_path = cbt, pg_temp as $$
  with ans as (
    select aa.question_id, aa.is_correct, coalesce(t.submitted_at, t.server_received_at) at,
           row_number() over (partition by aa.question_id order by coalesce(t.submitted_at, t.server_received_at) desc) rn
    from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
    where t.user_id = p_uid and t.status = 'final' and aa.selected_option is not null
  ), missed as (select distinct question_id from ans where not is_correct),
  streak as (   -- consecutive right answers since the most recent wrong one
    select a.question_id, max(a.at) filter (where a.rn = 1) last_at,
           coalesce(min(a.rn) filter (where not a.is_correct), max(a.rn) + 1) - 1 rights
    from ans a join missed m using (question_id) group by a.question_id
  )
  select s.question_id, q.subject_id,
         s.last_at + case s.rights when 0 then interval '1 day' when 1 then interval '3 days' else interval '7 days' end
  from streak s join cbt.questions q on q.id = s.question_id and q.status = 'published'
  where s.rights < 3;
$$;

create or replace function cbt.review_due()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object(
    'due', count(*) filter (where due_at <= now()),
    'upcoming', count(*) filter (where due_at > now()),
    'by_subject', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'due', n) order by n desc)
                            from (select subject_id, count(*) n from cbt._review_state(auth.uid()) where due_at <= now() group by subject_id) x
                            join cbt.subjects s on s.id = x.subject_id), '[]'::jsonb))
  from cbt._review_state(auth.uid());
$$;

create or replace function cbt.create_review(p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_a uuid; v_n int; v_subject smallint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if (select count(*) from cbt.assessments where personal and created_by = uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many practice sessions; try again later' using errcode = '54000';
  end if;
  if p ? 'subject' then select id into v_subject from cbt.subjects where code = p ->> 'subject'; end if;
  insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility, ranked, offline_allowed, status, created_by, personal)
  values ('practice', 'Review: questions you missed', null, now(), null, 'per_question', false, true, 'live', uid, true)
  returning id into v_a;
  insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
  select v_a, r.question_id, q.version, row_number() over (order by r.due_at)
  from cbt._review_state(uid) r join cbt.questions q on q.id = r.question_id
  where r.due_at <= now() and (v_subject is null or r.subject_id = v_subject)
  order by r.due_at limit least(greatest(coalesce((p ->> 'count')::int, 20), 1), 60);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no questions match these choices' using errcode = 'P0002'; end if;
  return jsonb_build_object('assessment_id', v_a, 'question_count', v_n, 'time_limit_sec', null, 'title', 'Review: questions you missed');
end $$;

create or replace function cbt.my_mock_scores(p_limit int default 10)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(row order by at desc), '[]'::jsonb) from (
    select jsonb_build_object('attempt_id', t.id, 'submitted_at', t.server_received_at, 'duration_sec', t.duration_sec,
             'total', sum(sub.score)::int, 'subjects', jsonb_object_agg(sub.code, sub.score)) row, t.server_received_at at
    from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    cross join lateral (
      select s.code, round(100.0 * count(*) filter (where aa.is_correct) / count(*))::int score
      from cbt.assessment_questions aq join cbt.questions q on q.id = aq.question_id join cbt.subjects s on s.id = q.subject_id
      left join cbt.attempt_answers aa on aa.attempt_id = t.id and aa.question_id = aq.question_id
      where aq.assessment_id = t.assessment_id group by s.code) sub
    where t.user_id = auth.uid() and t.status = 'final' and a.type = 'mock'
    group by t.id
    order by t.server_received_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) x;
$$;

revoke execute on function cbt._review_state(uuid), cbt.review_due(), cbt.create_review(jsonb), cbt.my_mock_scores(int) from public;
grant execute on function cbt.review_due(), cbt.create_review(jsonb), cbt.my_mock_scores(int) to authenticated, service_role;
grant execute on function cbt._review_state(uuid) to service_role;

-- Who wrote the explanation: same functions as before, plus explanation_source next to explanation_html.
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
                                                         'explanation_html', v.explanation_html,
                                                         'explanation_source', (select k.explanation_source from cbt.question_keys k where k.question_id = v.question_id))
                else '{}'::jsonb end
        order by aq.position), '[]'::jsonb)
      from cbt.assessment_questions aq
      join cbt.question_versions v on v.question_id = aq.question_id and v.version = aq.question_version
      join cbt.questions q on q.id = aq.question_id
      join cbt.subjects s on s.id = q.subject_id
      where aq.assessment_id = a.id));
end $$;

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
        'selected', aa.selected_option, 'is_correct', aa.is_correct, 'flagged', aa.flagged,
        'subject', s.code, 'year', q.year, 'media_url', q.media_url, 'topic_id', v.topic_id, 'position', aq.position)
        || case when reveal then jsonb_build_object('correct_option', v.correct_option,
                                                     'explanation_html', v.explanation_html,
                                                     'explanation_source', (select k.explanation_source from cbt.question_keys k where k.question_id = v.question_id))
                else '{}'::jsonb end
        order by aq.position)
      from cbt.attempt_answers aa
      join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
      join cbt.assessment_questions aq on aq.assessment_id = t.assessment_id and aq.question_id = aa.question_id
      join cbt.questions q on q.id = aa.question_id
      join cbt.subjects s on s.id = q.subject_id
      where aa.attempt_id = t.id));
end $$;
