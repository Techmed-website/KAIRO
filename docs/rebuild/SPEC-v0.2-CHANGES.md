# KAIRO Reimagined: Spec v0.2 Changes

17 Nov 2026 · Changes to `SPEC-v0.1.md` based on `PHASE-0-AUDIT.md`.
Items marked **[decide]** need Wisdom's sign-off.

## A. Architecture changes

### A1. Same Supabase project, new `cbt` schema
Build v1 in a new Postgres schema called `cbt` inside the existing project
`unbgborbhxzsotaieiun`. Leave the legacy `kairo` schema read-only until
cutover, then rename it `kairo_legacy`.
*Why:* shared accounts with techmedng.com come for free, there's no second
free-tier project to watch, and the old app keeps running untouched.

### A2. Marking and sync run as Postgres RPCs, not Edge Functions
Use `cbt.start_attempt()`, `cbt.submit_attempt(payload)`, `cbt.get_review()`
and `cbt.todays_quiz()` as SECURITY DEFINER functions with a fixed
search_path. Use Edge Functions only for calls to outside services
(OneSignal, email).
*Why:* no cold starts on 3G, a single transaction per submit (upsert attempt,
mark answers, update topic stats), less code, and nothing extra to deploy.
The server still marks every attempt; the logic just lives in SQL.

### A3. Replace the results webhook with a shared view (spec §10)
- **Push → RPC:** `cbt.my_results(since)` returns the caller's own
  finalised results (score, total, percentage, rank, per-topic
  correct/attempted). TECHMED's dashboard calls it with the student's own
  session. Results show as soon as they're finalised, with no retries or
  signing secret. It is a function rather than a view because rank has to
  be computed across every student's attempts, which an RLS view can't see.
- **Pull:** for weekly PDF reports, the same query run with the service
  role and a `since` filter.
- **Today's quiz:** the public RPC `cbt.todays_quiz()` returns the title,
  closing time and link.
- The ownership rule is unchanged: TECHMED reads KAIRO's views and never
  writes to KAIRO tables.

Updated Phase 5 gate: "every finalised attempt is visible on
techmedng.com/dashboard immediately". Webhook retry testing is dropped.

### A4. Push alerts go through TECHMED's existing OneSignal
Send the 6 AM "quiz is live" alert through the existing TECHMED OneSignal
app and `notify-push` pipeline, with a deep link to
`kairo.techmedng.com/q/today`. Retire KAIRO's separate VAPID push at
cutover. **[decide]** OneSignal web push is tied to one origin, so a
prompt shown on `kairo.techmedng.com` needs a second OneSignal web app.
v1 relies on subscribers students already have on techmedng.com.

### A5. Hosting
Cloudflare Workers static assets (what the repo already uses) instead of
Pages. Same price, same CDN. Add a staging subdomain such as
`next.kairo.techmedng.com` for the rebuild and switch over at cutover.

### A6. Render maths at import time
Render KaTeX to HTML when a question is imported or saved, and store it in
`stem_html` and the options' `html`. The student app ships only KaTeX CSS
and fonts (about 25 KB, cached), and the editor screen lazy-loads full
KaTeX for previews.
*Why:* the KaTeX JS bundle alone is 78 KB gzipped, more than half the
150 KB budget.

### A7. App placement
Put the new app at `apps/kairo` in this repo on the rebuild branch. Leave
`kairo-app` and `kairo-learning-engine` untouched until cutover, then
delete them.

## B. Product decisions (filled in from QuizBoot practice)

| Item | v0.2 value | Source |
| --- | --- | --- |
| Daily quiz | **10 questions, 5 minutes. Opens 06:00 WAT and never closes**, so a student who missed a day can go back to it. **Unranked**: it's for getting familiar with real JAMB questions, not a competition. Answers and explanations show **straight after submitting**. Retakes allowed; the first attempt is the one that counts for streaks and the TECHMED dashboard | Wisdom, 17 Nov |
| Daily quiz rotation | Physics, Mathematics, Use of English, Mixed Science, UTME Mix, Biology, Chemistry | QuizBoot days 1–7 |
| Weekly drill | 40 questions, 30 minutes, Saturday 08:00 WAT, closes Sunday 23:59 | Current weekly CBT challenge |
| Weekly drill tracks | Medical (English, Biology, Chemistry, Physics) and Engineering (English, Mathematics, Physics, Chemistry) | QuizBoot splits by track |
| Full mock | 180 questions (English 60 + 3 × 40), 2 hours | JAMB format, unchanged |
| Sign-in | Email + Google only | Same as TECHMED |
| History | Start fresh; no migration from QuizBoot or KAIRO legacy | 8 active legacy users |
| Ranked offline | Not allowed. Ranked quizzes must start online and can finish through a signal drop | Spec default; fairness |
| Daily quiz offline | Allowed. It's unranked, so the paper (with keys) can be downloaded and taken offline | Follows from the decision above |
| Ranked and rewarded | Weekly drill only (the daily quiz is unranked) | Assumption: confirm |

