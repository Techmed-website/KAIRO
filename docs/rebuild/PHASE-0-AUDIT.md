# KAIRO Rebuild: Phase 0 Audit

Audit date: 17 Nov 2026 · Draft for review by Wisdom Johnson

Covers the KAIRO repo, the techmed-website- repo, the live Supabase project
`unbgborbhxzsotaieiun`, and QuizBoot usage. Every number below was measured on
the audit date. They are counts, not estimates.

## 1. Headline findings

1. **KAIRO currently has no active users; QuizBoot does.** KAIRO had 0 students
   answering in the last 7 days and 8 in the last 30 (36 answers in total). Last
   activity was 10 Nov. Over the same period QuizBoot's automated Daily Builder
   Quiz got 8–80 attempts a day (about 48 on average), the weekly CBT challenges
   got about 100–136, and the Medical mock got 131. The rebuild competes with
   QuizBoot, not with the old KAIRO, and v1 must match QuizBoot's daily-quiz
   flow before anything else.
2. **Identity is already solved.** techmedng.com and KAIRO use the same
   Supabase project and the same `auth.users` table (650 users, 356 signed in
   during the last 30 days). Spec §10 option 1 (shared accounts) is already in
   place, so the signed hand-off and account-linking work can be dropped.
3. **The results "webhook" is unnecessary.** Because both sites share one
   database, TECHMED's dashboard can read KAIRO results through a
   row-level-secured view. No webhook, retries or signing are needed, and
   results show up instantly rather than "within a minute". See spec v0.2 §10.
4. **There is a real question bank, but it needs cleaning before publishing.**
   It holds 6,901 questions. Every one has an explanation, which answers spec
   open question 3. Defects are listed in §4.
5. **The old app can't meet the spec's speed or offline targets without a
   rewrite.** Its main bundle is 365 KB gzipped plus 78 KB for KaTeX, about 3×
   the 150 KB budget. The service worker deliberately caches nothing, so the
   app won't open offline.
6. **There are live security holes in the `kairo` schema.** None has been
   exploited. Fixes are drafted in §6 and need approval before they touch
   production.

**Recommendation:** rebuild, as the spec says, but not from zero. Keep the
question bank, the syllabus taxonomy, the brand assets, the Supabase project
and the Cloudflare deploy. Replace the app, the data model and the
learning-engine package.

## 2. Current KAIRO repo

| Item | Finding |
| --- | --- |
| Stack | React 19, Vite 8, TypeScript, React Router 7, supabase-js, KaTeX. Deployed with Cloudflare Workers static assets (`wrangler.jsonc`), not Pages. |
| Size | About 21,600 lines of TypeScript in `kairo-app/src`, plus the `kairo-learning-engine` JS package (55 modules covering a knowledge graph, decay model, emotional profile, re-engagement, comms and more). `kairoEngine.ts` alone is 2,968 lines. |
| Scope | Much wider than spec v1: planner, Kai AI mentor, Arena, community quiz creation, follows, likes, comments, divisions, badges and a mistake "sandbox". Most of it is listed as v2 or "later" in the new spec. |
| Tests | 162 engine unit tests pass. There are no tests for the React app or for marking against the database. |
| Offline | `LocalStore` (IndexedDB) and `SyncManager` exist, but `public/sw.js` is a no-op passthrough, so a cold start with no signal shows nothing. |
| Bundle | `index.js` is 1.83 MB raw / 365 KB gzipped; `MathText` (KaTeX) is 78 KB gzipped. Budget is 150 KB. |
| Push | Its own VAPID web push (`kairo.push_subscriptions`, `send-push-notifications`). This runs separately from TECHMED's OneSignal. |
| Migrations | 59 files in `supabase/migrations`, mirrored by hand. The README says the full history predates the folder, so the schema can't be rebuilt from git. |

**Worth keeping:** the question bank (after cleaning), the syllabus topic lists
and CHECK constraints (`supabase/TAXONOMY.md`), brand assets and colour tokens
(`public/assets`, `src/styles/colors.css`), `MathText`'s handling of math
delimiters, the Google OAuth redirect fixes (recent commits `fb15563` and
`537ccb5`), and the wrangler deploy setup.

**Not worth carrying into v1:** `kairo-learning-engine`, the 120-column
`kairo.students` table, client-calculated points, and the Arena and community
features.

## 3. Data model gaps against spec v1

| Spec requirement | Current state |
| --- | --- |
| Attempt = one sitting, with a client UUID as its primary key (idempotent sync) | `kairo.attempts` stores one row per answer with a bigint id. There is no sitting record and no client UUID, so a re-sent batch creates duplicates. |
| Answers point at a fixed question version | No versioning. Editing a question changes past results. |
| Ranked answer keys hidden until submit | RLS policy "Authenticated read questions" (`USING true`) lets any signed-in user read `correct_option` for every question. |
| Server is the source of truth for marking | The client marks, and the client writes `correct` and points. |
| Leaderboards as views over attempts | `rankings_snapshot` and the `arena_*` columns are written by the client and RPCs. |
| Review workflow draft → reviewed → published → retired | `lifecycle_state` holds `live` or `imported`. There is no reviewer or audit trail. |

## 4. Question bank quality

Source table: `kairo.questions`. Options are stored as a JSON array of
`{label, text, isCorrect}` plus `correct_option`.

