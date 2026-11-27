# KAIRO 2.0 · Founder Intelligence (Phase 1)

Admin-only product analytics inside KAIRO at `/founder` (Profile → Staff → Founder Intelligence, or the "Founder ›" button on the Question desk). Visible to `cbt.profiles.role = 'admin'` only. Editors keep the question desk and quiz admin but do not see founder analytics.

## 1. Architecture assessment (audit, 27 Nov 2026)

| Area | Finding |
|---|---|
| App | `apps/kairo`: React 18, Vite PWA, React Router 6, plain CSS tokens (`ui/tokens.css`, `ui/base.css`). Live branch `ccr-03fba2de-mk3oq7`. The old `kairo-app/` (React 19) is not the live app. |
| Backend | Supabase `unbgborbhxzsotaieiun`, schema `cbt`. All writes go through `SECURITY DEFINER` RPCs; RLS is on for every table. |
| Auth / admin | Login is shared with techmedng.com (cookie session). Roles live in `cbt.profiles.role` (`student`/`editor`/`admin`); `cbt.is_staff()` = editor or admin, `cbt._require_staff()` guards the quiz admin RPCs. One admin account exists. |
| Existing admin | `/editor` (question desk), `/editor/quizzes` (quiz admin). Untouched apart from one link. |
| Analytics before | **None in KAIRO.** No Google Analytics, no event table. GA exists only on the techmedng.com website (conversion events). `cbt.audit_log` records staff actions only. |
| Historical records | `cbt.profiles.created_at` (first KAIRO sign-in), `cbt.attempts` (every practice, topic test, daily quiz, challenge and mock: start, submit, status, deadline), `cbt.attempt_answers` (one row per question per attempt, primary key prevents duplicates), `cbt.assessments` (type, personal flag, title), `auth.users.is_anonymous` (guests). |
| Not captured before | Page views, feature opens, logins, sessions, offline downloads, leaderboard/profile/planner views, answer-review opens. |

## 2. Reused

`cbt.profiles` (students, roles, registration time), `cbt.attempts` + `cbt.attempt_answers` (all learning activity — authoritative, server-scored), `cbt.assessments` (feature classification), `cbt.subjects`, `auth.users.is_anonymous`, `cbt.my_role()`, the app's `deviceId()`, the existing design tokens, `Tabs`/`chip`/`card` styles, and the existing route shell.

## 3. New database objects (`supabase/migrations/20261127120000_cbt_founder_intelligence.sql`, `…120100_cbt_events_retention.sql`)

Additive only. No existing table, function, policy or scoring logic is changed.

- `cbt.events` table (RLS on; select policy: admins only; no insert/update/delete grants). Added to the `supabase_realtime` publication.
- Indexes: `events(created_at)`, `events(user_id, created_at)`, `events(name, created_at)`, `attempts(started_at)`, `profiles(created_at)`.
- `cbt.track_events(jsonb)`: the only write path for events.
- `cbt.is_admin()`, internal helpers `_fi_*` (not executable by clients).
- Admin RPCs: `fi_overview`, `fi_feed`, `fi_engagement`, `fi_features`, `fi_funnel`, `fi_students`, `fi_student`.
- `cbt.prune_events()` + pg_cron job `kairo-prune-events` (03:17 UTC daily): events older than 400 days are removed.

## 4. Event tracking specification

Client: `apps/kairo/src/lib/analytics.ts`.

| Event | When | Feature |
|---|---|---|
| `page_viewed` | every route change (repeat within 2 s ignored) | from route, see `routeFeature()` |
| `answer_review_opened` | `/review/:id` opened | results |
| `user_login` / `user_logout` | real sign-in (not refresh, not guests) / Sign out button | – |
| `user_session_started` | first event after 30 min idle | – |
| `offline_pack_downloaded` | offline packs downloaded (`props.count`) | offline |
| `study_plan_saved` | study plan saved to the server | planner |

