-- KAIRO 2.0: XP, levels, the XP leaderboard (daily / weekly / all time) and a wider achievement set.
-- Additive only: create or replace, one nullable column on cbt.badges, new badge rows. No stored XP: every number is
-- derived from finished attempts and earned badges each time, so nothing can be awarded twice and nothing comes from the app.
--
-- XP rules (all in Lagos time, from cbt.attempts with status 'final' and a server receipt; guests excluded):
--   answers     +1 per question answered, +2 more if correct. A question counts once per student per day, in the first
--               attempt that day that contains it (a retry with answers shown earns nothing new). Capped at 300 a day.
--   session     +10 for finishing a practice or test with 10+ questions new for today (first attempt on that paper), at most 5 a day.
--   daily_quiz  +20 for finishing a Daily Builder Quiz or challenge (first attempt), +10 more for 80% or better.
--   mock        +50 for a full mock with 120+ answers, at most 1 a day.
--   day         +5 for practising on a day (the first finished attempt that day).
--   badge       +25 for each achievement earned.
-- Levels: reaching level n needs 50·n·(n−1) XP (level 2 at 100, 3 at 300, 4 at 600, 5 at 1,000, 10 at 4,500).
-- Tiers: Bronze 1–4, Silver 5–9, Gold 10–19, Platinum 20–29, Diamond 30+.
-- Weekly board: from Sunday 22:00 to the next Sunday 22:00 (Lagos). Daily board: Lagos midnight to midnight.

