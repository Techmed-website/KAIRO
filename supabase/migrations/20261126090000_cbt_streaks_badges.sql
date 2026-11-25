-- Streaks and badges (handover 4B.2).
-- A streak is a run of Lagos calendar days with at least one finished attempt (practice, daily quiz, mock or challenge).
-- Badges are earned once and kept (cbt.user_badges), awarded by cbt.award_badges(), which cbt.my_progress() calls,
-- so the app only needs one call on Home, Profile and the result screen. No trigger on submit_attempt.

create table if not exists cbt.badges (
  code        text primary key,
  title       text not null,
  description text not null,
  icon        text not null,
  goal        int,              -- for progress bars: target count (null = yes/no badge)
  sort        int not null
);
alter table cbt.badges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'cbt' and tablename = 'badges' and policyname = 'read_badges') then
    create policy read_badges on cbt.badges for select using (true);
  end if;
end $$;
grant select on cbt.badges to anon, authenticated;

insert into cbt.badges (code, title, description, icon, goal, sort) values
  ('first_quiz',     'First steps',     'Finish your first practice on KAIRO.',                      '🎯', 1,    10),
  ('streak_3',       'On a roll',       'Practise 3 days in a row.',                                 '🔥', 3,    20),
  ('streak_7',       'Week warrior',    'Practise 7 days in a row.',                                 '⚡', 7,    30),
  ('streak_30',      'Unstoppable',     'Practise 30 days in a row.',                                '🏆', 30,   40),
  ('daily_7',        'Daily regular',   'Finish 7 Daily Builder quizzes.',                           '📅', 7,    50),
  ('questions_100',  'Century',         'Answer 100 questions.',                                     '💯', 100,  60),
  ('questions_1000', 'Thousand strong', 'Answer 1,000 questions.',                                   '🧠', 1000, 70),
  ('perfect',        'Perfect score',   'Score 100% on a paper of 10 or more questions.',            '🌟', null, 80),
  ('topic_master',   'Topic master',    'Answer 20+ questions in one topic with 80% or better.',     '🎓', null, 90),
  ('top_10',         'Top 10',          'Finish in the top 10 of a ranked quiz.',                    '🥇', null, 100),
  ('mock_done',      'Full mock',       'Finish a full JAMB mock.',                                  '📝', null, 110)
on conflict (code) do update set title = excluded.title, description = excluded.description, icon = excluded.icon,
  goal = excluded.goal, sort = excluded.sort;

create table if not exists cbt.user_badges (
  user_id    uuid not null references cbt.profiles(id) on delete cascade,
  badge_code text not null references cbt.badges(code),
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_code)
);
alter table cbt.user_badges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'cbt' and tablename = 'user_badges' and policyname = 'own_badges') then
    create policy own_badges on cbt.user_badges for select to authenticated using (user_id = auth.uid() or cbt.is_staff());
  end if;
end $$;
grant select on cbt.user_badges to authenticated;

-- The Lagos day an attempt counts for: when it was finished (client clock), never later than the server saw it.
create or replace function cbt._attempt_day(t cbt.attempts) returns date
language sql immutable set search_path = cbt, pg_temp as
$$ select (least(coalesce(t.submitted_at, t.server_received_at), coalesce(t.server_received_at, t.submitted_at)) at time zone 'Africa/Lagos')::date $$;

