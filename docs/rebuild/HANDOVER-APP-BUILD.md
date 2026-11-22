# KAIRO App Build: Handover

Written 18 Nov 2026 by the database/content session for the session that builds the KAIRO app.
Read this whole file before writing code. Supporting docs in the same folder: `SPEC-v0.1.md` (original
product spec), `SPEC-v0.2-CHANGES.md` (decisions since), `PHASE-0-AUDIT.md`, `QUESTION-IMPORT-REPORT.md`.

---

## 1. Mission in one paragraph

KAIRO is TECHMED's CBT practice platform for Nigerian UTME (JAMB) candidates, mostly on cheap Android
phones with expensive, patchy data. It must feel like the real JAMB CBT, but cleaner, faster and kinder,
and it must **teach why**: every review screen explains why the right answer is right **and why each
wrong option is wrong**, speaking directly to the student (the "TECHMED tutor" voice). Target: ready
before **20 Nov 2026**. Owner: Wisdom Johnson (TECHMED). Brand name in all code and UI: **KAIRO**.

## 2. What already exists (do not rebuild)

### Repo and branch
- Repo `drhigh350-lab/KAIRO`, branch `ccr-03fba2de-mk3oq7`. Build the new app at **`apps/kairo`**.
- `kairo-app/` and `kairo-learning-engine/` are the **old app**. Leave them untouched and do not reuse
  their UI. Wisdom wants a fresh, standard, organised, solid experience. Brand assets you may reuse:
  `kairo-app/public/assets/` (logo, mark, icons, TECHMED lockups) and colour ideas in
  `kairo-app/src/styles/colors.css`.
- **1,114 question diagrams** are already in `apps/kairo/public/qimg/*.webp` (6.9 MB, all ≤ 60 KB).
  Questions reference them as `media_url = '/qimg/<name>.webp'`, so they are served by the app itself
  (Cloudflare CDN, no Supabase bandwidth). Keep that folder in the app's `public/`.

### Supabase (shared with techmedng.com)
- Project `unbgborbhxzsotaieiun` (free plan). Same `auth.users` as techmedng.com, so a TECHMED account
  **is** a KAIRO account. Email + Google sign-in are already configured for TECHMED.
- All KAIRO v1 data lives in schema **`cbt`**. The legacy `kairo` schema belongs to the old app; don't
  write to it.
- Migrations are in `supabase/migrations/` (cbt ones start at `20261118000000`). Behaviour tests:
  `PGHOST=… PGPORT=… PGUSER=postgres supabase/drafts/tests/run.sh` (52 checks, plain Postgres 16 with a
  Supabase stub). Add tests for anything you add to the database.
- Database changes go through migration files **and** the Supabase MCP `apply_migration` tool. That
  tool asks Wisdom to approve DDL in the Claude app, so tell him before you call it so he's ready to tap
  approve (two calls timed out unanswered on 18 Nov).

### ⚠️ Pending on 18 Nov (check first)
1. **`20261118060000_cbt_practice_engine.sql` is NOT yet applied** (the approval prompt timed out). It
   adds `create_practice`, `catalog`, personal sessions and safe edits, and the app depends on it.
   Check: `select exists(select 1 from information_schema.columns where table_schema='cbt' and
   table_name='assessments' and column_name='personal')`. If false, apply the file unchanged (it passes
   the tests).
2. **`20261118990000_drop_cbt_temporary_loaders.sql`**: Wisdom has approved dropping the temporary
   import tools. Apply it after (1).
3. Wisdom must add **`cbt`** under Supabase → Settings → API → **Exposed schemas**, or supabase-js
   calls to `cbt` fail. Nothing else is needed before that.

### The question bank (live, 18 Nov)
| | ENG | CHM | BIO | PHY | MTH | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Published (students can practise) | 4,504 | 2,771 | 2,433 | 2,313 | 1,758 | **13,779** |
| Topic trusted (`topic_auto`) | 4,412 | 2,103 | 1,484 | 1,675 | 1,357 | 11,031 |
| With diagram (`media_url`) | – | 178 | 321 | 258 | 294 | 1,051 |
| With explanation | 1,157 | 868 | 864 | 472 | 432 | 3,793 |

- Years 1978–2025. **1996 does not exist in the source.** Papers before 2000 often have **5 options
  (A–E)**, so the UI must handle 4 or 5 options.
- **Answer keys are MySchool's, not JAMB's official keys**, so some are wrong. They were cross-checked
  against an independent key set and 353 conflicts are held back for an editor. Wrong keys will still
  slip through, so the **Report this question** flow is essential, not optional. (`key_source` values:
  `source` = MySchool, `ai_legacy` = earlier AI-solved key, `editor` = confirmed by TECHMED.)