create or replace function cbt.day_start(p_at timestamptz default now()) returns timestamptz
language sql immutable set search_path = cbt, pg_temp as
$$ select (date_trunc('day', p_at at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos' $$;

-- Sunday 22:00 Lagos = Monday 00:00 minus 2 hours: shift by 2 h, take the ISO week, shift back.
create or replace function cbt.week_start(p_at timestamptz default now()) returns timestamptz
language sql immutable set search_path = cbt, pg_temp as
$$ select (date_trunc('week', (p_at at time zone 'Africa/Lagos') + interval '2 hours') - interval '2 hours') at time zone 'Africa/Lagos' $$;

create or replace function cbt.level_for(p_xp int) returns jsonb
language plpgsql immutable set search_path = cbt, pg_temp as $$
declare n int := greatest(1, floor((1 + sqrt(1 + greatest(coalesce(p_xp, 0), 0) / 12.5)) / 2)::int);
begin
  while 50 * (n + 1) * n <= coalesce(p_xp, 0) loop n := n + 1; end loop;   -- guard against float rounding
  while n > 1 and 50 * n * (n - 1) > coalesce(p_xp, 0) loop n := n - 1; end loop;
  return jsonb_build_object('level', n, 'floor', 50 * n * (n - 1), 'next', 50 * (n + 1) * n,
    'tier', case when n < 5 then 'Bronze' when n < 10 then 'Silver' when n < 20 then 'Gold' when n < 30 then 'Platinum' else 'Diamond' end);
end $$;

-- Every XP event, for one student (p_uid) or everyone (null).
create or replace function cbt._xp_events(p_uid uuid)
returns table (user_id uuid, at timestamptz, kind text, xp int)
language sql stable security definer set search_path = cbt, pg_temp as $$
  with fa as (
    select t.id, t.user_id, t.assessment_id, t.score, t.total, t.server_received_at at_,
           (t.server_received_at at time zone 'Africa/Lagos')::date d, a.type::text atype
    from cbt.attempts t
    join cbt.assessments a on a.id = t.assessment_id
    join auth.users u on u.id = t.user_id
    where t.status = 'final' and t.server_received_at is not null and not coalesce(u.is_anonymous, false)
      and (p_uid is null or t.user_id = p_uid)
  ), ans as (
    select distinct on (fa.user_id, fa.d, aa.question_id) fa.id attempt_id, fa.user_id, fa.d, fa.at_, coalesce(aa.is_correct, false) ok
    from fa join cbt.attempt_answers aa on aa.attempt_id = fa.id
    where aa.selected_option is not null
    order by fa.user_id, fa.d, aa.question_id, fa.at_, fa.id
  ), per_att as (
    select attempt_id, user_id, d, min(at_) at_, sum(1 + 2 * ok::int)::int raw, count(*)::int n from ans group by 1, 2, 3
  ), capped as (
    select *, sum(raw) over (partition by user_id, d order by at_, attempt_id) cum from per_att
  ), cnt as (
    select fa.*,
      (select count(*) from cbt.attempt_answers aa where aa.attempt_id = fa.id and aa.selected_option is not null) answered,
      row_number() over (partition by fa.user_id, fa.assessment_id order by fa.at_, fa.id) nth
    from fa
  ), sess as (
    select c.user_id, c.at_, row_number() over (partition by c.user_id, c.d order by c.at_, c.id) k
    from cnt c join per_att p on p.attempt_id = c.id
    where c.nth = 1 and p.n >= 10 and c.atype not in ('daily_quiz', 'challenge', 'mock')
  ), mocks as (
    select user_id, at_, row_number() over (partition by user_id, d order by at_, id) k
    from cnt where atype = 'mock' and answered >= 120
  ), days as (
    select distinct on (user_id, d) user_id, at_ from fa order by user_id, d, at_
  )
  select user_id, at_, 'answers', (least(cum, 300) - least(cum - raw, 300))::int from capped
  union all select user_id, at_, 'session', 10 from sess where k <= 5
  union all select user_id, at_, 'daily_quiz', 20 from cnt where nth = 1 and atype in ('daily_quiz', 'challenge')
  union all select user_id, at_, 'daily_quiz_strong', 10 from cnt where nth = 1 and atype in ('daily_quiz', 'challenge') and total > 0 and score >= 0.8 * total
  union all select user_id, at_, 'mock', 50 from mocks where k = 1
  union all select user_id, at_, 'day', 5 from days
  union all select ub.user_id, ub.earned_at, 'badge', 25 from cbt.user_badges ub join auth.users u on u.id = ub.user_id
            where not coalesce(u.is_anonymous, false) and (p_uid is null or ub.user_id = p_uid) $$;
revoke execute on function cbt._xp_events(uuid) from public, anon, authenticated;

-- One student's XP: total, level, today, this week.
create or replace function cbt._xp_summary(p_uid uuid, p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  with e as (select * from cbt._xp_events(p_uid) where at <= p_now),
  t as (select coalesce(sum(xp), 0)::int total,
               coalesce(sum(xp) filter (where at >= cbt.day_start(p_now)), 0)::int today,
               coalesce(sum(xp) filter (where at >= cbt.week_start(p_now)), 0)::int week from e)
  select jsonb_build_object('total', t.total, 'today', t.today, 'week', t.week,
           'week_ends_at', cbt.week_start(p_now) + interval '7 days') || cbt.level_for(t.total)
  from t $$;
revoke execute on function cbt._xp_summary(uuid, timestamptz) from public, anon, authenticated;

-- The XP leaderboard. p_period: 'day' | 'week' | 'all'. Names are "First L."; your own row is always returned.
-- prev_rank: 'all' = your rank before today; 'week' = where you finished last week; 'day' = none.
create or replace function cbt._xp_board(p_uid uuid, p_period text, p_limit int, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  with w as (
    select case p_period when 'day' then cbt.day_start(p_now) when 'week' then cbt.week_start(p_now) else '-infinity'::timestamptz end s,
           case p_period when 'day' then cbt.day_start(p_now) + interval '1 day' when 'week' then cbt.week_start(p_now) + interval '7 days' end e
  ), ev as (select * from cbt._xp_events(null) where at <= p_now),
  life as (select user_id, sum(xp)::int total from ev group by 1),
  cur as (select ev.user_id, sum(ev.xp)::int xp, max(ev.at) last_at from ev, w where ev.at >= w.s group by 1 having sum(ev.xp) > 0),
  ranked as (select *, row_number() over (order by xp desc, last_at asc) rnk from cur),
  prev as (
    select user_id, row_number() over (order by sum(xp) desc, max(at) asc) rnk from ev, w
    where (p_period = 'all' and ev.at < cbt.day_start(p_now))
       or (p_period = 'week' and ev.at >= w.s - interval '7 days' and ev.at < w.s)
    group by user_id having sum(xp) > 0 and p_period in ('all', 'week')
  ), rows as (
    select r.rnk, r.xp, r.user_id = p_uid is_me, (cbt.level_for(l.total) ->> 'level')::int lvl, p.rnk prev_rnk,
           coalesce(nullif(split_part(btrim(pr.full_name), ' ', 1)
             || coalesce(' ' || left(nullif(split_part(btrim(pr.full_name), ' ', 2), ''), 1) || '.', ''), ''), 'Builder') nm
    from ranked r join life l using (user_id) left join prev p using (user_id) left join cbt.profiles pr on pr.id = r.user_id
  )
  select jsonb_build_object(
    'period', p_period, 'starts_at', case when p_period = 'all' then null else (select s from w) end, 'ends_at', (select e from w),
    'participants', (select count(*) from ranked),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rnk, 'name', nm, 'xp', xp, 'level', lvl, 'is_me', is_me, 'prev_rank', prev_rnk) order by rnk)
                      from rows where rnk <= least(greatest(coalesce(p_limit, 50), 1), 100)), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rnk, 'xp', xp, 'level', lvl, 'prev_rank', prev_rnk) from rows where is_me)) $$;