| Subject | Total | State | Years | Notes |
| --- | --- | --- | --- | --- |
| Biology | 1,264 | live | 2001–2025 | 50 have images; 2 have duplicate option text |
| Chemistry | 1,268 | live | 1983–2025 | 44 don't have exactly 4 options; 4 have an unusual key value; 12 duplicate stems |
| Mathematics | 921 | live | 2000–2025 | 10 have duplicate options; 107 duplicate stems |
| Physics | 873 | live | 2000–2025 | 3 have duplicate options |
| Use of English | 2,575 | 355 live, 2,220 imported | 2000–2024 | 60 have duplicate options; about 306 duplicate stems; 5 very short stems |

- `isCorrect` and `correct_option` agree on every row (0 mismatches), and no
  explanations are empty.
- **Superscripts and fractions were lost during import.** Examples:
  `physics_0543` (options "kg m" / "kg m"), `physics_0544` ("ML" / "ML"),
  `mathematics_0532` (two options are just "x"). The duplicate-option check
  only catches cases where the truncated options happen to match, so the real
  number is higher. This needs a targeted rescan against the source JSON, or a
  manual pass on Physics, Chemistry and Mathematics.
- The explanations exist but haven't been quality-checked against the house
  style ("names the trap").
- The original JAMB 2000–2025 JSON is not in the repo. Only four sample banks
  of 200 questions each are under `kairo-learning-engine/content/`. Locating
  the source JSON is a Phase 2 dependency.

**Plan:** import from `kairo.questions` into the new schema as `draft`, run the
spec §7 validators, auto-publish rows that pass every check and match the
source, and send the rest to the review queue.

## 5. TECHMED website

| Item | Finding |
| --- | --- |
| Stack | Astro 5 on Cloudflare (`@astrojs/cloudflare`), Sanity for content, Supabase for auth, payments (Paystack), entitlements and the library. |
| Auth | The same Supabase project, email plus Google. Students already have accounts here. |
| Quizzes | `QuizHub.astro` lists quizzes from Sanity. Most open on QuizBoot, and one card is "Kairo — TECHMED CBT". |
| Push | OneSignal (`OneSignalSDKWorker.js`, `notify-push` function, pg_cron jobs `techmed-push-*`). This is where the engaged audience's push subscriptions are. |
| Admin | `public.is_admin()` checks the `public.admin_users` table. That is sound, and it is separate from KAIRO's `students.is_admin`. |

## 6. Security findings in the live project

| Severity | Finding | Fix |
| --- | --- | --- |
| High | `kairo.award_arena_points(student_id, amount)` is SECURITY DEFINER and executable by every signed-in user. Anyone can add up to 5,000 points per call to any student, with no limit on calls. | `REVOKE EXECUTE ... FROM authenticated, anon` |
| High | `kairo.students` "Update own student row" has no column limits, and `authenticated` has UPDATE on `is_admin`, `kairo_points`, `is_official_account` and similar columns. A student can make themselves a KAIRO admin and create or edit challenges. Payments are **not** affected, because they use `public.admin_users`. | Revoke column UPDATE and INSERT on the privileged columns |
| Medium | All `kairo.questions` columns, including answer keys, are readable by any signed-in user. | Fixed by design in the new schema; low risk for the legacy app |
| Medium | About 290 SECURITY DEFINER functions can be called by `anon` or `authenticated` across both schemas. | Review per function; the new schema exposes only a deliberate list |
| Low | `public.university_aliases` has RLS off; leaked-password protection is off; `pg_net` is in the public schema. | Dashboard toggles and one migration |

Exploitation check on 17 Nov: 0 students have `is_admin`, the maximum points
balance is 734 and nobody is above 20k, so there is no sign of abuse.

## 7. Infrastructure and free tier

- One Supabase project serves TECHMED and KAIRO. Database size is 120 MB.
  pg_cron and pg_net are already used for 8 jobs.
- Existing cron jobs include `jambquest-*` (schema `scholarsdome`),
  `techmed-push-*` and `kairo-lifecycle-emails`. The 6 AM KAIRO jobs must not
  collide with `jambquest-auto-motivation` at 06:00 UTC.
- Free-tier limits to confirm in the Supabase dashboard (they change):
  500 MB database, 5 GB egress a month, 500k Edge Function calls a month,
  50k monthly active users. At 100–400 active students the main pressure is
  egress from question downloads, which offline packs and caching reduce.
  Check which plan the project is on now.
- Cloudflare Workers static assets are free for this traffic.

## 8. Open questions answered by the audit

| Spec §15 question | Answer |
| --- | --- |
| techmedng.com stack and login | Astro on Cloudflare plus the same Supabase Auth project, so shared accounts. |
| Current KAIRO stack; anything worth keeping | React/Vite/Supabase/Cloudflare. Keep the content, taxonomy, brand and deploy (§2). |
| JAMB JSON schema; explanation coverage | The loaded bank has 100% explanation coverage. The source JSON still has to be located. |
| Migrate QuizBoot history? | Recommendation: start fresh. QuizBoot stays readable and can be exported later if needed. |
| Daily quiz size | The current QuizBoot daily quiz is 10 questions in 10 minutes, created about 05:34 WAT. Keep that format. |
| Weekly drill size and day | Current weekly CBT is 40 questions in 30 minutes, released on Saturdays. Keep that format. |
| Phone login | Not needed for v1. Email plus Google is already what TECHMED uses. |
