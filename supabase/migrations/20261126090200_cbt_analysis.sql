-- Richer performance analysis, free for now (handover 4B.3).
--   cbt.my_analysis()             overall: totals, by subject, by topic, weekly trend, speed, accuracy vs everyone, what to practise next
--   cbt.attempt_analysis(attempt) one result: speed per question, accuracy vs everyone on the same questions, percentile
-- "Everyone" = all students' finished answers in the last 180 days. Only answered questions count.
-- Both read the caller's own data only; other students appear only as averages.

-- One row per answered question in a finished attempt, with its subject, topic and time.
create or replace function cbt._answers(p_since timestamptz)
returns table (user_id uuid, attempt_id uuid, question_id uuid, subject_code text, topic_id int,
               is_correct boolean, time_ms int, at timestamptz)
language sql stable security definer set search_path = cbt, pg_temp as $$
  select t.user_id, t.id, aa.question_id, s.code, v.topic_id, coalesce(aa.is_correct, false),
         case when aa.time_ms between 500 and 900000 then aa.time_ms end, t.server_received_at
  from cbt.attempts t
  join cbt.attempt_answers aa on aa.attempt_id = t.id
  join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
  join cbt.questions q on q.id = aa.question_id
  join cbt.subjects s on s.id = q.subject_id
  where t.status = 'final' and t.server_received_at >= p_since and aa.selected_option is not null $$;
revoke execute on function cbt._answers(timestamptz) from public, anon, authenticated;

create or replace function cbt.my_analysis()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with mine as (select * from cbt._answers('-infinity') where user_id = auth.uid()),
  everyone as (select * from cbt._answers(now() - interval '180 days')),
  e_subj as (select subject_code, avg(is_correct::int) pct, avg(time_ms) ms from everyone group by subject_code),
  e_topic as (select topic_id, avg(is_correct::int) pct, avg(time_ms) ms, count(*) n from everyone group by topic_id),
  subj as (
    select m.subject_code, count(*) n, count(*) filter (where m.is_correct) c, avg(m.time_ms) ms
    from mine m group by m.subject_code),
  topic as (
    select m.topic_id, max(m.subject_code) subject_code, count(*) n, count(*) filter (where m.is_correct) c, avg(m.time_ms) ms, max(m.at) last_at
    from mine m where m.topic_id is not null group by m.topic_id),
  weeks as (
    select date_trunc('week', (m.at at time zone 'Africa/Lagos'))::date wk, count(*) n, avg(m.is_correct::int) pct, avg(m.time_ms) ms
    from mine m where m.at > now() - interval '12 weeks' group by 1)
  select case when auth.uid() is null then null else jsonb_build_object(
    'totals', (select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where is_correct),
                 'pct', round(100 * avg(is_correct::int), 1), 'avg_sec', round(avg(time_ms) / 1000.0, 1),
                 'community_pct', (select round(100 * avg(is_correct::int), 1) from everyone),
                 'community_avg_sec', (select round(avg(time_ms) / 1000.0, 1) from everyone)) from mine),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('code', s.subject_code, 'answered', s.n, 'correct', s.c,
                   'pct', round(100.0 * s.c / s.n, 1), 'avg_sec', round(s.ms / 1000.0, 1),
                   'community_pct', round(100 * e.pct, 1), 'community_avg_sec', round(e.ms / 1000.0, 1)) order by s.n desc)
                 from subj s left join e_subj e using (subject_code)), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'name', tp.name, 'subject', t.subject_code,
                   'answered', t.n, 'correct', t.c, 'pct', round(100.0 * t.c / t.n, 1), 'avg_sec', round(t.ms / 1000.0, 1),
                   'community_pct', case when e.n >= 20 then round(100 * e.pct, 1) end,
                   'community_avg_sec', case when e.n >= 20 then round(e.ms / 1000.0, 1) end,
                   'last_at', t.last_at) order by t.n desc)
                 from topic t join cbt.topics tp on tp.id = t.topic_id left join e_topic e using (topic_id)), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'answered', n, 'pct', round(100 * pct, 1),
                 'avg_sec', round(ms / 1000.0, 1)) order by wk) from weeks), '[]'::jsonb),
    -- Practise next: the weakest topic with enough answers, else the weakest with any, else the least-practised topic in a subject you use.
    'next', (select jsonb_build_object('topic_id', t.topic_id, 'name', tp.name, 'subject', t.subject_code, 'pct', round(100.0 * t.c / t.n, 1))
             from topic t join cbt.topics tp on tp.id = t.topic_id
             order by (t.n >= 10) desc, (t.c::numeric / t.n) asc, t.n desc limit 1)
  ) end $$;