Fields: `id` (client UUID, primary key → idempotent), `user_id` (from the JWT, never the payload), `anon_id` (install id for signed-out → signed-in attribution), `session_id`, `name`, `feature`, `entity_id`, `subject` (`^[A-Z]{3}$`), `props` (allow-listed keys only: count, mode, topic_id, year, from, tab, size, query_length, results, source, quiz_type, level; values ≤ 80 chars), `device` (mobile/tablet/desktop), `app_version`, `path` (pattern, ids removed), `client_at` (informational), `created_at` (server time, used for all reporting).

The full proposed taxonomy is allow-listed server-side so it can be adopted later without a migration. Practice/quiz/mock start, answer and completion events are deliberately **not** sent from the client: the server already records them in `cbt.attempts`, and reports read them from there.

Delivery: in-memory queue, batches of ≤ 20, flushed after 8 s, on `visibilitychange: hidden` (fetch `keepalive`), and on reconnect; persisted to localStorage (≤ 200 events, ≤ 3 days) when offline; one request in flight; never throws; `/cbt` (exam runner), `/editor` and `/founder` send nothing. Server: ≤ 50 events per call, ≤ 600 events per user per 10 minutes, unknown names/ids dropped, `exception when others → 0` so a failure can never reach the student.

Not collected: passwords, tokens, emails, phone numbers, names, question text, chosen answers.

## 5. Metric definitions

- **Student**: `cbt.profiles` row, role `student`, auth user not anonymous. Staff always excluded; guests reported separately.
- **Registration**: profile created (first KAIRO sign-in; the TECHMED account may be older).
- **Qualifying activity**: started or submitted a practice/quiz/mock attempt, or `offline_pack_downloaded`, `study_plan_saved`, `answer_review_opened`. Logins and page views never count.
- **DAU**: unique students with qualifying activity on a Lagos calendar day. Overview card = average per day over the period (+ last day).
- **WAU / MAU**: unique students active in the 7 / 30 Lagos days ending on the last day of the period.
- **Returning user**: active in the period on a day later than their first-ever active day.
- **Questions answered**: `attempt_answers` rows with an option chosen, in non-rejected attempts started in the period. Cannot be inflated by resent events.
- **Practice session**: personal non-mock attempt (topic, year, custom/mixed, retry/review). **Quiz**: daily quiz and challenges. **Mock**: full JAMB mock. Starts = attempts started in the period; completions = those submitted; abandoned = still open after 24 h / past the timer.
- **Engaged learner**: completed ≥ 1 session and answered ≥ 10 questions in the period.
- **Retention**: cohort = registration Lagos day. Day-N = active on exactly day N (calendar-day). "Within 7 days" = active on any of days 1–7 (rolling, shown separately). Cells are null until day N has passed.
- **Funnel**: cohort = registered in the period; each stage must occur after the previous one and within the chosen window (default 14 days).
- **Previous period**: same number of days immediately before; comparison shown only when that period lies inside recorded history.

## 6. Historical reconstruction

| Metric | Since relaunch (24 Nov) | Notes |
|---|---|---|
| Registrations, guests | ✅ reconstructed | profile creation time |
| Practice / quiz / mock starts, completions, abandonment | ✅ | `cbt.attempts` from 18 Nov |
| Questions answered | ✅ | dated by attempt start (answers carry no timestamp) |
| DAU/WAU/MAU, returning, retention, funnel (stages 1, 3–6) | ✅ | from attempts |
| Page views, feature opens, sessions, session length, logins, offline downloads, review opens, planner saves | ❌ not available before tracking goes live | labelled "Collecting since …" in the dashboard |
| Website GA | not used | GA is website-only, not KAIRO; no reliable link to KAIRO users |

## 7. Tests