revoke execute on function cbt._xp_board(uuid, text, int, timestamptz) from public, anon, authenticated;

create or replace function cbt.xp_board(p_period text default 'week', p_limit int default 50) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  select case when auth.uid() is null or p_period not in ('day', 'week', 'all') then null
              else cbt._xp_board(auth.uid(), p_period, p_limit, now()) end $$;
revoke execute on function cbt.xp_board(text, int) from public, anon;
grant execute on function cbt.xp_board(text, int) to authenticated;

-- ---------------------------------------------------------------- achievements
alter table cbt.badges add column if not exists category text;

insert into cbt.badges (code, title, description, icon, goal, sort, category) values
  ('streak_3',       'On a roll',        'Practise 3 days in a row.',                                        '🔥', 3,    10, 'consistency'),
  ('streak_7',       'Week warrior',     'Practise 7 days in a row.',                                        '⚡', 7,    11, 'consistency'),
  ('streak_14',      'Two strong weeks', 'Practise 14 days in a row.',                                       '🔥', 14,   12, 'consistency'),
  ('streak_30',      'Unstoppable',      'Practise 30 days in a row.',                                       '🏆', 30,   13, 'consistency'),
  ('daily_7',        'Daily regular',    'Finish 7 Daily Builder Quizzes.',                                  '📅', 7,    14, 'consistency'),
  ('daily_30',       'Builder habit',    'Finish 30 Daily Builder Quizzes.',                                 '📅', 30,   15, 'consistency'),
  ('first_quiz',     'First steps',      'Finish your first practice on KAIRO.',                             '🎯', 1,    20, 'practice'),
  ('questions_100',  'Century',          'Answer 100 questions.',                                            '💯', 100,  21, 'practice'),
  ('questions_500',  'Scholar',          'Answer 500 questions.',                                            '📘', 500,  22, 'practice'),
  ('questions_1000', 'Thousand strong',  'Answer 1,000 questions.',                                          '🧠', 1000, 23, 'practice'),
  ('questions_5000', 'Question master',  'Answer 5,000 questions.',                                          '🧠', 5000, 24, 'practice'),
  ('accuracy_80',    'Sharp',            'Keep 80% accuracy over at least 200 answers.',                     '🎯', null, 30, 'accuracy'),
  ('accuracy_90',    'Sharpshooter',     'Keep 90% accuracy over at least 300 answers.',                     '🎯', null, 31, 'accuracy'),
  ('perfect',        'Perfect score',    'Score 100% on a paper of 10 or more questions.',                   '🌟', null, 32, 'accuracy'),
  ('rising',         'Rising',           'Lift your accuracy by 10 points: your last 7 days against before (50+ answers each).', '📈', null, 33, 'accuracy'),
  ('mock_done',      'Full mock',        'Finish a full JAMB mock with at least 120 answers.',               '📝', null, 40, 'exam'),
  ('mocks_5',        'Exam ready',       'Finish 5 full mocks with at least 120 answers each.',              '📝', 5,    41, 'exam'),
  ('mocks_10',       'Exam veteran',     'Finish 10 full mocks with at least 120 answers each.',             '📝', 10,   42, 'exam'),
  ('mocks_25',       'Exam master',      'Finish 25 full mocks with at least 120 answers each.',             '📝', 25,   43, 'exam'),
  ('top_10',         'Top 10',           'Finish in the top 10 of a ranked quiz.',                           '🥇', null, 50, 'competition'),
  ('weekly_top10',   'Weekly top 10',    'Finish a week in the top 10 of the weekly XP board.',              '🥇', null, 51, 'competition'),
  ('weekly_champion','Weekly champion',  'Finish a week at number 1 on the weekly XP board.',                '🏆', null, 52, 'competition'),
  ('all_subjects',   'All-rounder',      'Answer questions in all five UTME subjects.',                      '🧭', 5,    60, 'exploration'),
  ('topics_25',      'Explorer',         'Answer questions in 25 different topics.',                         '🧭', 25,   61, 'exploration'),
  ('topic_master',   'Topic master',     'Answer 20+ questions in one topic with 80% or better.',            '🎓', null, 62, 'exploration')