- English comprehension questions carry `passage_html` (887 of them). Show the passage above the
  question, collapsible, and keep it pinned while the student moves between that passage's questions.
- **Explanation format** (`explanation_html`, plain text despite the name): the main explanation, then
  optionally a block that starts with the exact line `Why the other options are wrong:` followed by one
  line per option, e.g. `A: …`. Parse that block and show each line **under its option** in review.
  About 9,986 published questions have no explanation yet: show the correct answer and a gentle
  "Explanation coming soon. Report this question if you think the answer is wrong." Never show an empty
  box.
- Question text is **HTML from a third-party source** (`<sup>`, `<sub>`, `<em>`, `<br>`, `<p>`, tables)
  with LaTeX inside `\( … \)`. **Sanitize every HTML field with an allowlist** (DOMPurify: inline
  formatting, sup/sub, br, p, tables, img with relative `/qimg/` src only) before rendering, then render
  maths with KaTeX auto-render, **lazy-loaded only when the text contains `\(`**.

### Database API you call (supabase-js `supabase.schema('cbt').rpc(...)`)
| RPC | Purpose | Notes |
| --- | --- | --- |
| `ensure_profile(p_full_name?)` | Create/get the student's KAIRO profile | Call after sign-in. Profile fields you can update directly: `full_name, phone, track, exam_year, subjects` |
| `catalog()` | Menus: per subject, total count, counts by year, counts by trusted topic | Cache it (it changes rarely) |
| `create_practice(p)` | Build a personal session; returns `{assessment_id, question_count, time_limit_sec, title}` | `p.mode`: `year` `{subject, year}` · `topic` `{subject, topic_ids[], count?}` · `mixed` `{subjects:[{code,count}], years?:[from,to], topic_ids?}` · `mock` `{subjects:[3 codes besides ENG]}` (ENG 60 + 3×40, 7200 s). Optional `time_limit_sec`, `feedback: 'instant'|'end'` (mock is always end). Prefers unseen questions. Rate limit 60/hour |
| `start_attempt(p_attempt, p_assessment, p_device?)` | Start or resume; server sets `deadline_at` | `p_attempt` is a **UUID made on the phone** and saved locally first. Calling again resumes (timer not reset) |
| `get_paper(p_assessment)` | Questions in order: `id, version, position, stem_html, passage_html, options[{key,html}], subject, year, media_url, topic_id` (+ `correct_option, explanation_html` for practice, so instant feedback works offline) | Ranked papers never include keys |
| `submit_attempt(p)` | `{id, assessment_id, origin, started_at, submitted_at, duration_sec, device_id, answers:[{question_id, version, selected, time_ms, flagged}]}` → `{status, score, total, already_received, reject_reason}` | **Idempotent**: re-sending returns the stored result. The server marks; the client's view of correctness is ignored |
| `get_review(p_attempt)` | Per question: stem, options, selected, is_correct, and (when allowed) correct_option + explanation | |
| `leaderboard(p_assessment, p_limit?)` | Ranked attempts only: rank, display name (first name + initial), score, accuracy, duration, `is_me` | Tie-break: score, then shorter time, then earlier submit |
| `my_results(p_since?)` | The student's finalised results (for TECHMED's dashboard too) | |
| `todays_quiz()` | Daily quiz card | **Not used yet** (see §4) |
| Reports | `insert into cbt.question_reports (question_id, user_id, reason, note)`; reason ∈ `wrong_key, typo, unclear, missing_content, other` | RLS allows a student to insert their own report |

Tables a student can read directly (RLS-scoped): `subjects`, `topics`, own `profiles`, own `attempts`,
own `attempt_answers`, own `topic_stats`. Students cannot read `questions` or `question_keys`.

## 3. What to build for 20 Nov (priority order)

**P0, must ship**
1. **Sign-in** with the shared Supabase Auth (Google first, email + password second; no SMS). After
   sign-in, `ensure_profile`. Session persists so returning students land straight on Home.
2. **First-run flow (visit → first answered question in under 3 minutes, first full attempt in under
   10):** landing (one clear promise + "Start practising free") → sign in → three quick choices (exam
   year, the 4 UTME subjects with English fixed, optional target score) → a 3-step coach-mark tour
   (Practice, CBT controls, Review), skippable → a 10-question starter quiz from their subjects with
   instant feedback → result screen → **install prompt** (Android one-tap `beforeinstallprompt`; iPhone
   "Share → Add to Home Screen" sheet). Never drop a new student on an empty dashboard.
3. **Practice hub** per subject: **By year** (grid of years with question counts), **By topic** (JAMB
   syllabus topics with counts; multi-select), **Mixed** (pick subjects, questions per subject, years
   range, timed or untimed, instant or end feedback), **Full JAMB mock** (English + 3, 180 questions,
   2 hours). All of these call `create_practice`.
