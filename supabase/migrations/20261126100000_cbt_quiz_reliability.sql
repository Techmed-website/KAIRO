-- Quiz reliability (25 Nov incident: 4 Builders played Day 15, 1 on the leaderboard).
-- What happened: new students signed up from the quiz link, tapped Start (the ranked attempt was created), and the app
-- sent them to profile setup before the first question. The 5-minute timer ran out on an attempt with no answers; when
-- they came back, the next attempt was a "retake" and never ranked. Expired attempts were also never finished.
-- Fixes here (the app fix is in apps/kairo):
--   1. cbt._finish_attempt / cbt.finish_expired_attempts: an attempt past its deadline (+10 min grace) is finished from its
--      saved answers, exactly like submit_attempt; one with no answer at all gives up its ranked slot. Runs every 10 minutes.
--   2. cbt.start_attempt: before deciding "first attempt", tidy this student's own expired attempts the same way, so a
--      never-started attempt no longer blocks their real first attempt from ranking.
--   3. One-off repair of attempts already affected.

-- Finish one expired in-progress attempt. Returns 'finished', 'released' (no answers: ranked slot freed) or 'skipped'.
create or replace function cbt._finish_attempt(p_attempt uuid)
returns text language plpgsql security definer set search_path = cbt, pg_temp as $$
declare t cbt.attempts; a cbt.assessments; v_answered int; v_score int; v_total int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_attempt::text, 0));
  select * into t from cbt.attempts where id = p_attempt for update;
  if t.id is null or t.status <> 'in_progress' or t.deadline_at is null or now() <= t.deadline_at then return 'skipped'; end if;
  select count(*) into v_answered from cbt.attempt_answers where attempt_id = t.id and selected_option is not null;
  if v_answered = 0 then
    update cbt.attempts set counts_for_rank = false where id = t.id and counts_for_rank;
    return 'released';
  end if;
  select * into a from cbt.assessments where id = t.assessment_id;
  update cbt.attempt_answers aa set is_correct = (aa.selected_option = v.correct_option)
  from cbt.question_versions v
  where aa.attempt_id = t.id and v.question_id = aa.question_id and v.version = aa.question_version;
  select count(*) into v_total from cbt.assessment_questions where assessment_id = t.assessment_id;
  select count(*) filter (where is_correct) into v_score from cbt.attempt_answers where attempt_id = t.id;
  update cbt.attempts set status = 'final', score = v_score, total = v_total, submitted_at = t.deadline_at,
         duration_sec = coalesce(a.time_limit_sec, extract(epoch from (t.deadline_at - t.started_at))::int),
         server_received_at = now()
  where id = t.id;
  insert into cbt.topic_stats (user_id, topic_id, attempted, correct, last_attempt_at)
  select t.user_id, v.topic_id, count(*), count(*) filter (where aa.is_correct), now()
  from cbt.attempt_answers aa
  join cbt.question_versions v on v.question_id = aa.question_id and v.version = aa.question_version
  where aa.attempt_id = t.id and aa.selected_option is not null and v.topic_id is not null
  group by v.topic_id
  on conflict (user_id, topic_id) do update
    set attempted = topic_stats.attempted + excluded.attempted, correct = topic_stats.correct + excluded.correct,
        last_attempt_at = excluded.last_attempt_at;
  return 'finished';
end $$;
revoke execute on function cbt._finish_attempt(uuid) from public, anon, authenticated;

-- Every attempt more than 10 minutes past its deadline (the same grace submit_attempt allows). For pg_cron.
create or replace function cbt.finish_expired_attempts()
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare r record; v text; n_fin int := 0; n_rel int := 0;
begin
  for r in select id from cbt.attempts where status = 'in_progress' and deadline_at is not null
           and deadline_at < now() - interval '10 minutes' order by deadline_at limit 2000 loop
    v := cbt._finish_attempt(r.id);
    if v = 'finished' then n_fin := n_fin + 1; elsif v = 'released' then n_rel := n_rel + 1; end if;
  end loop;
  return jsonb_build_object('finished', n_fin, 'released', n_rel);
end $$;
revoke execute on function cbt.finish_expired_attempts() from public, anon, authenticated;