on conflict (code) do update set title = excluded.title, description = excluded.description, icon = excluded.icon,
  goal = excluded.goal, sort = excluded.sort, category = excluded.category;

-- Facts the badges and their progress bars need, for one student.
create or replace function cbt._badge_facts(p_uid uuid) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  with ans as (
    select aa.question_id, aa.is_correct, t.server_received_at at_, q.subject_id, v.topic_id
    from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
    join cbt.questions q on q.id = aa.question_id
    left join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
    where t.user_id = p_uid and t.status = 'final' and aa.selected_option is not null
  ), mocks as (
    select count(*) n from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
    where t.user_id = p_uid and t.status = 'final' and a.type = 'mock'
      and (select count(*) from cbt.attempt_answers aa where aa.attempt_id = t.id and aa.selected_option is not null) >= 120
  ), recent as (select count(*) n, avg(is_correct::int) acc from ans where at_ >= now() - interval '7 days'),
  before as (select count(*) n, avg(is_correct::int) acc from ans where at_ < now() - interval '7 days')
  select jsonb_build_object(
    'answered', (select count(*) from ans),
    'correct', (select count(*) filter (where is_correct) from ans),
    'subjects', (select count(distinct subject_id) from ans),
    'topics', (select count(distinct topic_id) from ans where topic_id is not null),
    'mocks', (select n from mocks),
    'rising', (select r.n >= 50 and b.n >= 50 and r.acc - b.acc >= 0.10 from recent r, before b)) $$;
revoke execute on function cbt._badge_facts(uuid) from public, anon, authenticated;

-- Weekly XP board results for weeks that have ended: the student's best finishing rank.
create or replace function cbt._best_week_rank(p_uid uuid, p_now timestamptz default now()) returns int
language sql stable security definer set search_path = cbt, pg_temp as $$
  with ev as (select user_id, cbt.week_start(at) wk, xp, at from cbt._xp_events(null) where at < cbt.week_start(p_now)),
  w as (select user_id, wk, row_number() over (partition by wk order by sum(xp) desc, max(at) asc) rnk
        from ev group by user_id, wk having sum(xp) > 0)
  select min(rnk)::int from w where user_id = p_uid $$;
revoke execute on function cbt._best_week_rank(uuid, timestamptz) from public, anon, authenticated;

