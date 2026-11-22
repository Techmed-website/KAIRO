-- Paper rankings (from Wisdom's competitor screenshots):
--  * "Your rank #59 of 430" on the result screen,
--  * a leaderboard for the paper just sat, with each student's subject-by-subject scores,
--  * subject-by-subject scores on the period boards too (board rows gain `subject_scores` {"ENG":72,...}).
--
-- paper_board(p_attempt, p_limit) ranks the caller's finished attempt against everyone who sat the same paper:
--   scope 'assessment' : a shared (staff-made / ranked) assessment -> attempts on that assessment
--   scope 'paper'      : a personal past-paper session ("CHM 2015") -> personal sessions with the same title and the
--                        same number of questions (create_practice picks the first N in a fixed order, so same set)
--   scope 'subjects'   : any other personal session (mixed, topic, mock) -> all-time attempts on the same subject set
-- Same fairness rules as board(): instant-feedback practice never ranks; personal sessions need >= 10 questions per
-- subject. Score = sum of round(100*correct/questions) per subject; ties: faster time, then earlier submit.
-- Each other student appears once (their best). The caller's rank for THIS attempt is
-- 1 + number of other students whose best beats it; the board shows the caller's best.
-- Returns {eligible:false, reason:'instant'|'short'} or
--   {eligible:true, scope, title, question_count, max, participants,
--    this:{rank, score, duration_sec, subject_scores, personal_best}, me:{rank,...}, rows:[{rank, name, score, max,
--    duration_sec, accuracy, subject_scores, is_me}]}.

create index if not exists assessments_personal_title on cbt.assessments (title) where personal;

create or replace function cbt.board(p_period text default 'week', p_subjects int default 4,
                                     p_subject text default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_since timestamptz;
  v_min constant int := 10;
  v_res jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_period not in ('day','week','all') or p_subjects not between 1 and 4
     or (p_subject is not null and (p_subjects <> 1 or not exists (select 1 from cbt.subjects where code = p_subject))) then
    raise exception 'unknown board' using errcode = '22023';
  end if;
  v_since := case p_period
    when 'day'  then date_trunc('day',  now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    when 'week' then date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    else '-infinity'::timestamptz end;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  with att as (
    select t.id, t.user_id, t.assessment_id, coalesce(t.duration_sec, 2147483647) dur, t.server_received_at
    from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    where t.status = 'final' and t.server_received_at >= v_since
      and (a.ranked or a.answers_visibility <> 'per_question')
  ), subj as (
    select at.id, s.code, count(*) n, count(*) filter (where aa.is_correct) c
    from att at
    join cbt.assessment_questions aq on aq.assessment_id = at.assessment_id
    join cbt.questions q on q.id = aq.question_id
    join cbt.subjects s on s.id = q.subject_id
    left join cbt.attempt_answers aa on aa.attempt_id = at.id and aa.question_id = aq.question_id
    group by at.id, s.code
  ), per as (
    select id, count(*) k, min(n) min_n, sum(round(100.0 * c / n))::int score, sum(c) c, sum(n) n,
           array_agg(code order by code) codes,
           jsonb_object_agg(code, round(100.0 * c / n)::int) ss
    from subj group by id
  ), best as (
    select distinct on (at.user_id) at.user_id, at.dur, at.server_received_at, per.score, per.c, per.n, per.codes, per.ss
    from att at join per on per.id = at.id
    where per.k = p_subjects and per.min_n >= v_min and (p_subject is null or per.codes = array[p_subject])
    order by at.user_id, per.score desc, at.dur asc, at.server_received_at asc
  ), ranked as (
    select b.*, rank() over (order by b.score desc, b.dur asc, b.server_received_at asc) rnk,
           split_part(p.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', '') nm
    from best b join cbt.profiles p on p.id = b.user_id
  )
  select jsonb_build_object(
    'since', v_since, 'participants', (select count(*) from ranked), 'max', p_subjects * 100, 'min_per_subject', v_min,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rnk, 'name', nm, 'score', score, 'max', p_subjects * 100,
                        'duration_sec', nullif(dur, 2147483647), 'accuracy', round(100.0 * c / nullif(n, 0), 1),
                        'subjects', codes, 'subject_scores', ss, 'is_me', user_id = uid) order by rnk, server_received_at)
                      from (select * from ranked where rnk <= p_limit order by rnk, server_received_at limit p_limit) x), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rnk, 'score', score, 'max', p_subjects * 100, 'duration_sec', nullif(dur, 2147483647),
                                     'accuracy', round(100.0 * c / nullif(n, 0), 1), 'subjects', codes, 'subject_scores', ss)
           from ranked where user_id = uid))
  into v_res;
  return v_res;