**Fix a contradiction in the spec: when do daily quiz answers show?**
§6 says "feedback after submit", but §8 says "answers become visible to
everyone" at closing time. If students see correct answers straight after
submitting, they can share them on WhatsApp before everyone else has taken
the quiz. v0.2: after submitting, show the score and which questions were
right or wrong; show correct answers and explanations after the quiz
closes. This is set per assessment as `answers_visibility`
(`per_question`, `after_submit` or `after_close`).
**Decided 17 Nov:** the daily quiz is unranked and never closes, so there's
nothing to protect. It uses `after_submit`. The weekly drill keeps
`after_close`.

**Track becomes a profile field.** Add `profiles.track`
(medical/engineering/other). It drives the weekly drill version and the
default subjects for mocks.

## C. Data model changes (spec §5)

- **profiles:** add `track`. Drop the separate `techmed_id`, because the auth
  user id is the shared id. Keep `role` here: `student`, `editor` or
  `admin`. Students can't change this column; only admins can.
- **questions:** add `stem_html`, `content_hash` (normalised stem, used to
  catch duplicates), `legacy_id` (for example `physics_0543`, for tracing)
  and `reviewed_by`/`reviewed_at`. Options become
  `jsonb [{key:'A', text, html}]`. The correct answer and explanation move
  to `question_keys`, a table students can't read, so the "keys never sent
  before submit" rule is enforced by the database, not by app code.
- **question_versions:** an immutable snapshot of each published version
  (stem, options, key, explanation). `attempt_answers` refers to
  `(question_id, version)`.
- **attempts:** add `seq_seed`, the seed used for shuffling, so the server
  can rebuild exactly what order the student saw.
- **audit_log:** promoted from admin v1 to a core table, filled by triggers.

The draft DDL is in `supabase/drafts/cbt_v1_schema.sql`. It is **not
applied**. It includes the core RPCs (`ensure_profile`, `get_paper`,
`start_attempt`, `submit_attempt`, `get_review`, `leaderboard`,
`my_results`, `todays_quiz`). `supabase/drafts/tests/run.sh` runs 28
behaviour checks against a throwaway Postgres: idempotent re-send,
server-side marking, keys hidden before start and before close, one ranked
attempt, rejecting ranked attempts that never started online, version
freezing, tie-breaks, and RLS isolation. All 28 pass.

## D. Security to fix before building

1. Apply the legacy fixes in the audit §6 (revoke `award_arena_points`, lock
   the privileged `students` columns), whether or not the rebuild goes ahead.
2. New schema rules: RLS on every table; no table grants to `anon`; RPCs
   granted to named roles only; `search_path` fixed on every function; a
   CI check that runs the Supabase security advisor and fails on new
   `cbt.*` findings.

## E. Phase plan changes

| Phase | Change |
| --- | --- |
| 0 Audit | Done apart from: locating the source JAMB JSON, confirming the Supabase plan, and these decisions. |
| 1 Foundation | Add: legacy security fixes and the `cbt` schema migration in git, applied through migrations only. |
| 2 Engine | Import from `kairo.questions`, not the raw JSON; add a rescan for lost superscripts. |
| 3 Pilot | Run alongside QuizBoot with the **same** 10 questions each morning, so participation and scores can be compared directly. |
| 5 TECHMED link | Smaller: a dashboard card that reads `cbt.my_results`, plus the "Take today's quiz" card. |

## F. Open questions remaining

- [ ] Where is the original JAMB 2000–2025 JSON (Drive? another repo)?
- [ ] Which Supabase plan is the project on (free or Pro)?
- [ ] Who reviews questions? Fixing the superscript problem in about 2,900
      science questions is roughly 2–4 editor-days.
- [ ] Reward budget: still open (v2).
- [ ] Launch date: should the Phase 3 pilot start before the 30 Nov paid
      classes, or launch alongside them?

## G. Decisions, 17 Nov (round 2)

