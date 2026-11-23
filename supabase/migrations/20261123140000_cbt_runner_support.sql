-- Batch 5 support for the KAIRO quiz runner.
--   * public_quiz_by_id: the same public card as public_quiz(slug), by id, so /q/<id> can show its instructions screen
--     (title, questions, time, passcode or not, guests welcome) before anyone signs in. No answers, nothing personal.
--   * get_paper also returns each question's source ('jamb' / 'techmed'), so the runner labels questions correctly:
--     "JAMB Past Question, {year}", "TECHMED Practice Question" or "Practice Question".

create or replace function cbt.public_quiz_by_id(p_id uuid)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select cbt._public_card(a) || jsonb_build_object('result_config', a.result_config, 'answers_visibility', a.answers_visibility)
  from cbt.assessments a
  where a.id = p_id and not a.personal and a.status in ('live', 'scheduled', 'closed', 'archived') $$;
revoke execute on function cbt.public_quiz_by_id(uuid) from public;
grant execute on function cbt.public_quiz_by_id(uuid) to anon, authenticated;

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
                           'subject', s.code, 'year', q.year, 'source', q.source, 'media_url', q.media_url)
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