- SQL: `supabase/drafts/tests/22_founder_intelligence_test.sql` (isolated October-2026 fixtures; run with all 22 suites by `run.sh`). Covers admin vs student vs editor vs anon access, RLS on events, idempotent tracking, prop allow-list, rate limit, Lagos day boundaries, unique actives vs raw events, question counts unaffected by events, start vs completion, abandonment, guests excluded, retention maturity, funnel ordering, feature totals, explorer segments and no PII.
- App: `apps/kairo/src/test/founder.test.ts` (route mapping, no tracking of `/cbt`, batching, retry on network failure, queue cap, Lagos dates, presets, insight sample-size rules).

## 8. Security

Every `fi_*` RPC is `SECURITY DEFINER`, revoked from `anon`, and calls `cbt._require_admin()` (raises 42501). Helpers that read raw data are not executable by any client role. `cbt.events` has RLS with an admin-only select policy (also governs Realtime). At the founder's request (27 Nov), the Student Explorer and Live Activity show each student's name, email and phone so the founder can follow up. These are returned only by the admin-only RPCs. Phone falls back to the number captured at TECHMED sign-up (auth metadata) when the KAIRO profile has none (45 of 95 students had a number on 27 Nov). The Explorer can export the current segment as CSV. Guests are shown as `G-XXXXXX`; every student also has a stable code `S-XXXXXX`. The client route guard is only a convenience.

## 9. Known limitations

- Registration = first KAIRO sign-in; for website accounts created earlier, the KAIRO date is used.
- A guest who later converts keeps the profile date of their guest session.
- Questions are dated by attempt start, so an attempt spanning midnight counts on the start day.
- Offline attempts use the device's start time (as the existing app does).
- Practice mode is inferred from the session title generated by `cbt.create_practice` (stable since 18 Nov).
- Live feed updates in realtime when product events arrive; attempt-only activity appears within the 60-second fallback refresh.
- Session duration is a lower bound (time after the last event is invisible).
- Aggregations are computed on request (fast at today's scale; < 1k attempts). Revisit with materialised daily rollups beyond ~100k attempts.

## 10. Recommended next steps

1. Daily rollup table (pg_cron) once attempts exceed ~100k.
2. Guest → account conversion timestamp (record when `is_anonymous` flips) for a precise guest funnel.
3. Push opt-in and notification-open events, joined to OneSignal delivery logs.
4. Per-subject and per-topic engagement drill-downs.
5. Weekly founder email digest built from `fi_overview`.
6. Configurable funnel stages in the UI.

## 11. Verified on production (27 Nov 2026, period 24–27 Nov)

Migrations applied to `unbgborbhxzsotaieiun`: part 1 (events + helpers), part 2 (reports), contacts, retention (+ cron), search_path. Checked as the admin account inside rolled-back transactions:

| Check | Dashboard | Independent SQL |
|---|---|---|
| Registrations since relaunch | 92 | 92 |
| Questions answered | 5,041 | 5,041 |
| Active students | 90 | 90 |

A student account calling `fi_students` is refused (42501) and sees 0 rows of `cbt.events`. Report timings: 23–99 ms. Funnel since relaunch: 92 → 90 → 90 → 77 → 31 → 4. Cohort 25 Nov: D1 retention 25/55.

## 12. Guest → account conversion (27 Nov 2026)

Why: 44 guests had played, 33 finished a quiz and only 6 came back for a second one.

- **One free guest quiz, then a wall.** `/q/:id` is the only place a quiz starts. A guest who has finished one quiz sees the sign-up form instead of Start (an unfinished quiz can still be resumed). The first play stays free: it is what brings guests in.
- **Result screen.** Guests see the sign-up form first. "Review answers", retry-missed and topic practice are locked until they save; `/review/:id` sends guests back to the result.
- **Guest bar.** Every guest sees a sticky "Playing as a guest · Save free" bar across the app (not in the exam runner).
- **Tracking.** `guest_prompt_shown`, `guest_gate_shown`, `guest_converted` (same user id turning into an account, also after a Google redirect). Overview has a Guest conversion card (`cbt.fi_guests`, admin only).
- Limits: the wall is enforced in the app, not the database. A guest who clears site data or switches phone gets a new guest session and one more free quiz. Guests have no email or phone, so they cannot be followed up until they register.
