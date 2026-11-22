-- TEMPORARY content loader for reviewed daily-quiz weeks (content/daily-quiz/*.json), until the /admin
-- screens exist. Same one-time secret as the question import (cbt.import_secret); removed together with it.
-- For each question it applies text fixes, stores the explanation, publishes the question (freezing
-- version 1), then creates the day's daily quiz as 'scheduled' (opens 05:00 UTC, never closes,
-- 10 questions / 5 minutes, unranked, answers right after submit, offline allowed).
-- Idempotent per day: a day that already has a daily quiz is skipped.

create or replace function public.cbt_load_daily_week(p_token text, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = cbt, public, pg_temp as $$
declare
  d jsonb; q jsonb; o record; v_a uuid; n_days int := 0; n_q int := 0; n_skip int := 0; pos int;
begin
  if not exists (select 1 from cbt.import_secret
                 where sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for d in select * from jsonb_array_elements(p_doc -> 'days') loop
    if exists (select 1 from cbt.assessments where type = 'daily_quiz' and status <> 'archived'
               and (opens_at at time zone 'Africa/Lagos')::date = (d ->> 'date')::date) then
      n_skip := n_skip + 1; continue;
    end if;

    for q in select * from jsonb_array_elements(d -> 'questions') loop
      if not exists (select 1 from cbt.questions where source_ref = q ->> 'ref') then
        raise exception 'unknown question %', q ->> 'ref';
      end if;
      if q -> 'fix' ? 'stem' then
        update cbt.questions set stem = q -> 'fix' ->> 'stem',
          stem_html = replace(replace(replace(q -> 'fix' ->> 'stem', '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
        where source_ref = q ->> 'ref' and status = 'draft';
      end if;
      if q -> 'fix' ? 'options' then
        for o in select key, value from jsonb_each_text(q -> 'fix' -> 'options') loop
          update cbt.questions set options = (
            select jsonb_agg(case when e ->> 'key' = o.key
                   then jsonb_set(e, '{html}', to_jsonb(replace(replace(replace(o.value, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')))
                   else e end order by ord)
            from jsonb_array_elements(options) with ordinality t(e, ord))
          where source_ref = q ->> 'ref' and status = 'draft';
        end loop;
      end if;
      update cbt.question_keys k set explanation = q ->> 'explanation'
      from cbt.questions qq where qq.id = k.question_id and qq.source_ref = q ->> 'ref';
      update cbt.questions set status = 'published', reviewed_at = now()
      where source_ref = q ->> 'ref' and status = 'draft';
      n_q := n_q + 1;
    end loop;

    insert into cbt.assessments (type, title, time_limit_sec, opens_at, attempts_allowed, answers_visibility,
                                 ranked, offline_allowed, status)
    values ('daily_quiz', 'KAIRO Daily Quiz: ' || (d ->> 'title'), 300,
            ((d ->> 'date') || ' 05:00:00+00')::timestamptz, null, 'after_submit', false, true, 'scheduled')
    returning id into v_a;

    pos := 0;
    for q in select * from jsonb_array_elements(d -> 'questions') loop
      pos := pos + 1;
      insert into cbt.assessment_questions (assessment_id, question_id, question_version, position)
      select v_a, id, version, pos from cbt.questions where source_ref = q ->> 'ref';
    end loop;
    n_days := n_days + 1;
  end loop;
  return jsonb_build_object('days_created', n_days, 'questions_published', n_q, 'days_skipped', n_skip);
end $$;

revoke execute on function public.cbt_load_daily_week(text, jsonb) from public;
grant execute on function public.cbt_load_daily_week(text, jsonb) to anon;

-- Flip scheduled daily quizzes to live when they open (05:00 UTC = 06:00 WAT). Runs every 5 minutes so a
-- missed tick self-heals; at 05:00 the quiz goes live within 5 minutes.
select cron.schedule('kairo-daily-quiz-publish', '*/5 * * * *',
  $$update cbt.assessments set status = 'live' where status = 'scheduled' and opens_at <= now()$$);
