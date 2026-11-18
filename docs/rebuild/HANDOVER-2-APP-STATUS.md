# KAIRO App Build: Handover 2 (status at end of 18 Nov 2026)

For the next session building KAIRO. Read this first, then `HANDOVER-APP-BUILD.md` (the original brief, still the source of
truth for product rules). Keep token use lean: Wisdom is on Claude Pro with no API key and no budget for paid AI.

## 1. Where things are

- Repo `drhigh350-lab/KAIRO`, branch **`ccr-03fba2de-mk3oq7`**. The app is `apps/kairo` (React + Vite + TS PWA).
- **Staging: https://kairo-staging.techmedng.com**. Every push touching `apps/kairo/**` runs unit tests, builds and deploys
  (`.github/workflows/deploy-kairo-staging.yml`, Cloudflare Workers, repo secret `CLOUDFLARE_API_TOKEN`).
- Supabase project `unbgborbhxzsotaieiun`, schema `cbt` (exposed). Publishable key is in `apps/kairo/.env`.
- **Database changes:** the Supabase MCP `apply_migration` approval prompt never reaches Wisdom (timed out every time).
  Write the migration file + tests, then ask Wisdom to run the file in the Supabase SQL editor, then verify with
  `execute_sql`. Tests: `service postgresql start; su postgres -c "PGHOST=/var/run/postgresql bash supabase/drafts/tests/run.sh"`.

### Migrations
| File | Applied |
| --- | --- |
| `20261118060000_cbt_practice_engine` · `20261118990000_drop_cbt_temporary_loaders` | yes |
| `20261119000000_cbt_app_support` (retry wrong ones, richer review) | yes |
| `20261119010000_cbt_leaderboards` (keyless end-of-session papers) | yes |
| `20261119020000_cbt_leaderboard_scores` (board by score then time, /100–/400) | yes |
| `20261119030000_cbt_explanation_pipeline` (queue, save, key reviews, tries, resolve_key_review) | yes |
| **`20261119050000_cbt_review_and_predict`** (spaced review, create_review, my_mock_scores) | **NO: ask Wisdom to run it** |

## 2. What the app does now (all P0 + most P1)

Sign-in (email + password; Google parked, see §4), first-run setup → tour → 10-question starter → install prompt.
Practice: by year, by topic, mixed, full JAMB mock, **offline packs** (download, practise with no network, sync later).
CBT screen: subject tabs, palette sheet, flag, JAMB basic calculator (+ − × ÷ √ x² C CE), server timer with warnings and
auto-submit, A–E/N/P/S/R keys, IndexedDB resume. Instant feedback with per-option "why not" lines; TECHMED-format
explanations (Concept / Steps / Why not / TECHMED TIP). Results /100 per subject, /200–/400 totals. Review with filters,
report-this-question, history, retry wrong ones. **Ranks** tab: /400 /300 /200 /100 boards (score, then faster time),
today / week / all time, own row pinned. **Progress** page: score trend, weakest 3 topics + "Practise this", mastery by topic.
**Today** card on Home: spaced review due, weakest topic, predicted UTME score (needs migration 050000).
**Question desk** (`/editor`, editors/admins only; Wisdom is admin): key reviews, student reports, fix key/explanation.
Password reset screen. Light/dark/follow-phone. Maths (`$…$` and `\(…\)`) and chemistry subscripts render.

Wisdom's rules from this session: **functionality first, design polish later**; **no labels on explanations** (no
"AI-written"/"checked by" notes, only the report link); scores in JAMB terms; leaderboards rank score then time.

Checks that pass: `npm test` (17 unit), `npx vite --port 5199 & npm run e2e` (≈45 checks at 360×740, mocked Supabase),
axe accessibility clean on main screens, initial JS ≈119 KB gz (budget 150).

## 3. Explanation pipeline (`tools/explain`)

Writes TECHMED-method explanations and re-checks every answer key, for free, with Gemini.
- Workflow **"KAIRO explanations"** is on `main` (so GitHub shows Run workflow) and fetches the pipeline from this branch.
  Runs automatically **01:23, 07:23, 13:23, 19:23 UTC**, up to 100 questions each, writing to the live database.
- Secrets: `KAIRO_SUPABASE_KEY` (works, added 18 Nov late) is used before `SUPABASE_SERVICE_ROLE_KEY` (invalid, can't be
  edited: the GitHub account belongs to Wisdom's programmer). `GEMINI_API_KEY` works (free tier).
- Models tried in order: `gemini-3.8-flash, gemini-3.6-flash, gemini-3.5-flash`; busy (503) or out of quota → next model;
  all dry → the run stops and the next run continues. Lite models are excluded: on the pilot they wrote a false set-theory
  explanation and invented novel plot details.
- Safeguards: saved only if the model agrees with the key, every wrong option has a specific "why not", AND a second
  strict-editor call approves it; set-text (novel) questions and missing passages always go to editors; disagreements go to
  `cbt.key_reviews` (Question desk). Editor-written explanations are never overwritten.
- **Quality is not yet proven on the stronger models**: on 18 Nov they were overloaded (503) for the whole evening. An eval
  run was in progress at handover: Actions run 44420798263. Read its log first (`eval` prints ok/MISS per pilot question and
  how many unsafe saves). If it shows unsafe saves, set the schedule to dry runs until fixed.
- Pilot (hand-written in this session) is live: 4 explanations saved; 5 flagged questions were reviewed by Wisdom, keys
  confirmed (the 2 set-novel ones still need editor-written explanations).
- Run manually from GitHub (Actions → KAIRO explanations) or trigger via the GitHub MCP `actions_run_trigger`
  (`workflow_id: explain-questions.yml`, `ref: main`). Tests: `cd tools/explain && npm test` (20).

## 4. Open items

1. **Rankings Wisdom referred to** (from his competitor screenshots): e.g. "Your rank #59 of 430" on results, per-quiz
   leaderboard with subject-by-subject scores, podium of top performers. Start here in the next chat; ask him which.
2. Migration 050000 (above).
3. **Google sign-in** fails: Supabase's Google client secret is invalid (`invalid_client` in auth logs). Parked by Wisdom
   until hand-over to main. Email sign-in works.
4. Explanation quality on stronger free models (§3).
5. Deferred by Wisdom: TECHMED dashboard results card, daily quiz in KAIRO (stays on QuizBoot), referrals, design polish.
6. 3 questions with broken source maths (2 MTH unclosed `\(`, 1 "C0₂" typo) need an editor.
7. Fallback if GitHub secrets become a problem again: run the pipeline as a Supabase Edge Function on pg_cron (Supabase
   provides its own service key; Wisdom sets the Gemini key in Supabase). Not built.
