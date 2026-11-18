-- Support for the KAIRO app (P0): "Retry the ones you missed" and a review that carries the details the app
-- needs to render on any device (subject, year, diagram, topic).

-- create_retry(p): a personal practice session from the caller's own wrong answers in one finished attempt.
--   p = {attempt_id, feedback?: 'instant'|'end'}. Uses each question's current published version, so a
--   corrected key or explanation reaches the retry. Same rate limit as create_practice.
create or replace function cbt.create_retry(p jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_attempt uuid := (p ->> 'attempt_id')::uuid;
  v_feedback text := coalesce(p ->> 'feedback', 'instant');
  t cbt.attempts; v_a uuid; v_n int; v_title text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from cbt.attempts where id = v_attempt and user_id = uid and status = 'final';
  if t.id is null then raise exception 'no finished attempt' using errcode = 'P0002'; end if;
  if (select count(*) from cbt.assessments where personal and created_by = uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many practice sessions; try again later' using errcode = '54000';
  end if;
  select 'Retry: ' || title into v_title from cbt.assessments where id = t.assessment_id;

  insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility,
                               ranked, offline_allowed, status, created_by, personal)
  values ('practice', coalesce(v_title, 'Retry'), null, now(), null,
          case when v_feedback = 'end' then 'after_submit' else 'per_question' end::cbt.answers_visibility,
          false, true, 'live', uid, true)
  returning id into v_a;

  insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
  select v_a, q.id, q.version, row_number() over (order by aq.position)
  from cbt.attempt_answers aa
  join cbt.assessment_questions aq on aq.assessment_id = t.assessment_id and aq.question_id = aa.question_id
  join cbt.questions q on q.id = aa.question_id and q.status = 'published'
  where aa.attempt_id = t.id and aa.selected_option is not null and not aa.is_correct;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no questions match these choices' using errcode = 'P0002'; end if;

  return jsonb_build_object('assessment_id', v_a, 'question_count', v_n, 'time_limit_sec', null, 'title', v_title);
end $$;

revoke execute on function cbt.create_retry(jsonb) from public;
grant execute on function cbt.create_retry(jsonb) to authenticated, service_role;

-- get_review: add subject, year, media_url, topic_id and position to each item (same rules as before).
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
                                                     'explanation_html', v.explanation_html)
                else '{}'::jsonb end
        order by aq.position)
      from cbt.attempt_answers aa
      join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
      join cbt.assessment_questions aq on aq.assessment_id = t.assessment_id and aq.question_id = aa.question_id
      join cbt.questions q on q.id = aa.question_id
      join cbt.subjects s on s.id = q.subject_id
      where aa.attempt_id = t.id));
end $$;