-- Current streak (ending today, or yesterday if today is not done yet), best streak ever, and whether today is done.
create or replace function cbt._streak(p_uid uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with days as (
    select distinct cbt._attempt_day(t) d from cbt.attempts t
    where t.user_id = p_uid and t.status = 'final' and t.server_received_at is not null
  ), runs as (
    select d, d - (row_number() over (order by d))::int grp from days
  ), islands as (
    select min(d) s, max(d) e, count(*)::int n from runs group by grp
  ), today as (select (p_now at time zone 'Africa/Lagos')::date v)
  select jsonb_build_object(
    'current', coalesce((select n from islands, today where e >= today.v - 1 order by e desc limit 1), 0),
    'best', coalesce((select max(n) from islands), 0),
    'today', exists (select 1 from days, today where d = today.v),
    'days', coalesce((select count(*) from days), 0),
    'week', (select coalesce(jsonb_agg(exists (select 1 from days where d = g::date) order by g), '[]'::jsonb)
             from today, generate_series(today.v - 6, today.v, interval '1 day') g)) $$;
revoke execute on function cbt._streak(uuid, timestamptz) from public, anon, authenticated;

-- Give the caller (or p_uid, for service use) every badge they now qualify for. Returns the codes newly earned.
create or replace function cbt.award_badges(p_uid uuid)
returns text[] language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare s jsonb; v_q int; v_daily int; v_new text[];
begin
  if p_uid is null then return '{}'; end if;
  s := cbt._streak(p_uid);
  select count(*) into v_q from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
   where t.user_id = p_uid and t.status = 'final' and aa.selected_option is not null;
  select count(distinct t.assessment_id) into v_daily from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
   where t.user_id = p_uid and t.status = 'final' and a.type = 'daily_quiz';

  with earned(code) as (
    select 'first_quiz' where (s ->> 'days')::int >= 1
    union all select 'streak_3'  where (s ->> 'best')::int >= 3
    union all select 'streak_7'  where (s ->> 'best')::int >= 7
    union all select 'streak_30' where (s ->> 'best')::int >= 30
    union all select 'daily_7' where v_daily >= 7
    union all select 'questions_100' where v_q >= 100
    union all select 'questions_1000' where v_q >= 1000
    union all select 'perfect' where exists (select 1 from cbt.attempts t where t.user_id = p_uid and t.status = 'final'
                                             and t.total >= 10 and t.score = t.total)
    union all select 'topic_master' where exists (select 1 from cbt.topic_stats ts where ts.user_id = p_uid
                                                  and ts.attempted >= 20 and ts.correct >= 0.8 * ts.attempted)
    union all select 'mock_done' where exists (select 1 from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
                                               where t.user_id = p_uid and t.status = 'final' and a.type = 'mock')
    union all select 'top_10' where exists (
      select 1 from cbt.attempts mine
      where mine.user_id = p_uid and mine.counts_for_rank and mine.status = 'final'
        and (select count(*) from cbt.attempts o where o.assessment_id = mine.assessment_id and o.counts_for_rank
               and o.status = 'final' and (o.score > mine.score or (o.score = mine.score and o.duration_sec < mine.duration_sec))) < 10)
  ), ins as (
    insert into cbt.user_badges (user_id, badge_code) select p_uid, code from earned
    on conflict do nothing returning badge_code
  ) select coalesce(array_agg(badge_code), '{}') into v_new from ins;
  return v_new;
end $$;
revoke execute on function cbt.award_badges(uuid) from public, anon, authenticated;

-- Everything the app shows about streaks and badges, for the signed-in student. Awards new badges as a side effect.
create or replace function cbt.my_progress()
returns jsonb language plpgsql volatile security definer set search_path = cbt, pg_temp as $$
declare uid uuid := auth.uid(); v_new text[]; s jsonb; v_q int; v_daily int;
begin
  if uid is null then return null; end if;
  v_new := cbt.award_badges(uid);
  s := cbt._streak(uid);
  select count(*) into v_q from cbt.attempt_answers aa join cbt.attempts t on t.id = aa.attempt_id
   where t.user_id = uid and t.status = 'final' and aa.selected_option is not null;
  select count(distinct t.assessment_id) into v_daily from cbt.attempts t join cbt.assessments a on a.id = t.assessment_id
   where t.user_id = uid and t.status = 'final' and a.type = 'daily_quiz';
  return jsonb_build_object(
    'streak', s,
    'questions', v_q,
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
