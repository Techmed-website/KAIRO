-- Guest → account conversion: three new product events and an admin-only report. Additive.
--   guest_prompt_shown  a guest was shown the sign-up form or bar (props.source: result | bar | google_tap)
--   guest_gate_shown    a guest who already used their free quiz hit the sign-up wall
--   guest_converted     a guest became a real account (same user id)
create or replace function cbt._fi_event_names() returns text[] language sql immutable set search_path = cbt, pg_temp as $$ select array[
  'user_registered','user_login','user_logout','user_session_started','user_session_ended',
  'page_viewed','feature_opened','navigation_clicked','search_performed',
  'practice_started','question_viewed','question_answered','practice_paused','practice_resumed','practice_completed','practice_abandoned',
  'question_bank_opened','subject_selected','topic_selected','year_filter_selected','question_search_performed',
  'daily_builder_quiz_viewed','daily_builder_quiz_started','quiz_started','quiz_answered','quiz_completed','quiz_abandoned',
  'mock_started','mock_question_answered','mock_submitted','mock_completed','result_viewed','answer_review_opened',
  'offline_pack_viewed','offline_pack_downloaded','leaderboard_viewed','profile_viewed','achievement_viewed',
  'study_planner_opened','study_plan_saved','share_clicked',
  'guest_prompt_shown','guest_gate_shown','guest_converted'] $$;

create or replace function cbt.fi_guests(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = cbt, pg_temp as $$
declare f timestamptz := cbt._fi_ts(p_from); t timestamptz := cbt._fi_ts(p_to + 1);
begin
  perform cbt._require_admin();
  perform cbt._fi_check_range(p_from, p_to);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'guests_now', (select count(*) from cbt._fi_people() where is_guest),
    'guests_played', (select count(distinct user_id) from cbt._fi_attempts(f, t) where is_guest),
    'guests_finished', (select count(distinct user_id) from cbt._fi_attempts(f, t) where is_guest and status = 'final'),
    'guests_replayed', (select count(*) from (select user_id from cbt._fi_attempts(f, t) where is_guest and status = 'final' group by 1 having count(*) >= 2) x),
    'prompted', (select count(distinct user_id) from cbt.events where name = 'guest_prompt_shown' and created_at >= f and created_at < t),
    'gated', (select count(distinct user_id) from cbt.events where name = 'guest_gate_shown' and created_at >= f and created_at < t),
    'converted', (select count(distinct user_id) from cbt.events where name = 'guest_converted' and created_at >= f and created_at < t),
    'tracking_since', (select cbt._fi_day(min(created_at)) from cbt.events where name in ('guest_prompt_shown','guest_gate_shown','guest_converted')),
    'coverage', cbt._fi_coverage());
end $$;
revoke execute on function cbt.fi_guests(date, date) from public, anon;
grant execute on function cbt.fi_guests(date, date) to authenticated;