4. **The CBT screen** (the heart of the product, mirror JAMB CBT conventions):
   - Subject tabs across the top (in mixed/mock); question number and progress; a big, readable stem
     (16 px+), the passage panel for comprehension, the diagram (tap to zoom), options as large tap
     targets labelled A–E.
   - **Question drawer/palette**: slide-up sheet showing every question for the current subject as
     numbered chips (answered / unanswered / flagged / current), and switching subject tabs switches
     the palette. Jump anywhere.
   - **Flag** button and **calculator** button in consistent places (calculator: a simple on-screen
     scientific calculator in a bottom sheet; JAMB allows a basic calculator).
   - Timer (server deadline; counts down; warns at 5 min and 1 min; auto-submits at 0).
   - Previous / Next, and on a physical keyboard the JAMB shortcuts: **A–E** select, **N** next,
     **P** previous, **S** submit, **R** review/palette.
   - Submit confirmation listing unanswered and flagged counts per subject.
   - Every tap is saved to IndexedDB within 100 ms; closing the app and reopening resumes the attempt.
5. **Instant-feedback mode** (practice default): after choosing, show correct/incorrect at once, the
   explanation, and the per-option "why not" lines, with a "Next" button.
6. **Result screen**: score per subject **and the JAMB-style aggregate**. Show each subject out of
   **100** (`round(score/total*100)`) and the mock total out of **400**, plus percentage, time used,
   and accuracy by topic. Then **Review**: every question with the student's choice, the right answer,
   the explanation, and the "why the other options are wrong" lines under each wrong option, filterable
   by wrong / flagged / all.
7. **Report this question** on every question in review (and in instant feedback): reason chips + an
   optional note. Confirm with "Thanks, a TECHMED tutor will check it."
8. **History**: past attempts with score, date and "Review" / "Retry wrong ones".
9. **Installable PWA**: manifest, icons, and a Workbox service worker that caches the app shell and
   `/qimg/` images, so the app opens on a bad connection.

**P1, ship if time allows, otherwise right after**
- **Leaderboards**: per quiz (`leaderboard()` exists, for ranked assessments), plus **daily, weekly and
  overall** boards. The latter need new RPCs (e.g. sum of server-marked scores on ranked assessments
  over the window). Always pin the student's own row. Show score and accuracy, not just volume.
- **Performance page**: accuracy per subject and topic from `topic_stats` (show a mastery label only
  after ≥ 10 answered in a topic), score trend from `my_results`, weakest 3 topics with a "Practise
  this" button (calls `create_practice` mode `topic`).
- **Streak** (days with at least one finished attempt).
- **Retry wrong answers**: a mixed session from the student's own wrong answers (new RPC).

**Not now** (but keep the design ready): offline downloadable packs, the daily quiz and weekly drill
inside KAIRO (§4), admin/editor screens, referrals and rewards, the TECHMED dashboard results card.

## 4. The daily quiz stays on QuizBoot for now

TECHMED's Daily Builder Quiz runs on QuizBoot (day 8 on 18 Nov). **Do not build or schedule daily
quizzes in KAIRO yet.** When KAIRO is officially ready, Wisdom will move the quizzes, analytics and
track record from QuizBoot (a QuizBoot connector is available in Claude sessions) and KAIRO takes over.
The engine already supports it (`daily_quiz` type, `todays_quiz()`, a pg_cron job
`kairo-daily-quiz-publish` that makes scheduled quizzes live at 06:00 WAT, and the archived week-1
content in `content/daily-quiz/`). Daily rules when it moves: 10 questions, 5 minutes, opens 06:00 WAT,
never closes, answers right after submitting.

## 5. UX direction (what students want, what competitors miss)

From experience with Nigerian CBT apps (Test Driller, Exam Ninja, Myschool CBT, PrepClass and the
JAMB CBT practice software) and the patterns students praise or complain about in store reviews:

**Students love, so keep:** an interface that feels like the real JAMB CBT; clean question
presentation; a palette to jump between questions; a calculator; subject switching in mocks; scores in
JAMB terms (/100 per subject, /400 total); leaderboards that show where they stand; offline use; fast
start without long forms.

