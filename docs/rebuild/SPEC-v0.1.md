# KAIRO Reimagined — Product & Technical Spec

Nov 17, 2026 · @Wisdom Johnson · Draft v0.1

## 1. Overview

KAIRO is being rebuilt from scratch as TECHMED's fast, offline-capable, mobile-first CBT and assessment platform, replacing QuizBoot and feeding results into the techmedng.com student dashboard. The first version is retired rather than patched: students complained about usability and reliability, and fixing it had become slower than rebuilding.

**Product principle:** the assessment engine is the foundation. Question bank, timing, answer recording and marking must be correct before leaderboards, rewards or referrals are built on top.

### Goals for v1

1. **Reliable daily habit** — the 6:00 AM daily quiz is live every day without manual work, and every attempt is recorded and visible on TECHMED.
2. **Fast on cheap Android phones** — a question screen is usable within 2 seconds on a 3G connection.
3. **Works offline** — a student can download a practice set, attempt it with no signal, and have it sync later with nothing lost or duplicated.
4. **Trustworthy content** — every question has a verified answer key and explanation before it is published.
5. **Free and cheap to run** — runs on free tiers for the first 50–100 active students, with a clear path to scale.

### Success metrics (first 8 weeks after launch)

| Metric | Target |
| --- | --- |
| Daily quiz published on time | 100% of days |
| Attempts lost or duplicated in sync | 0 |
| Daily quiz participation | Higher than the current QuizBoot baseline (baseline to be pulled before launch) |
| Share of sign-ups who complete a first attempt | 70%+ |
| Student-reported bugs per week | Falling week on week |
| Monthly infrastructure cost | ₦0 on free tiers at 100 active students |

The brand name is **KAIRO** throughout code, UI and communications.

## 2. Users and core journeys

KAIRO serves three roles; v1 is built for the student first and gives staff only the tools needed to run daily content.

| Role | Who | What they do in KAIRO |
| --- | --- | --- |
| Student | Nigerian UTME candidates, mostly on Android phones with patchy data | Practise, take quizzes and mocks, see results and rankings |
| Editor | TECHMED content team | Add, import, review and fix questions; build quizzes |
| Admin | Wisdom Johnson and trusted staff | Schedule assessments, manage students, rewards, settings |

### Journeys v1 must make effortless

1. **Daily quiz:** push alert at 6:00 AM → tap → signed in already → quiz starts in one tap → submit → score, explanations and rank → result appears on the TECHMED dashboard.
2. **Offline practice:** pick subject and topic → download pack on Wi‑Fi or data → practise later with no signal → app syncs when back online → "Synced" tick shows.
3. **Full mock:** choose 4 subjects → timed UTME-format exam → auto-submit at time-up → subject scores, topic breakdown and review.
4. **First visit:** open link from WhatsApp or Telegram → sign up in under a minute → straight into a short starter quiz, not an empty dashboard.
5. **Editor:** import or write questions → review queue → publish → schedule tomorrow's quiz.

## 3. Scope

v1 ships the assessment engine, question bank, daily quiz automation, offline practice and TECHMED results sync; engagement features follow once those are stable.

| Area | v1 (launch) | v2 (after stable launch) | Later |
| --- | --- | --- | --- |
| Assessment | Practice, topic tests, daily quiz, weekly drill, full UTME mock | Competitions with entry windows | Adaptive practice |
| Question bank | JAMB 2000–2025 import, review workflow, versioning, student reports | Difficulty stats per question | Post-UTME banks per school |
| Offline | Installable PWA, downloadable packs, offline attempts, safe sync | Offline mocks | — |
| Student | Home, history, results review, topic performance, streak | Full analytics, achievements | Study planner link-up |
| Ranking | Daily quiz leaderboard, weekly leaderboard | Overall and competition boards | School and state boards |
| Growth | — | Referral programme, rewards | Cash/prize payouts |
| Integration | Single sign-in, results to techmedng.com dashboard | Weekly PDF report data | — |
| Admin | Question CRUD, import, scheduler, student lookup | Analytics dashboard | Multi-editor permissions |

**Non-goals for v1:** payments or paid tiers, live proctoring or webcam monitoring, native Android/iOS apps (the PWA covers install), essay or free-text marking, chat or community features, e-books and class content (these stay on TECHMED).

