-- Leaderboards v2: rank by SCORE in JAMB terms, then by time taken (faster ranks higher), then by who submitted first.
--
-- Score of an attempt = sum over its subjects of round(100 * correct / questions), so a single subject is /100,
-- two subjects /200, three /300 and four (a full JAMB-style paper) /400. Boards compare like with like:
--   board(p_period, p_subjects, p_subject, p_limit)
--     p_period   'day' | 'week' | 'all'   (00:00 WAT; weeks start Monday)
--     p_subjects 1..4                     number of subjects in the paper (/100 … /400)
--     p_subject  optional subject code    for the /100 boards (e.g. 'CHM'); null = any single subject
-- Each student appears once, with their best attempt in the window. Fairness rules kept from v1: only papers the
-- student answered without the key on the phone (end-of-session practice, mocks, ranked assessments), and at
-- least 10 questions per subject so a 3-question session cannot score 100.
-- Returns {since, participants, max, min_per_subject, rows: [{rank, name, score, max, duration_sec, accuracy,
-- subjects, is_me}], me: {...}|null}.

drop function if exists cbt.board(text, text, int);

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
           array_agg(code order by code) codes
    from subj group by id
  ), best as (
    select distinct on (at.user_id) at.user_id, at.dur, at.server_received_at, per.score, per.c, per.n, per.codes
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
                        'subjects', codes, 'is_me', user_id = uid) order by rnk, server_received_at)
                      from (select * from ranked where rnk <= p_limit order by rnk, server_received_at limit p_limit) x), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rnk, 'score', score, 'max', p_subjects * 100, 'duration_sec', nullif(dur, 2147483647),
                                     'accuracy', round(100.0 * c / nullif(n, 0), 1), 'subjects', codes)
           from ranked where user_id = uid))
  into v_res;
  return v_res;
end $$;

revoke execute on function cbt.board(text, int, text, int) from public;
grant execute on function cbt.board(text, int, text, int) to authenticated, service_role;
