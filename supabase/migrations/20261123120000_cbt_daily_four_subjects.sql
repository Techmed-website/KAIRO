-- Daily Builder Quiz: the four subjects that draw students (TECHMED decision, 23 Nov 2026).
-- Biology → Chemistry → Physics → Use of English, one after another every day (each subject every 4 days), always a
-- single JAMB-syllabus topic. Mathematics and mixed-subject quizzes are no longer built: students practise those free on
-- KAIRO, which every caption now invites them to (with the real published-bank size, not a rounded-up claim).
create or replace function cbt.build_daily_quiz(p_date date default null, dry_run boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Lagos')::date);
  v_day int := v_date - date '2026-11-10';
  -- Biology, Chemistry, Physics, Use of English in turn; Day 13 (23 Nov 2026, the first KAIRO-built day) is Biology.
  v_code text := (array['BIO','CHM','PHY','ENG'])[((v_date - date '2026-11-23') % 4 + 4) % 4 + 1];
  v_bank int;
  v_existing uuid;
  v_subject_id smallint; v_topic_id int; v_topic text;
  v_subject_label text; v_mix jsonb; v_part jsonb;
  v_ids uuid[] := '{}'; v_pick uuid[];
  v_title text; v_slug text; v_caption text; v_desc text; v_hook text;
  v_opens timestamptz := (v_date::text || ' 04:30')::timestamp at time zone 'Africa/Lagos';
  v_a uuid;
begin
  if auth.uid() is not null and not cbt.is_staff() then raise exception 'editors only' using errcode = '42501'; end if;
  if v_day < 1 then raise exception 'the Daily Builder series starts on 11 Nov 2026' using errcode = '22023'; end if;

  select id into v_existing from cbt.assessments
  where type = 'daily_quiz' and status <> 'archived' and (opens_at at time zone 'Africa/Lagos')::date = v_date;
  if v_existing is not null then
    return jsonb_build_object('date', v_date, 'day_number', v_day, 'existing', true, 'assessment_id', v_existing);
  end if;

  v_mix := jsonb_build_array(jsonb_build_object('code', v_code, 'n', 10));
  select id into v_subject_id from cbt.subjects where code = v_code;
  -- Topic: least used so far, then earliest in the JAMB syllabus, with enough questions left.
  select o.topic_id, t.name into v_topic_id, v_topic
  from cbt.topic_order o join cbt.topics t on t.id = o.topic_id
  where t.subject_id = v_subject_id and o.in_daily
    and (select count(*) from cbt._daily_eligible(v_date) p where p.topic_id = o.topic_id) >= 10
  order by (select count(*) from cbt.daily_topic_log l where l.topic_id = o.topic_id), o.position
  limit 1;

  for v_part in select * from jsonb_array_elements(v_mix) loop
    v_pick := cbt._daily_pick(v_date, v_part ->> 'code', v_topic_id,
                              coalesce((v_part ->> 'organic')::boolean, false), (v_part ->> 'n')::int, v_ids);
    v_ids := v_ids || v_pick;
  end loop;
  -- Short of questions (a thin topic after the 60-day rule)? Top up from the same subject(s), any topic.
  if cardinality(v_ids) < 10 then
    for v_part in select * from jsonb_array_elements(v_mix) loop
      exit when cardinality(v_ids) >= 10;
      v_ids := v_ids || cbt._daily_pick(v_date, v_part ->> 'code', null, false, 10 - cardinality(v_ids), v_ids);
    end loop;
  end if;
  if cardinality(v_ids) < 10 then
    raise exception 'only % usable questions for %', cardinality(v_ids), v_date using errcode = 'P0002';
  end if;

  -- Words.
  v_subject_label := cbt.subject_label(v_code);
  v_topic := coalesce(v_topic, 'Mixed Topics');   -- only if no topic has 10 usable questions left
  v_title := 'TECHMED UTME 2027 Daily Builder Quiz — Day ' || v_day || ': ' || v_subject_label || ' (' || v_topic || ')';
  v_slug := cbt.slugify('day-' || v_day || '-' || v_subject_label || '-' || v_topic);
  v_hook := case v_code when 'BIO' then '🧬 It''s Biology day, Builders!' when 'CHM' then '⚗️ Chemistry day is here, Builders!'
                        when 'PHY' then '⚡ Physics day, Builders! Think fast.' else '📚 Use of English day, Builders!' end;
  -- The free-practice line quotes the real size of the published bank, rounded down to the hundred.
  select (count(*) / 100) * 100 into v_bank from cbt.questions where status = 'published';
  v_caption := v_hook || E'\n' ||
    'Day ' || v_day || ' of the TECHMED Daily Builder Quiz is live: ' || v_subject_label || ', ' || v_topic || '.' || E'\n' ||
    'Real JAMB past questions, timed like the real thing. Builders don''t guess — they prepare.' || E'\n\n' ||
    '📝 10 questions · 5 minutes · instant explanations' || E'\n' ||
    '👉 Start here: https://techmedng.com/quizzes/' || v_slug || E'\n\n' ||
    'Done? Share your score here and challenge a friend to beat it 💪' || E'\n' ||
    'Want more? Practise ' || to_char(v_bank, 'FM999,999') || '+ JAMB past questions free on KAIRO, every subject, no activation code or PIN: https://kairo.techmedng.com' || E'\n' ||
    'Free TECHMED account: https://techmedng.com/dashboard' || E'\n\n' ||
    '#TECHMED #UTME2027 #DailyBuilderQuiz';
  v_desc := v_subject_label || ' · ' || v_topic || '. 10 JAMB past questions in 5 minutes, with an explanation for every answer. Builders don''t guess — they prepare.';

  if dry_run then
    return jsonb_build_object('dry_run', true, 'date', v_date, 'day_number', v_day, 'subject', v_subject_label,
      'topic', v_topic, 'topic_id', v_topic_id,
      'title', v_title, 'slug', v_slug, 'opens_at', v_opens, 'description', v_desc, 'caption', v_caption,
      'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'subject', s.code, 'topic', t.name,
                                                         'year', q.year, 'diagram', q.media_url is not null)
                                     order by array_position(v_ids, q.id))
                    from cbt.questions q join cbt.subjects s on s.id = q.subject_id left join cbt.topics t on t.id = q.topic_id
                    where q.id = any (v_ids)));
  end if;

  update cbt.assessments set featured = false where type = 'daily_quiz' and featured;
  insert into cbt.assessments (type, title, slug, description, caption, topic_label, day_number, subject_id, time_limit_sec,
                               opens_at, attempts_allowed, shuffle_questions, shuffle_options, answers_visibility, ranked,
                               offline_allowed, guests_allowed, featured, result_config, source_note, status)
  values ('daily_quiz', v_title, v_slug, v_desc, v_caption, v_topic, v_day, v_subject_id, 300,
          v_opens, null, true, true, 'after_submit', true, false, true, true, '{"pass_mark": 60}'::jsonb,
          'Built automatically by cbt.build_daily_quiz from published JAMB past questions',
          (case when v_opens <= now() then 'live' else 'scheduled' end)::cbt.assessment_status)
  returning id into v_a;
  insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
  select v_a, q.id, q.version, array_position(v_ids, q.id) from cbt.questions q where q.id = any (v_ids);
  insert into cbt.daily_topic_log (quiz_date, subject_id, topic_id, assessment_id)
  values (v_date, v_subject_id, v_topic_id, v_a);

  return jsonb_build_object('dry_run', false, 'date', v_date, 'day_number', v_day, 'assessment_id', v_a, 'title', v_title,
                            'slug', v_slug, 'url', 'https://techmedng.com/quizzes/' || v_slug, 'caption', v_caption);
end $$;