## 4. Architecture and stack

Recommended: a React PWA on Cloudflare Pages talking to Supabase (Postgres, Auth, Edge Functions, scheduled jobs), with IndexedDB on the phone for offline work. All of it runs on free tiers at 50–100 active students. This is a proposal to confirm after the repository audit in Phase 0, not a decision made blind.

&#91;embedded content: KAIRO architecture · phone, Supabase, connected services\]

Attempts are saved on the phone first and synced to Edge Functions, which re-mark them and send results to techmedng.com; pg\_cron publishes the daily quiz and triggers the OneSignal alert.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, built as a PWA | Small bundle, huge hiring pool, works well with AI-assisted coding |
| Offline | Service worker (Workbox) + IndexedDB (Dexie) | Caches the app shell and stores packs, attempts and an outbox |
| Maths/chemistry | KaTeX | Fast, offline formula rendering |
| Hosting | Cloudflare Pages on kairo.techmedng.com | Free, global CDN, fast in Lagos |
| Database | Supabase Postgres with row-level security | Relational data suits attempts and rankings; RLS keeps students to their own data |
| Auth | Supabase Auth (email + Google sign-in) | Free; SMS OTP costs money per message |
| Server logic | Supabase Edge Functions | Marking, sync endpoint, TECHMED webhook |
| Scheduling | pg\_cron in Postgres | Publishes the 6:00 AM quiz with no external service |
| Push alerts | OneSignal (existing TECHMED app) | Already set up; free tier |
| Errors | Sentry free tier | See real crashes on students' phones |
| Code | Existing GitHub repo, new branch for the rebuild | Keeps history; old app stays live until cutover |

**Key rule:** the server is the source of truth for marking and rankings. The phone marks instantly for feedback, and the server re-marks every attempt it receives.

Free-tier limits change; check current Supabase and Cloudflare limits at Phase 0 and note them here.

## 5. Data model

Ten core tables cover v1. Every attempt stores per-question answers and topic links, so analytics and leaderboards never run on blank pedagogical fields.

| Table | Purpose | Key fields |
| --- | --- | --- |
| profiles | One row per student or staff member | id (= auth user), full\_name, phone, email, role, techmed\_id, exam\_year, subjects\[\], referral\_code, created\_at |
| subjects | UTME subjects | id, name, code |
| topics | Syllabus topics per subject | id, subject\_id, name, parent\_topic\_id |
| questions | The question bank | id, subject\_id, topic\_id, year, source, stem, options (A–D), correct\_option, explanation, media\_url, difficulty, status (draft/reviewed/published/retired), version |
| assessments | Any quiz, drill, mock or test | id, type, title, time\_limit\_sec, question\_count, opens\_at, closes\_at, attempts\_allowed, shuffle, show\_answers\_after, ranked, status |
| assessment\_questions | Questions in an assessment | assessment\_id, question\_id, question\_version, position |
| attempts | One sitting by one student | id (UUID made on the phone), user\_id, assessment\_id, started\_at, submitted\_at, duration\_sec, score, total, origin (online/offline), device\_id, server\_received\_at, status |
| attempt\_answers | One answer within an attempt | attempt\_id, question\_id, question\_version, selected\_option, is\_correct, time\_ms, flagged |
| topic\_stats | Running mastery per student per topic | user\_id, topic\_id, attempted, correct, last\_attempt\_at |
| question\_reports | Student-flagged errors | id, question\_id, user\_id, reason, note, status |

v2 adds achievements, user\_achievements, referrals (referrer\_id, referee\_id, status, qualified\_at) and competitions. Leaderboards are Postgres views over attempts, not a separate table that can drift.

**Constraints that prevent bad data:** attempts.id is the primary key, so a re-sent attempt can never create a duplicate. A unique index on (user\_id, assessment\_id) applies where attempts\_allowed = 1. Answers point at a fixed question\_version, so editing a question never changes old results.

## 6. Assessment engine

One engine runs every assessment type; each type is a set of rules (timing, attempts, feedback, ranking), not separate code.