end $$;


create or replace function cbt.paper_board(p_attempt uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_min constant int := 10;
  t record; a record;
  v_scope text;
  v_res jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from cbt.attempts where id = p_attempt and user_id = uid and status = 'final';
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  select * into a from cbt.assessments where id = t.assessment_id;
  if not a.ranked and a.answers_visibility = 'per_question' then
    return jsonb_build_object('eligible', false, 'reason', 'instant');
  end if;
  v_scope := case when not a.personal then 'assessment'
                  when a.title ~ '^[A-Z]{3} [0-9]{4}$' then 'paper'
                  else 'subjects' end;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  with att as (
    select t2.id, t2.user_id, t2.assessment_id, coalesce(t2.duration_sec, 2147483647) dur, t2.server_received_at rcv
    from cbt.attempts t2 join cbt.assessments x on x.id = t2.assessment_id
    where t2.status = 'final'
      and (x.ranked or x.answers_visibility <> 'per_question')
      and case v_scope when 'assessment' then x.id = a.id
                       when 'paper' then x.personal and x.title = a.title
                       else x.personal end
  ), subj as (
    select at.id, s.code, count(*) n, count(*) filter (where aa.is_correct) c
    from att at
    join cbt.assessment_questions aq on aq.assessment_id = at.assessment_id
    join cbt.questions q on q.id = aq.question_id
    join cbt.subjects s on s.id = q.subject_id
    left join cbt.attempt_answers aa on aa.attempt_id = at.id and aa.question_id = aq.question_id
    group by at.id, s.code
  ), per as (
    select id, min(n) min_n, sum(n)::int n, sum(c)::int c, sum(round(100.0 * c / n))::int score,
           array_agg(code order by code) codes, jsonb_object_agg(code, round(100.0 * c / n)::int) ss, count(*)::int k
    from subj group by id
  ), mine as (
    select * from per where id = p_attempt
  ), ok as (
    select at.id, at.user_id, at.dur, at.rcv, per.n, per.c, per.score, per.ss, per.k
    from att at join per on per.id = at.id cross join mine
    where per.codes = mine.codes
      and (v_scope <> 'paper' or per.n = mine.n)
      and (v_scope = 'assessment' or per.min_n >= v_min)
  ), others as (
    select distinct on (user_id) * from ok where user_id <> uid order by user_id, score desc, dur, rcv
  ), mybest as (
    select * from ok where user_id = uid order by score desc, dur, rcv limit 1
  ), this as (
    select * from ok where id = p_attempt
  ), ranked as (
    select b.*, rank() over (order by b.score desc, b.dur, b.rcv) rnk,
           split_part(p.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', '') nm
    from (select * from others union all select * from mybest) b join cbt.profiles p on p.id = b.user_id
  )
  select case when not exists (select 1 from this) then jsonb_build_object('eligible', false, 'reason', 'short')
  else jsonb_build_object(
    'eligible', true, 'scope', v_scope, 'title', a.title,
    'question_count', (select n from this), 'max', (select k from this) * 100,
    'participants', (select count(*) from others) + 1,
    'this', (select jsonb_build_object(
               'rank', 1 + (select count(*) from others o
                            where o.score > th.score or (o.score = th.score and (o.dur < th.dur or (o.dur = th.dur and o.rcv < th.rcv)))),
               'score', th.score, 'duration_sec', nullif(th.dur, 2147483647), 'subject_scores', th.ss,
               'personal_best', th.id = (select id from mybest))
             from this th),
    'me', (select jsonb_build_object('rank', rnk, 'score', score, 'duration_sec', nullif(dur, 2147483647),
                                     'accuracy', round(100.0 * c / nullif(n, 0), 1), 'subject_scores', ss)
           from ranked where user_id = uid),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rnk, 'name', nm, 'score', score, 'max', k * 100,
                        'duration_sec', nullif(dur, 2147483647), 'accuracy', round(100.0 * c / nullif(n, 0), 1),
                        'subject_scores', ss, 'is_me', user_id = uid) order by rnk, rcv)
                      from (select * from ranked order by rnk, rcv limit p_limit) x), '[]'::jsonb))
  end into v_res;
  return v_res;
end $$;

revoke execute on function cbt.paper_board(uuid, int) from public;
grant execute on function cbt.paper_board(uuid, int) to authenticated, service_role;