revoke execute on function cbt.my_analysis() from public, anon;
grant execute on function cbt.my_analysis() to authenticated;

create or replace function cbt.attempt_analysis(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare t cbt.attempts;
begin
  select * into t from cbt.attempts where id = p_attempt and user_id = auth.uid() and status = 'final';
  if t.id is null then return null; end if;
  return (
    with mine as (select * from cbt._answers('-infinity') where attempt_id = t.id),
    others as (select e.* from cbt._answers(now() - interval '180 days') e
               where e.user_id <> t.user_id and e.question_id in (select question_id from mine)),
    q as (select question_id, avg(is_correct::int) pct, avg(time_ms) ms, count(*) n from others group by question_id),
    peers as (select o.score, o.total from cbt.attempts o
              where o.assessment_id = t.assessment_id and o.status = 'final' and o.user_id <> t.user_id and o.total > 0)
    select jsonb_build_object(
      'answered', (select count(*) from mine),
      'avg_sec', (select round(avg(time_ms) / 1000.0, 1) from mine),
      'community_avg_sec', (select round(avg(ms) / 1000.0, 1) from q where n >= 3),
      'community_pct', (select round(100 * avg(pct), 1) from q where n >= 3),
      'peers', (select count(*) from peers),
      'peer_avg_pct', (select round(100 * avg(score::numeric / total), 1) from peers),
      'percentile', (select case when count(*) >= 3 then round(100.0 * count(*) filter (where score::numeric / total < t.score::numeric / nullif(t.total, 0)) / count(*)) end from peers),
      'questions', coalesce((select jsonb_agg(jsonb_build_object('question_id', m.question_id, 'correct', m.is_correct,
                     'time_sec', round(m.time_ms / 1000.0, 1),
                     'community_pct', case when q.n >= 3 then round(100 * q.pct) end,
                     'community_avg_sec', case when q.n >= 3 then round(q.ms / 1000.0, 1) end))
                   from mine m left join q using (question_id)), '[]'::jsonb),
      -- Questions you got right that most others missed, and ones you missed that most got right.
      'beat_the_crowd', (select count(*) from mine m join q using (question_id) where q.n >= 3 and m.is_correct and q.pct < 0.5),
      'missed_easy', (select count(*) from mine m join q using (question_id) where q.n >= 3 and not m.is_correct and q.pct >= 0.7),
      'slow', (select count(*) from mine m join q using (question_id) where q.n >= 3 and m.time_ms > 2 * q.ms)));
end $$;
revoke execute on function cbt.attempt_analysis(uuid) from public, anon;
grant execute on function cbt.attempt_analysis(uuid) to authenticated;

-- The live size of the free question bank, for "13,779 questions, all free" on Home (works signed out).
create or replace function cbt.bank_count()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  select jsonb_build_object('total', count(*),
    'by_subject', (select jsonb_object_agg(code, n) from (select s.code, count(*) n from cbt.questions q join cbt.subjects s on s.id = q.subject_id
                   where q.status = 'published' group by s.code) x))
  from cbt.questions where status = 'published' $$;
revoke execute on function cbt.bank_count() from public;
grant execute on function cbt.bank_count() to anon, authenticated;