| Type | Timing | Attempts | Feedback | Ranked | Offline |
| --- | --- | --- | --- | --- | --- |
| Practice | Untimed | Unlimited | After each question | No | Yes |
| Topic test | Timed, set per test | Unlimited | After submit | No | Yes |
| Daily quiz | Timed; open 6:00 AM to closing time | 1 | After submit | Yes | Start online only |
| Weekly drill | Timed | 1 ranked, then practice | After submit | Yes | Start online only |
| Full mock | 2 hours, 180 questions (English 60 + 3 × 40) | Unlimited | After submit | Optional | v2 |
| Competition (v2) | Fixed window | 1 | After window closes | Yes | No |

### Attempt lifecycle

1. **Start** — create the attempt with a UUID on the phone; save it to IndexedDB before showing question 1.
2. **Answer** — every tap is saved locally at once; online attempts also send answers to the server every few questions.
3. **Navigate** — question palette shows answered, unanswered and flagged; jump to any question.
4. **Submit** — by the student, or automatically at time-up; a confirm step lists unanswered questions.
5. **Mark** — phone marks for instant results; server re-marks on receipt and its score is final.
6. **Review** — correct answer, the student's choice and the explanation for every question.

### Rules that keep it trustworthy

- **Timer:** the server sets the deadline for online attempts; a refresh or app close does not reset it. Offline attempts use elapsed time, not the phone clock.
- **Resume:** closing the app mid-attempt resumes on reopen, with the timer still running for timed types.
- **Answer keys:** for ranked assessments, keys are fetched only after submit. Practice packs carry keys on the phone so offline marking works.
- **Shuffling:** option and question order can be shuffled per student; stored positions map back to the canonical answer.
- **Ties:** rank by score, then shorter duration, then earlier submit.

## 7. Question bank and content pipeline

No question reaches a student until it passes import validation and a human review; the JAMB 2000–2025 JSON collection is the seed.

### Import of the JAMB JSON

1. Map the JSON fields to the questions table (subject, year, stem, options, answer, explanation, images).
2. Validate automatically: exactly one correct option, 4 options present, no empty stem, answer letter matches an option.
3. Detect duplicates across years by normalised stem text.
4. Tag each question to a syllabus topic (script suggests, editor confirms).
5. Flag questions missing explanations; they can be used in practice but not in ranked assessments until written.
6. Produce an import report: counts per subject and year, failures, duplicates, missing explanations.

### Presentation standard

Follows TECHMED's house style: numbered stem, lettered options A–D, a clear correct-answer mark in review, and an explanation paragraph that names the trap. Formulas render with KaTeX; diagrams are compressed images under 60 KB each.

### Review and versioning

- Status flow: draft → reviewed → published → retired. Only published questions can be added to assessments.
- Editing a published question creates a new version; past attempts keep the version they answered.
- Students can tap **Report this question**; reports land in an admin queue, and a question with 3+ open reports is pulled from live assessments automatically.
- The bank is reusable: one question can appear in many quizzes, drills and mocks.

## 8. Daily quiz automation

The daily quiz goes live at 6:00 AM WAT every day with no one awake to press a button, and staff are warned the evening before if nothing is queued.

1. **Queue ahead** — editors schedule quizzes days or weeks ahead in the admin calendar, or pick "auto-build" (random published questions by subject rotation and difficulty mix).
2. **Evening check** — at 8:00 PM a job checks tomorrow's slot; if empty, it alerts admins and, if still empty at 5:30 AM, auto-builds one.
3. **Publish** — pg\_cron flips the quiz to live at 05:00 UTC (6:00 AM WAT).
4. **Notify** — OneSignal push to all students: "Today's KAIRO quiz is live."
5. **Attempt** — students take it on KAIRO; one ranked attempt each.
6. **Close** — at closing time the quiz locks, the final leaderboard is frozen, and answers become visible to everyone.
7. **Report** — results flow to TECHMED dashboards (section 10) and a summary goes to admins: participants, average score, hardest question.

Weekly drills use the same pipeline on a fixed weekday and time, with a longer question set.

## 9. Offline and sync

An offline attempt is never lost and never counted twice: it lives on the phone until the server confirms it, and the server accepts each attempt ID only once.

### What works offline

- Opening the installed app (cached app shell).
- Downloading practice packs by subject, topic or year while online; roughly 1,000 text questions take about 2 MB.
- Practice and topic tests, with instant marking and explanations.
- History of attempts already on the phone.