create or replace function cbt.start_attempt(p_attempt uuid, p_assessment uuid, p_device text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; t cbt.attempts; uid uuid := auth.uid(); v_guest boolean := cbt.is_guest(); v_first boolean; r record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform cbt.ensure_profile();
  select * into t from cbt.attempts where id = p_attempt;
  if t.id is not null then
    if t.user_id <> uid then raise exception 'attempt belongs to another user' using errcode = '42501'; end if;
    return cbt._attempt_state(t, true);
  end if;
  select * into a from cbt.assessments where id = p_assessment;
  if a.id is null or a.status <> 'live' or (a.opens_at is not null and now() < a.opens_at)
     or (a.closes_at is not null and now() >= a.closes_at)
     or (a.personal and a.created_by is distinct from uid) then
    raise exception 'assessment is not open' using errcode = 'P0001';
  end if;
  if v_guest and not a.guests_allowed then raise exception 'sign in to take this quiz' using errcode = '28000'; end if;
  select * into t from cbt.attempts
  where user_id = uid and assessment_id = a.id and status = 'in_progress' and (deadline_at is null or deadline_at > now())
  order by started_at desc limit 1;
  if t.id is not null then return cbt._attempt_state(t, true); end if;
  if not cbt.is_staff() and exists (select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash is not null) then
    if nullif(btrim(p_passcode), '') is null or not exists (
         select 1 from cbt.assessment_secrets s where s.assessment_id = a.id and s.passcode_hash = extensions.crypt(btrim(p_passcode), s.passcode_hash)) then
      raise exception 'wrong passcode' using errcode = '28P01';
    end if;
  end if;
  -- Tidy this student's own expired attempts on this quiz first: finish the ones with answers, free the empty ones.
  for r in select id from cbt.attempts where user_id = uid and assessment_id = a.id and status = 'in_progress'
           and deadline_at is not null and deadline_at <= now() loop
    perform cbt._finish_attempt(r.id);
  end loop;
  if a.attempts_allowed is not null and
     (select count(*) from cbt.attempts where user_id = uid and assessment_id = a.id
        and (status = 'final' or (status = 'in_progress' and counts_for_rank))) >= a.attempts_allowed then
    raise exception 'already attempted' using errcode = '23505';
  end if;
  -- Ranked if this is the student's first real attempt: nothing already ranked and nothing finished before.
  v_first := a.ranked and not v_guest and not exists (
    select 1 from cbt.attempts where user_id = uid and assessment_id = a.id and (counts_for_rank or status in ('final', 'rejected')));
  insert into cbt.attempts (id, user_id, assessment_id, origin, counts_for_rank, shuffle_seed, started_at, deadline_at, device_id)
  values (p_attempt, uid, a.id, 'online', v_first, (random() * 2147483647)::int, now(),
          case when a.time_limit_sec is not null
               then least(now() + make_interval(secs => a.time_limit_sec), coalesce(a.closes_at, 'infinity')) end, p_device)
  returning * into t;
  return cbt._attempt_state(t, false);
end $$;

-- One-off repair: finish or free everything already expired, then rank each signed-in student's first finished attempt
-- on ranked quizzes where nothing of theirs is ranked (their "first" was an attempt that never reached a question).
select cbt.finish_expired_attempts();
with firsts as (
  select distinct on (t.user_id, t.assessment_id) t.id
  from cbt.attempts t
  join cbt.assessments a on a.id = t.assessment_id and a.ranked
  join auth.users u on u.id = t.user_id and not coalesce(u.is_anonymous, false)
  where t.status = 'final'
    and not exists (select 1 from cbt.attempts o where o.user_id = t.user_id and o.assessment_id = t.assessment_id
                    and (o.counts_for_rank or o.status = 'rejected'))
  order by t.user_id, t.assessment_id, t.started_at
)
update cbt.attempts set counts_for_rank = true where id in (select id from firsts);

select cron.schedule('kairo-finish-expired-attempts', '*/10 * * * *', 'select cbt.finish_expired_attempts()');

-- The quiz page also says exactly how many are ranked and how many played as guests.
create or replace function cbt.quiz_page(p_id uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare a cbt.assessments; v_signed_in boolean := auth.uid() is not null;
begin
  select * into a from cbt.assessments where id = p_id and not personal and status in ('live', 'scheduled', 'closed', 'archived');
  if a.id is null then return null; end if;
  return cbt._public_card(a) || jsonb_build_object(
    'me', cbt._my_quiz(a.id),
    -- Exact counts for the page: how many are on the board, and how many finished as guests (not ranked until they save).
    'ranked_count', (select count(*) from cbt.attempts t where t.assessment_id = a.id and t.counts_for_rank and t.status = 'final'),
    'guest_players', (select count(distinct t.user_id) from cbt.attempts t join auth.users u on u.id = t.user_id
                      where t.assessment_id = a.id and t.status = 'final' and coalesce(u.is_anonymous, false)),
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