create or replace function cbt.award_badges(p_uid uuid)
returns text[] language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare s jsonb; f jsonb; v_daily int; v_week int; v_new text[];
begin
  if p_uid is null then return '{}'; end if;
  s := cbt._streak(p_uid);
  f := cbt._badge_facts(p_uid);
  v_week := cbt._best_week_rank(p_uid);
  select count(distinct t.assessment_id) into v_daily from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
   where t.user_id = p_uid and t.status = 'final' and a.type = 'daily_quiz';

  with earned(code) as (
    select 'first_quiz' where (s ->> 'days')::int >= 1
    union all select 'streak_3'  where (s ->> 'best')::int >= 3
    union all select 'streak_7'  where (s ->> 'best')::int >= 7
    union all select 'streak_14' where (s ->> 'best')::int >= 14
    union all select 'streak_30' where (s ->> 'best')::int >= 30
    union all select 'daily_7'  where v_daily >= 7
    union all select 'daily_30' where v_daily >= 30
    union all select 'questions_100'  where (f ->> 'answered')::int >= 100
    union all select 'questions_500'  where (f ->> 'answered')::int >= 500
    union all select 'questions_1000' where (f ->> 'answered')::int >= 1000
    union all select 'questions_5000' where (f ->> 'answered')::int >= 5000
    union all select 'accuracy_80' where (f ->> 'answered')::int >= 200 and (f ->> 'correct')::int >= 0.8 * (f ->> 'answered')::int
    union all select 'accuracy_90' where (f ->> 'answered')::int >= 300 and (f ->> 'correct')::int >= 0.9 * (f ->> 'answered')::int
    union all select 'perfect' where exists (select 1 from cbt.attempts t where t.user_id = p_uid and t.status = 'final'
                                             and t.total >= 10 and t.score = t.total)
    union all select 'rising' where coalesce((f ->> 'rising')::boolean, false)
    union all select 'mock_done' where (f ->> 'mocks')::int >= 1
    union all select 'mocks_5'  where (f ->> 'mocks')::int >= 5
    union all select 'mocks_10' where (f ->> 'mocks')::int >= 10
    union all select 'mocks_25' where (f ->> 'mocks')::int >= 25
    union all select 'top_10' where exists (
      select 1 from cbt.attempts mine
      where mine.user_id = p_uid and mine.counts_for_rank and mine.status = 'final'
        and (select count(*) from cbt.attempts o where o.assessment_id = mine.assessment_id and o.counts_for_rank
               and o.status = 'final' and (o.score > mine.score or (o.score = mine.score and o.duration_sec < mine.duration_sec))) < 10)
    union all select 'weekly_top10' where v_week <= 10
    union all select 'weekly_champion' where v_week = 1
    union all select 'all_subjects' where (f ->> 'subjects')::int >= 5
    union all select 'topics_25' where (f ->> 'topics')::int >= 25
    union all select 'topic_master' where exists (select 1 from cbt.topic_stats ts where ts.user_id = p_uid
                                                  and ts.attempted >= 20 and ts.correct >= 0.8 * ts.attempted)
  ), ins as (
    insert into cbt.user_badges (user_id, badge_code) select p_uid, code from earned
    on conflict do nothing returning badge_code
  ) select coalesce(array_agg(badge_code), '{}') into v_new from ins;
  return v_new;
end $$;
revoke execute on function cbt.award_badges(uuid) from public, anon, authenticated;

-- my_progress: as before (streak, questions, correct, badges), now with XP and level, badge categories and progress.
create or replace function cbt.my_progress()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_new text[]; s jsonb; f jsonb; v_daily int;
begin
  if uid is null then return null; end if;
  v_new := cbt.award_badges(uid);
  s := cbt._streak(uid);
  f := cbt._badge_facts(uid);
  select count(distinct t.assessment_id) into v_daily from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
   where t.user_id = uid and t.status = 'final' and a.type = 'daily_quiz';
  return jsonb_build_object(
    'streak', s,
    'questions', (f ->> 'answered')::int,
    'correct', (f ->> 'correct')::int,
    'daily_quizzes', v_daily,
    'quizzes', (select count(*) from cbt.attempts t where t.user_id = uid and t.status = 'final'),
    'xp', cbt._xp_summary(uid),
    'new', to_jsonb(v_new),
    'badges', (select jsonb_agg(jsonb_build_object(
        'code', b.code, 'title', b.title, 'description', b.description, 'icon', b.icon, 'goal', b.goal, 'category', b.category,
        'earned_at', ub.earned_at,
        'progress', case b.code
          when 'first_quiz' then least((s ->> 'days')::int, 1)
          when 'streak_3' then least((s ->> 'best')::int, 3) when 'streak_7' then least((s ->> 'best')::int, 7)
          when 'streak_14' then least((s ->> 'best')::int, 14) when 'streak_30' then least((s ->> 'best')::int, 30)
          when 'daily_7' then least(v_daily, 7) when 'daily_30' then least(v_daily, 30)
          when 'questions_100' then least((f ->> 'answered')::int, 100) when 'questions_500' then least((f ->> 'answered')::int, 500)
          when 'questions_1000' then least((f ->> 'answered')::int, 1000) when 'questions_5000' then least((f ->> 'answered')::int, 5000)
          when 'mocks_5' then least((f ->> 'mocks')::int, 5) when 'mocks_10' then least((f ->> 'mocks')::int, 10)
          when 'mocks_25' then least((f ->> 'mocks')::int, 25)
          when 'all_subjects' then least((f ->> 'subjects')::int, 5) when 'topics_25' then least((f ->> 'topics')::int, 25) end)
        order by b.sort)
      from cbt.badges b left join cbt.user_badges ub on ub.badge_code = b.code and ub.user_id = uid));
end $$;
revoke execute on function cbt.my_progress() from public, anon;
grant execute on function cbt.my_progress() to authenticated;