Ranked assessments (daily quiz, weekly drill, competitions) must be started online so rankings stay fair; they can be finished through a short signal drop and submitted on reconnect.

### Sync design

1. Each finished attempt goes into an outbox in IndexedDB with its client-made UUID.
2. The app tries to send the outbox on reconnect, on app open, and on a timer with growing gaps between retries.
3. The server upserts by attempt ID: a repeat send returns "already received", never a second copy.
4. The server re-marks the attempt, updates topic\_stats, and replies with the official score.
5. Only then does the phone mark the attempt as synced. Nothing is deleted locally before that reply.
6. If the server rejects an attempt (for example, a second try at a one-attempt quiz), the phone keeps it as practice and tells the student why.

### What the student sees

Every attempt shows one of four states: **Saved on phone**, **Syncing**, **Synced** (tick) or **Not synced — tap to retry**. A banner shows when the app is offline, and a count shows how many attempts are waiting.

## 10. TECHMED integration

Students get one identity across techmedng.com and KAIRO, and every KAIRO result appears on their TECHMED dashboard (techmedng.com/dashboard) within a minute, with no manual export.

### Identity

The right approach depends on how techmedng.com handles accounts today, which the audit must confirm. In order of preference:

1. **Shared accounts** — both sites use the same Supabase Auth project; signing in on one signs in on the other.
2. **Signed hand-off** — techmedng.com issues a short-lived signed token when a student taps "Open KAIRO"; KAIRO verifies it and links the account by techmed\_id.
3. **Account linking** — separate logins, linked once by email or phone match. Fallback only.

### Results contract

- **Push:** when the server finalises an attempt, KAIRO sends a signed webhook to TECHMED with student id, assessment id and type, score, total, percentage, rank (if ranked), submitted time, and per-topic correct/attempted. Retries until TECHMED confirms.
- **Pull:** TECHMED can also fetch a student's results since a given time, for rebuilding its dashboard or weekly PDF reports.
- **Today's quiz:** TECHMED can fetch the live daily quiz title and link to show a "Take today's quiz" card.

KAIRO owns assessments, questions and attempts. TECHMED owns the wider student record, classes and subscriptions. Neither writes to the other's tables directly.

## 11. Student experience

Five bottom tabs, no tutorials needed: **Home, Practice, Tests, Ranks, Me**. Every screen is designed at 360 px wide first.

| Tab | What's on it |
| --- | --- |
| Home | Today's quiz card (with countdown), streak, last result, weakest 3 topics with a "Practise this" button |
| Practice | Subject → topic or year; download for offline; practice history |
| Tests | Daily quiz, weekly drill, mocks, topic tests; upcoming and past |
| Ranks | Daily and weekly leaderboards (v1); overall and competition (v2); your position always pinned |
| Me | Performance, achievements, referrals (v2), downloads, settings, sign out |

### Performance

Score trend over time, accuracy and attempt count per topic, average time per question, and mock scores by subject. Topic mastery needs at least 10 answered questions before it shows a label, so a single lucky quiz doesn't mislead.

### Leaderboards

Built from server-marked first attempts only. Each entry shows score and accuracy, so rankings reward learning, not just volume. Display names can be first name + last initial for privacy.

### Rewards and achievements (v2)

Start simple: daily streaks, a handful of badges (first mock, 7-day streak, 100 questions in a topic), and weekly top-3 recognition. Prize rewards are awarded manually by admins from leaderboard data until budget and rules are set.

### Referral programme (v2)

Each student gets a link and code. A referral counts only when the new student signs up and completes 3 attempts, which blocks fake sign-ups. Referrers see their count and status under Me.

## 12. Admin and content management

A separate /admin area, desktop-friendly, available to editors and admins only.

| Module | v1 capabilities |
| --- | --- |
| Questions | Search and filter by subject, topic, year, status; create, edit (new version), retire; bulk JSON/CSV import with report |
| Review queue | Approve or send back drafts; resolve student reports |
| Assessment builder | Pick questions manually or by rule (subject, topic, year, count, difficulty); set timing, attempts, ranking |
| Scheduler | Calendar of daily quizzes and weekly drills; empty-slot warnings |
| Students | Search by name, email or phone; see attempts and sync status; reset a stuck attempt |
| Insights | Daily participation, average scores, per-question % correct to spot bad or too-easy questions |
| Audit log | Who changed which question, assessment or setting, and when |

