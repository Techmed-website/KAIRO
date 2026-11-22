-- KAIRO leaderboards: today, this week and all time, in WAT.
--
-- Fairness: practice papers with instant feedback carry the answer keys (so marking works offline), so those
-- answers could be looked up and never count. Only answers the student gave without the key on the phone count:
-- end-of-session practice, full mocks, and ranked assessments. get_paper therefore stops sending keys for
-- end-of-session papers; the app fetches them from get_review after the server has marked the attempt.
--
-- board(p_kind, p_period, p_limit):
--   p_kind   'points' : correct answers in the window (accuracy shown; a minimum number answered to appear)
--            'mock'   : best full-mock score /400 in the window (each subject /100, JAMB style)
--   p_period 'day' | 'week' | 'all'   (day and week start at 00:00 WAT; weeks start on Monday)
-- Returns {since, participants, rows: [{rank, name, points, answered, accuracy, mock, is_me}], me: row|null, min_answered}.
-- The caller's own row is always returned in `me`, even outside the top p_limit.

create index if not exists attempts_final_received on cbt.attempts (server_received_at) where status = 'final';

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
                                                         'explanation_html', v.explanation_html)
                else '{}'::jsonb end
        order by aq.position), '[]'::jsonb)
      from cbt.assessment_questions aq
      join cbt.question_versions v on v.question_id = aq.question_id and v.version = aq.question_version
      join cbt.questions q on q.id = aq.question_id
      join cbt.subjects s on s.id = q.subject_id
      where aq.assessment_id = a.id));
end $$;

create or replace function cbt.board(p_kind text default 'points', p_period text default 'week', p_limit int default 50)
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare
  uid uuid := auth.uid();
  v_since timestamptz;
  v_min int := case p_period when 'day' then 10 when 'week' then 20 else 40 end;
  v_rows jsonb; v_me jsonb; v_n int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind not in ('points','mock') or p_period not in ('day','week','all') then
    raise exception 'unknown board %/%', p_kind, p_period using errcode = '22023';
  end if;
  v_since := case p_period
    when 'day'  then date_trunc('day',  now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    when 'week' then date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    else '-infinity'::timestamptz end;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  create temp table if not exists _board (user_id uuid, points int, answered int, accuracy numeric, mock int,
                                          tiebreak numeric, rnk bigint) on commit drop;
  truncate _board;

  if p_kind = 'points' then
    insert into _board (user_id, points, answered, accuracy, tiebreak)
    select t.user_id, count(*) filter (where aa.is_correct), count(*),
           round(100.0 * count(*) filter (where aa.is_correct) / count(*), 1), 0
    from cbt.attempts t
    join cbt.assessments a on a.id = t.assessment_id
    join cbt.attempt_answers aa on aa.attempt_id = t.id and aa.selected_option is not null
    where t.status = 'final' and t.server_received_at >= v_since
      and (a.ranked or a.answers_visibility <> 'per_question')
    group by t.user_id
    having count(*) >= v_min;
    update _board b set rnk = r.rnk from (
      select user_id, rank() over (order by points desc, accuracy desc, answered asc) rnk from _board) r
    where r.user_id = b.user_id;
  else
    insert into _board (user_id, mock, points, answered, accuracy, tiebreak)
    select distinct on (m.user_id) m.user_id, m.agg, m.correct, m.answered,
           round(100.0 * m.correct / nullif(m.answered, 0), 1), m.duration_sec
    from (
      select t.id, t.user_id, t.duration_sec,
             (select sum(round(100.0 * c / n))::int from (
                select count(*) filter (where aa.is_correct) c, count(*) n
                from cbt.assessment_questions aq
                join cbt.questions q on q.id = aq.question_id
                left join cbt.attempt_answers aa on aa.attempt_id = t.id and aa.question_id = aq.question_id
                where aq.assessment_id = t.assessment_id group by q.subject_id) s) agg,
             (select count(*) filter (where is_correct) from cbt.attempt_answers where attempt_id = t.id) correct,
             (select count(*) from cbt.attempt_answers where attempt_id = t.id and selected_option is not null) answered
      from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
      where t.status = 'final' and t.server_received_at >= v_since and a.type = 'mock'
        and a.answers_visibility <> 'per_question'
    ) m
    order by m.user_id, m.agg desc, m.duration_sec asc;
    update _board b set rnk = r.rnk from (
      select user_id, rank() over (order by mock desc, tiebreak asc) rnk from _board) r
    where r.user_id = b.user_id;
  end if;

  select count(*) into v_n from _board;
  select coalesce(jsonb_agg(row order by (row ->> 'rank')::int), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('rank', b.rnk,
             'name', split_part(p.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(p.full_name, ' ', 2), ''), 1) || '.', ''),
             'points', b.points, 'answered', b.answered, 'accuracy', b.accuracy, 'mock', b.mock,
             'is_me', b.user_id = uid) row
    from _board b join cbt.profiles p on p.id = b.user_id
    where b.rnk <= p_limit order by b.rnk limit p_limit) x;

  -- The caller's own standing: ranked row if on the board, else progress towards the minimum.
  select jsonb_build_object('rank', b.rnk, 'points', b.points, 'answered', b.answered, 'accuracy', b.accuracy, 'mock', b.mock)
    into v_me from _board b where b.user_id = uid;
  if v_me is null and p_kind = 'points' then
    select jsonb_build_object('rank', null, 'points', count(*) filter (where aa.is_correct), 'answered', count(*),
                              'accuracy', round(100.0 * count(*) filter (where aa.is_correct) / nullif(count(*), 0), 1), 'mock', null)
      into v_me
    from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    join cbt.attempt_answers aa on aa.attempt_id = t.id and aa.selected_option is not null
    where t.user_id = uid and t.status = 'final' and t.server_received_at >= v_since
      and (a.ranked or a.answers_visibility <> 'per_question');
  end if;

  return jsonb_build_object('since', v_since, 'participants', v_n, 'min_answered', v_min, 'rows', v_rows, 'me', v_me);
end $$;

revoke execute on function cbt.board(text, text, int) from public;
grant execute on function cbt.board(text, text, int) to authenticated, service_role;
