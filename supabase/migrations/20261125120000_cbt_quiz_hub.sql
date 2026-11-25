-- KAIRO's own Quizzes section: a hub (today's Daily Builder Quiz, live challenges, every recent quiz) and a page per
-- quiz (details, your result and rank, the full leaderboard). Readable signed out too; your own numbers only when
-- signed in. Names on boards: "First L." for signed-in viewers (as the rest of KAIRO), initials only when signed out.

-- Your numbers on one quiz: attempts, best score, the attempt that ranks, and its rank.
create or replace function cbt._my_quiz(p_id uuid) returns jsonb
language sql stable security definer set search_path = cbt, pg_temp as $$
  with mine as (
    select t.* from cbt.attempts t where auth.uid() is not null and t.user_id = auth.uid() and t.assessment_id = p_id
  ), counted as (
    select t.id, t.user_id, rank() over (order by t.score desc, t.duration_sec asc, t.server_received_at asc) rnk
    from cbt.attempts t where t.assessment_id = p_id and t.counts_for_rank and t.status = 'final'
  )
  select case when not exists (select 1 from mine) then null else jsonb_build_object(
    'attempts', (select count(*) from mine),
    'best', (select max(score) from mine where status = 'final'),
    'last_attempt_id', (select id from mine where status = 'final' order by submitted_at desc nulls last limit 1),
    'in_progress_id', (select id from mine where status = 'in_progress' and (deadline_at is null or deadline_at > now()) order by started_at desc limit 1),
    'ranked_attempt_id', (select id from mine where counts_for_rank and status = 'final' limit 1),
    'rank', (select rnk from counted c where c.user_id = auth.uid() limit 1)) end $$;
revoke execute on function cbt._my_quiz(uuid) from public, anon, authenticated;

create or replace function cbt.quiz_hub()
returns jsonb language sql stable security definer set search_path = cbt, pg_temp as $$
  with cards as (
    select a, cbt._public_card(a) || jsonb_build_object('me', cbt._my_quiz(a.id)) card
    from cbt.assessments a
    where a.slug is not null and not a.personal and a.status in ('live', 'scheduled', 'closed')
      and coalesce(a.opens_at, a.created_at) > now() - interval '90 days'
  )
  select jsonb_build_object(
    'today', (select card from cards where (a).type = 'daily_quiz' and (a).status = 'live'
              order by (a).opens_at desc limit 1),
    'challenges', coalesce((select jsonb_agg(card order by (a).featured desc, (a).opens_at desc) from cards
                            where (a).type <> 'daily_quiz' and (a).status in ('live', 'scheduled')), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(card order by coalesce((a).opens_at, (a).created_at) desc) from (
                          select * from cards where (a).status in ('live', 'closed')
                          order by coalesce((a).opens_at, (a).created_at) desc limit 60) x), '[]'::jsonb)) $$;
revoke execute on function cbt.quiz_hub() from public;
grant execute on function cbt.quiz_hub() to anon, authenticated;

create or replace function cbt.quiz_page(p_id uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; v_signed_in boolean := auth.uid() is not null;
begin
  select * into a from cbt.assessments where id = p_id and not personal and status in ('live', 'scheduled', 'closed', 'archived');
  if a.id is null then return null; end if;
  return cbt._public_card(a) || jsonb_build_object(
    'me', cbt._my_quiz(a.id),
    'board', coalesce((select jsonb_agg(jsonb_build_object('rank', r.rnk, 'name', r.nm, 'score', r.score, 'total', r.total,
                         'duration_sec', r.duration_sec, 'is_me', r.is_me) order by r.rnk, r.server_received_at)
                       from (
                         select rank() over (order by t.score desc, t.duration_sec asc, t.server_received_at asc) rnk,
                                case when v_signed_in
                                     then coalesce(nullif(split_part(btrim(p.full_name), ' ', 1)
                                          || coalesce(' ' || left(nullif(split_part(btrim(p.full_name), ' ', 2), ''), 1) || '.', ''), ''), 'Builder')
                                     else coalesce(nullif(upper(left(split_part(btrim(p.full_name), ' ', 1), 1))
                                          || coalesce('.' || nullif(upper(left(nullif(split_part(btrim(p.full_name), ' ', 2), ''), 1)), '') || '.', '.'), '.'), 'Builder') end nm,
                                t.score, t.total, t.duration_sec, t.server_received_at, t.user_id = auth.uid() is_me
                         from cbt.attempts t join cbt.profiles p on p.id = t.user_id
                         where t.assessment_id = a.id and t.counts_for_rank and t.status = 'final') r
                       where r.rnk <= least(greatest(coalesce(p_limit, 50), 1), 200) or r.is_me), '[]'::jsonb));
end $$;
revoke execute on function cbt.quiz_page(uuid, int) from public;
grant execute on function cbt.quiz_page(uuid, int) to anon, authenticated;
