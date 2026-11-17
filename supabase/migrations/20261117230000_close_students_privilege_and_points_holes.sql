-- Close two privilege holes found in the Phase 0 audit (docs/rebuild/PHASE-0-AUDIT.md §6).
--
-- 1. kairo.award_arena_points(uuid, int) is SECURITY DEFINER and was executable by
--    every signed-in user, so anyone could add points to any student. Nothing on the
--    client calls it, so revoke it from the API roles.
-- 2. "Update own student row" had no column limits, so a student could set
--    is_admin / is_official_account on their own row and pass the admin checks in
--    the challenges policies and review_quiz/review_community_question. Replace
--    table-wide INSERT/UPDATE with column grants that leave out the privileged and
--    server-maintained columns. The legacy app never writes those (see
--    SupabaseSyncAdapter._profileToRow), so it keeps working.
--    kairo_points stays writable because the legacy app computes points on the
--    phone. Points are fixed by design in the new cbt schema.

revoke execute on function kairo.award_arena_points(uuid, integer) from public, anon, authenticated;

do $$
declare
  locked text[] := array[
    'is_admin', 'is_official_account', 'is_verified_creator', 'creator_badge',
    'creator_reputation_score', 'quizzes_created_count', 'quiz_likes_received_count',
    'division', 'division_tier', 'arena_wins', 'arena_completed', 'arena_win_rate'
  ];
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'kairo' and table_name = 'students'
    and column_name <> all (locked);

  execute 'revoke insert, update on kairo.students from anon, authenticated';
  execute format('grant insert (%s) on kairo.students to authenticated', cols);
  execute format('grant update (%s) on kairo.students to authenticated', cols);
end $$;