### Done
- **Security holes closed on the live database.** Migration
  `20261117230000_close_students_privilege_and_points_holes`:
  `award_arena_points` revoked; `is_admin`, `is_official_account` and the
  creator/arena columns can no longer be written by students. Checked with
  a real student session: normal profile updates still work, and both holes
  are blocked.
- **Question bank received and profiled.** See `QUESTION-IMPORT-REPORT.md`.
  5,338 questions are ready today (source key, clean). Spec §7 changes:
  options can be 4 **or 5** (A–E) for papers before 2000, comprehension
  passages are stored once and shared, and every key records where it came
  from (`source`, `editor` or `ai_legacy`).

### Push notifications: install first, push second
What happened (70+ sent, 1 click, and Wisdom not seeing Chrome
notifications) is typical of Chrome web push on the phones Nigerian
students use. Tecno, Infinix, itel and Xiaomi kill Chrome in the background
to save battery, so pushes arrive late or not at all. The audience was also
only about 70 subscribers out of 356 active users. Plan:

1. **Install from day one.** The first-visit journey (spec §2, journey 4)
   ends on an install screen, not the dashboard. Android shows the native
   one-tap prompt (`beforeinstallprompt`); iPhone shows "Share → Add to
   Home Screen" instructions, because iOS only allows web push once the app
   is installed. The home-screen icon is itself a daily reminder, and the
   installed app's notifications carry the KAIRO name and icon instead of
   "Chrome". Measure: install rate, then push opt-in rate.
2. **KAIRO's own push subscription.** OneSignal web push is tied to one
   origin, so add a second (free) OneSignal web app for
   `kairo.techmedng.com` under the same account. TECHMED's existing app
   keeps sending to its own subscribers.
3. **Don't rely on push alone.** At 06:00, a free Telegram bot posts
   "Today's KAIRO quiz is live" with the link to the TECHMED Telegram
   channel, fully automated. WhatsApp Business API messages cost money per
   message, so the WhatsApp channel or community gets a manual forward
   (or one staff member pastes the same message).
4. **If installed-PWA push still doesn't get through:** wrap the same app
   as an Android app (Capacitor) with native FCM push, which these phone
   brands treat as a real app. Same codebase, about 3–5 days of work,
   distributed through the Play Store ($25 one-time fee) or as an APK on
   techmedng.com. This is a v2 option, decided by the pilot's numbers.

### Supabase plan: Pro is recommended, mainly for TECHMED
KAIRO itself fits the free plan. But this project also holds TECHMED's
paid orders and entitlements, and **the free plan has no automatic
backups** (Supabase's docs tell free projects to make their own). With paid
classes starting 30 Nov, a lost or corrupted database would be a business
problem, not just a KAIRO one. Pro ($25/month) adds daily backups kept for
7 days, removes the 500 MB read-only cliff and the 10 GB egress cap, and
the project is never paused. **Minimum if staying on free:** a nightly
`pg_dump` from GitHub Actions to off-site storage. This needs the database
password stored as a GitHub secret.

### Pilot before 30 Nov (13 days)
Scope is cut to the daily quiz only. Practice, mocks and offline packs
follow after 30 Nov.

| Dates | Work |
| --- | --- |
| 18–19 Nov | Apply the `cbt` schema; import the ready questions; generate and check explanations for the first 3 weeks of daily quizzes (about 210 questions) |
| 20–24 Nov | New app: shared TECHMED sign-in, install flow, daily quiz (10 questions, 5 minutes), result screen with explanations, history, report-a-question |
| 25–26 Nov | Daily quiz automation (pg_cron at 05:00 UTC, auto-build from the rotation, 20:00 empty-slot alert); KAIRO OneSignal app; Telegram bot |
| 27 Nov | Soft launch to a small group (staff and about 20 students) |
| 28–29 Nov | Fixes |
| 30 Nov | Open to everyone alongside paid classes; QuizBoot daily quiz continues in parallel for comparison |

### Still needed from Wisdom
- [ ] Re-run the 1978–2000 MySchool scraper for **2001–2025** (and 1996).
      It gives source keys, formatting, images and passages for the newer
      questions.
- [ ] The base URL for the diagram images, or the scraper itself, so the
      561 images can be downloaded and hosted.
- [ ] An Anthropic API key (or approval to use the existing one) to
      generate explanations for source-keyed questions.
- [ ] Confirm the daily quiz is unranked and the weekly drill is the
      rewarded, ranked one.
- [ ] Supabase: upgrade to Pro, or approve the nightly backup job.
- [ ] Telegram: the channel to post to, and a bot token (created with
      @BotFather and stored as a secret, not sent in chat).
