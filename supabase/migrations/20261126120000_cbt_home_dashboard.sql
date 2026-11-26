-- KAIRO 2.0 Home dashboard (additive only: create or replace, no table changes).
--   cbt.my_progress()  also returns 'correct': answered questions marked correct, for lifetime accuracy (correct / questions).
--   cbt.home_today()   today's Daily Builder Quiz for the Home card, with the caller's own state, in one light call
--                      (quiz_hub() builds 90 days of cards, which Home does not need).

create or replace function cbt.my_progress()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_new text[]; s jsonb; v_q int; v_c int; v_daily int;
begin
  if uid is null then return null; end if;
  v_new := cbt.award_badges(uid);
  s := cbt._streak(uid);
  select count(*), count(*) filter (where aa.is_correct) into v_q, v_c
    from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
   where t.user_id = uid and t.status = 'final' and aa.selected_option is not null;
  select count(distinct t.assessment_id) into v_daily from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
   where t.user_id = uid and t.status = 'final' and a.type = 'daily_quiz';
  return jsonb_build_object(
    'streak', s,
    'questions', v_q,
    'correct', v_c,
    'daily_quizzes', v_daily,
    'new', to_jsonb(v_new),
    'badges', (select jsonb_agg(jsonb_build_object(
        'code', b.code, 'title', b.title, 'description', b.description, 'icon', b.icon, 'goal', b.goal,
        'earned_at', ub.earned_at,
        'progress', case b.code
          when 'first_quiz' then least((s ->> 'days')::int, 1)
          when 'streak_3' then least((s ->> 'best')::int, 3) when 'streak_7' then least((s ->> 'best')::int, 7)
          when 'streak_30' then least((s ->> 'best')::int, 30)
          when 'daily_7' then least(v_daily, 7)
          when 'questions_100' then least(v_q, 100) when 'questions_1000' then least(v_q, 1000) end)
        order by b.sort)
      from cbt.badges b left join cbt.user_badges ub on ub.badge_code = b.code and ub.user_id = uid));
end $$;
revoke execute on function cbt.my_progress() from public, anon;
grant execute on function cbt.my_progress() to authenticated;

-- The newest live daily quiz, whether it opened today (Lagos), and the student's own state on it:
--   result:      their first finished attempt (the one that counts): score, total, answered, attempt id. Null if not finished.
--   best:        best score over all their finished attempts.
--   in_progress: an unfinished attempt they can resume (id, deadline, answered so far), if its time has not run out.
-- Completion is read from cbt.attempts, so a refresh or another device never shows a finished quiz as not started.
create or replace function cbt._home_today(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with q as (
    select a.* from cbt.assessments a
    where a.type = 'daily_quiz' and a.status = 'live' and a.opens_at <= p_now
    order by a.opens_at desc limit 1
  ), mine as (
    select t.* from cbt.attempts t, q where p_uid is not null and t.user_id = p_uid and t.assessment_id = q.id
  ), first_final as (
    select * from mine where status = 'final' order by coalesce(submitted_at, server_received_at) asc limit 1
  )
  select case when not exists (select 1 from q) then null else (
    select jsonb_build_object(
      'id', q.id, 'title', q.title, 'day_number', q.day_number, 'topic_label', q.topic_label,
      'subject', (select s.name from cbt.subjects s where s.id = q.subject_id),
      'subject_code', (select s.code from cbt.subjects s where s.id = q.subject_id),
      'question_count', (select count(*) from cbt.assessment_questions aq where aq.assessment_id = q.id),
      'time_limit_sec', q.time_limit_sec, 'opens_at', q.opens_at,
      'is_today', (q.opens_at at time zone 'Africa/Lagos')::date = (p_now at time zone 'Africa/Lagos')::date,
      'players', (select count(distinct t.user_id) from cbt.attempts t where t.assessment_id = q.id and t.status = 'final'),
      'best', (select max(score) from mine where status = 'final'),
      'in_progress', (select jsonb_build_object('attempt_id', m.id, 'deadline_at', m.deadline_at,
                        'answered', (select count(*) from cbt.attempt_answers aa where aa.attempt_id = m.id and aa.selected_option is not null))
                      from mine m where m.status = 'in_progress' and (m.deadline_at is null or m.deadline_at > p_now)
                      order by m.started_at desc limit 1),
      'result', (select jsonb_build_object('attempt_id', f.id, 'score', f.score, 'total', f.total,
                   'answered', (select count(*) from cbt.attempt_answers aa where aa.attempt_id = f.id and aa.selected_option is not null))
                 from first_final f))
    from q) end $$;
revoke execute on function cbt._home_today(uuid, timestamptz) from public, anon, authenticated;

create or replace function cbt.home_today()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select cbt._home_today(auth.uid(), now()) $$;
revoke execute on function cbt.home_today() from public, anon;
grant execute on function cbt.home_today() to authenticated;