## 13. Non-functional requirements

These are pass/fail release criteria, tested on a low-end Android phone, not on a laptop.

| Area | Requirement |
| --- | --- |
| Speed | First load under 3 s on slow 3G; repeat load under 1 s from cache; next question under 100 ms |
| Size | Initial JavaScript under 150 KB gzipped; no heavy UI libraries |
| Reliability | Every answer saved locally within 100 ms of the tap; zero lost attempts in sync tests |
| Correctness | Marking covered by automated tests for every assessment type, shuffling and partial submissions |
| Security | Row-level security on every table; ranked answer keys never sent before submit; rate limits on sign-up and submit |
| Privacy | Collect only name, email, phone, exam year, subjects; follow the Nigeria Data Protection Act; students can request deletion |
| Backups | Automated daily database export to separate storage; restore tested once before launch |
| Accessibility | Base text 16 px+, WCAG AA contrast, large tap targets, works at 360 px, optional dark mode |
| Data use | Low-data mode: no images until tapped, packs downloaded only on request |
| Monitoring | Crash and error reporting; alert if the daily quiz fails to publish or sync error rate spikes |
| Maintainability | TypeScript throughout, one README for setup, database changes only through migrations |

## 14. Build phases

Eight phases, each built and tested in small steps; the first student-facing release is the daily quiz pilot in Phase 3, run alongside QuizBoot until it proves reliable.

&#91;embedded content: KAIRO build roadmap · 8 phases, each with a gate\]

The diamond under each phase is its gate: the next phase starts only when it passes.

### Exit criteria

- [ ] **Phase 0 — Audit:** current repo documented (what works, what's broken, what to keep); techmedng.com auth and stack known; open questions in section 15 answered; free-tier limits recorded.
- [ ] **Phase 1 — Foundation:** design tokens and core components built; sign-up and sign-in work on a low-end Android phone; database schema migrated; automatic deploys from GitHub.
- [ ] **Phase 2 — Assessment engine:** JAMB JSON imported with a clean report; all v1 assessment types run end to end; automated marking tests pass, including shuffling and time-up.
- [ ] **Phase 3 — Daily quiz pilot:** quiz publishes at 6:00 AM for 14 days straight with no manual action; push alerts go out; results match a manual check.
- [ ] **Phase 4 — Offline + sync:** app installs; packs download; airplane-mode tests, including closing the app mid-attempt and re-sending, show zero lost or duplicate attempts.
- [ ] **Phase 5 — TECHMED link:** one sign-in across both sites; every finalised attempt appears on techmedng.com/dashboard within a minute; failed webhooks retry and recover.
- [ ] **Phase 6 — Engagement:** leaderboards match server data in spot checks; streaks and badges award correctly; referrals qualify only after 3 attempts.
- [ ] **Phase 7 — Cutover:** two weeks of real students on KAIRO with no critical bugs; announcement sent on WhatsApp and Telegram; QuizBoot links redirected to KAIRO.

## 15. Open questions

These need an answer before or during Phase 0; each one changes what gets built.

- [ ] What stack and login system does techmedng.com use today? (Decides the identity approach in section 10.)
- [ ] What framework, database and hosting does the current KAIRO repo use, and is any of it worth keeping?
- [ ] What is the exact schema of the JAMB 2000–2025 JSON, and how many questions have explanations?
- [ ] Should historical QuizBoot results be migrated, or does KAIRO start fresh?
- [ ] When does the daily quiz close: 11:59 PM, or a shorter window?
- [ ] How many questions and minutes should the daily quiz and weekly drill have?
- [ ] Which weekday and time for the weekly drill?
- [ ] Should ranked quizzes be allowed fully offline, accepting weaker fairness?
- [ ] Who on the team reviews and approves questions?
- [ ] What is the reward budget, and are prizes cash, airtime or recognition?
- [ ] Sign-in method: email + Google is free; is phone-number login a must, given SMS costs?
- [ ] Launch target date, and should it line up with the Nov 30 paid classes start?
