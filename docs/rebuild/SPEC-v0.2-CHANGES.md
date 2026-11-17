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
| Daily quiz | 10 questions, 10 minutes, opens 06:00 WAT, closes 23:59 WAT | Current QuizBoot Daily Builder format |
| Daily quiz rotation | Physics, Mathematics, Use of English, Mixed Science, UTME Mix, Biology, Chemistry | QuizBoot days 1–7 |
| Weekly drill | 40 questions, 30 minutes, Saturday 08:00 WAT, closes Sunday 23:59 | Current weekly CBT challenge |
| Weekly drill tracks | Medical (English, Biology, Chemistry, Physics) and Engineering (English, Mathematics, Physics, Chemistry) | QuizBoot splits by track |
| Full mock | 180 questions (English 60 + 3 × 40), 2 hours | JAMB format, unchanged |
| Sign-in | Email + Google only | Same as TECHMED |
| History | Start fresh; no migration from QuizBoot or KAIRO legacy | 8 active legacy users |
| Ranked offline | Not allowed. Ranked quizzes must start online and can finish through a signal drop | Spec default; fairness |

**Fix a contradiction in the spec: when do daily quiz answers show?**
§6 says "feedback after submit", but §8 says "answers become visible to
everyone" at closing time. If students see correct answers straight after
submitting, they can share them on WhatsApp before everyone else has taken
the quiz. v0.2: after submitting, show the score and which questions were
right or wrong; show correct answers and explanations after the quiz
closes. This is set per assessment as `answers_visibility`
(`per_question`, `after_submit` or `after_close`). **[decide]**

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