**Students complain about, so beat it:**
- **Explanations that only state the answer.** KAIRO's edge: explain why the right answer is right
  **and why each wrong option is wrong**, in a warm tutor voice speaking to the student ("You picked
  B. That's the formula for…, but here…").
- Wrong answer keys with no way to report them → one-tap reporting, visible fixes.
- Ads, paywalls before trying, activation codes → none in v1.
- Lost progress after a crash or call → local-first saving and resume.
- Heavy apps and data use → small bundle, images only when shown, low-data mode later.
- Cluttered, dated UI → one primary action per screen, generous spacing, calm colours.

**Design rules**
- Mobile first at **360 px wide**, thumb-reachable primary actions at the bottom, tap targets ≥ 44 px.
- Base text 16 px, question text 17–18 px, WCAG AA contrast, optional dark mode (exam at night).
- One visual system: tokens for colour, type, spacing, radius, elevation in one CSS file; a small set of
  components (Button, Card, Chip, Sheet, Tabs, ProgressRing, Toast). No heavy UI library.
- Correct = green with a ✓ icon, wrong = red with a ✗ icon (never colour alone), flagged = amber.
- Encouraging, never shaming copy. Celebrate streaks and personal bests; show "you improved in Organic
  Chemistry" rather than only raw scores.
- Speed budget: first load < 3 s on slow 3G, next question < 100 ms, initial JS < 150 KB gzipped
  (route-level code splitting; KaTeX and the calculator lazy-loaded).

## 6. KAIRO should understand each student over time

Build the data foundation now, even if the smart features come later:
- Every answer already records `time_ms`, `flagged`, `is_correct` and the question's `topic_id`, and
  `topic_stats` keeps running accuracy per topic. Send real `time_ms` per question from the client.
- `create_practice` already prefers **unseen** questions. Next steps, in order: weak-topic
  recommendations on Home → "retry your mistakes" sessions → spaced repetition of missed questions
  (resurface after 1, 3, 7 days) → predicted UTME score from mock performance → a personal daily plan
  linked to the TECHMED class timetable.
- Track simple behaviour signals (session length, time of day, drop-off points) in a lightweight
  `cbt.events` table when you need them; never collect more personal data than the spec allows
  (name, email, phone, exam year, subjects), per the Nigeria Data Protection Act.

## 7. Tech stack and structure

- **React + Vite + TypeScript** PWA in `apps/kairo` (React Router, supabase-js, Workbox via
  `vite-plugin-pwa`, Dexie for IndexedDB, DOMPurify, KaTeX auto-render lazy). Strict TypeScript.
- Deploy: **Cloudflare Workers static assets** (see `kairo-app/wrangler.jsonc` for the existing
  pattern; SPA fallback). Target domain `kairo.techmedng.com`; use a staging subdomain until cutover.
- Suggested folders: `src/app` (routes, shell), `src/features/{auth,onboarding,practice,cbt,review,history,profile,leaderboard}`,
  `src/lib/{supabase,db,sync,render}` (sanitize + KaTeX), `src/ui` (tokens + components).
- **Local-first attempts:** create the attempt UUID on the phone; keep the paper, answers and an
  outbox in IndexedDB; call `submit_attempt` when online; mark "Synced" only after the server replies;
  retry with back-off. Show one of: Saved on phone / Syncing / Synced ✓ / Not synced, tap to retry.
- Environment: `VITE_SUPABASE_URL=https://unbgborbhxzsotaieiun.supabase.co` and the project's
  publishable key (get it with the Supabase MCP `get_publishable_keys`). Never put a service key in
  the app.
- Tests: unit tests for scoring display (/100, /400), explanation parsing, sanitizing, the outbox; one
  Playwright run of sign-in → practice → submit → review at a 360 × 740 viewport.

## 8. Acceptance for 20 Nov

- [ ] A new student goes from the landing page to their first answered question in under 3 minutes, on
      a mid-range Android phone over 3G.
- [ ] Year, topic, mixed and full-mock sessions all start, run, submit, and show results + review.
- [ ] Mock shows each subject /100 and total /400; the timer auto-submits at zero.
- [ ] Closing the browser mid-attempt and reopening resumes with answers and timer intact.
- [ ] Review shows the explanation and per-option "why not" lines wherever they exist; questions
      without explanations show the correct answer and the report prompt.
- [ ] Report this question works and lands in `cbt.question_reports`.
- [ ] Diagrams, passages, 5-option questions and maths render correctly; no raw HTML or `\(` visible.
- [ ] Installable on Android, opens from the home screen, app shell loads offline.
- [ ] Initial JS < 150 KB gzipped; Lighthouse PWA and accessibility pass.

## 9. Working agreements

- Wisdom is on a Claude Pro subscription with no API key. Keep token use lean: read files in parts,
  don't paste large data into the chat, run data work as scripts, and don't re-derive what this
  handover already states.
- Commit to branch `ccr-03fba2de-mk3oq7` often and push; no PRs unless Wisdom asks.
- Ask Wisdom only for real decisions; otherwise choose sensible defaults and say so.
- Wisdom may share screenshots of a competitor app he likes (the reasoning behind its scoring, leaderboards,
  palette drawer, calculator and flag placement). Use them for inspiration, not copying.
