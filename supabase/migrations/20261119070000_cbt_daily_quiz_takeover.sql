-- KAIRO takes over TECHMED's Daily Builder Quiz from QuizBoot (from 20 Nov 2026).
--
-- publish_daily_quiz(p) is called by TECHMED's scheduled daily-quiz task (Supabase SQL as the database owner, or the
-- service role). It writes original TECHMED questions into the bank (source 'techmed', explanation included, key by
-- TECHMED) and creates that day's daily quiz, opening 06:00 WAT (the existing kairo-daily-quiz-publish cron flips it
-- live). End-of-session answers (no keys on the phone), unlimited attempts, never closes; paper_board() gives it a
-- leaderboard (scope 'assessment').
--   p = {date:'2026-11-20', title, duration_sec?:600, replace?:false,
--        questions:[{subject:'MTH', stem, passage?, options:['..','..','..','..'] | [{key,html}], correct:'B', explanation}]}
--   -> {assessment_id, opens_at, question_count, url}
-- One daily quiz per WAT day: an existing one is kept unless replace=true and nobody has attempted it yet.
--
-- daily_quizzes(p_limit) lists opened daily quizzes for students, newest first, with their own best score.

create or replace function cbt.publish_daily_quiz(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  v_date date := (p ->> 'date')::date;
  v_opens timestamptz;
  v_old uuid; v_a uuid; v_q uuid; v_p uuid; v_s smallint;
  q jsonb; o jsonb; v_opts jsonb; v_n int := 0; i int;
  v_keys text[];
begin
  if v_date is null or coalesce(btrim(p ->> 'title'), '') = '' then raise exception 'date and title are required' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'questions') <> 'array' or jsonb_array_length(p -> 'questions') not between 5 and 40 then
    raise exception 'questions must be an array of 5 to 40' using errcode = '22023';
  end if;
  v_opens := (v_date::text || ' 06:00:00')::timestamp at time zone 'Africa/Lagos';

  select id into v_old from cbt.assessments
  where type = 'daily_quiz' and status <> 'archived' and (opens_at at time zone 'Africa/Lagos')::date = v_date;
  if v_old is not null then
    if not coalesce((p ->> 'replace')::boolean, false) then
      raise exception 'a daily quiz for % already exists (%); pass replace=true to swap it', v_date, v_old using errcode = '23505';
    end if;
    if exists (select 1 from cbt.attempts where assessment_id = v_old) then
      raise exception 'the daily quiz for % already has attempts; it cannot be replaced', v_date using errcode = '23505';
    end if;
    update cbt.assessments set status = 'archived' where id = v_old;
  end if;

  -- Validate everything before writing anything.
  for q in select * from jsonb_array_elements(p -> 'questions') loop
    v_n := v_n + 1;
    if not exists (select 1 from cbt.subjects where code = q ->> 'subject') then raise exception 'question %: unknown subject %', v_n, q ->> 'subject' using errcode = '22023'; end if;
    if coalesce(btrim(q ->> 'stem'), '') = '' or coalesce(btrim(q ->> 'explanation'), '') = '' then
      raise exception 'question %: stem and explanation are required', v_n using errcode = '22023';
    end if;
    if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 4 and 5 then
      raise exception 'question %: 4 or 5 options', v_n using errcode = '22023';
    end if;
    v_keys := (array['A','B','C','D','E'])[1:jsonb_array_length(q -> 'options')];
    if not (q ->> 'correct') = any (v_keys) then raise exception 'question %: correct must be one of %', v_n, v_keys using errcode = '22023'; end if;
  end loop;

  insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility, ranked, offline_allowed, status)
  values ('daily_quiz', p ->> 'title', coalesce((p ->> 'duration_sec')::int, 600), v_opens, null, 'after_submit', false, false,
          (case when v_opens <= now() then 'live' else 'scheduled' end)::cbt.assessment_status)
  returning id into v_a;

  v_n := 0;
  for q in select * from jsonb_array_elements(p -> 'questions') loop
    v_n := v_n + 1;
    select id into v_s from cbt.subjects where code = q ->> 'subject';
    -- Options as given: plain strings become {key, html}, lettered in order.
    select jsonb_agg(case when jsonb_typeof(e) = 'string' then jsonb_build_object('key', (array['A','B','C','D','E'])[n], 'html', e #>> '{}')
                          else jsonb_build_object('key', (array['A','B','C','D','E'])[n], 'html', e ->> 'html') end order by n)
    into v_opts from jsonb_array_elements(q -> 'options') with ordinality x(e, n);
    v_p := null;
    if coalesce(btrim(q ->> 'passage'), '') <> '' then
      insert into cbt.passages (source_ref, html) values ('daily:' || v_date || ':' || md5(q ->> 'passage'), q ->> 'passage')
      on conflict (source_ref) do update set html = excluded.html returning id into v_p;
    end if;
    insert into cbt.questions (source_ref, subject_id, source, stem, passage_id, options, content_hash)
    values ('daily:' || v_a || ':' || v_n, v_s, 'techmed', q ->> 'stem', v_p, v_opts,
            md5(lower(regexp_replace(btrim(q ->> 'stem'), '\s+', ' ', 'g'))))
    returning id into v_q;
    insert into cbt.question_keys (question_id, correct_option, key_source, explanation)
    values (v_q, q ->> 'correct', 'editor', q ->> 'explanation');
    update cbt.questions set status = 'published', reviewed_at = now() where id = v_q;
    insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
    select v_a, id, version, v_n from cbt.questions where id = v_q;
  end loop;

  return jsonb_build_object('assessment_id', v_a, 'opens_at', v_opens, 'question_count', v_n,
                            'url', 'https://kairo.techmedng.com/q/' || v_a);
end $$;

revoke execute on function cbt.publish_daily_quiz(jsonb) from public;
grant execute on function cbt.publish_daily_quiz(jsonb) to service_role;

create or replace function cbt.daily_quizzes(p_limit int default 30)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.opens_at desc), '[]'::jsonb) from (
    select a.id, a.title, a.opens_at, a.time_limit_sec,
           (select count(*) from cbt.assessment_questions aq where aq.assessment_id = a.id) question_count,
           (select max(t.score) from cbt.attempts t where t.assessment_id = a.id and t.user_id = auth.uid() and t.status = 'final') my_best,
           (select count(distinct t.user_id) from cbt.attempts t where t.assessment_id = a.id and t.status = 'final') players
    from cbt.assessments a
    where a.type = 'daily_quiz' and a.status = 'live' and a.opens_at <= now()
    order by a.opens_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) x;
$$;
revoke execute on function cbt.daily_quizzes(int) from public;
grant execute on function cbt.daily_quizzes(int) to authenticated, service_role;
