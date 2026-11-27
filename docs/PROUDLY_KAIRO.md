# PROUDLY KAIRO · Learn. Refer. Inspire.

Recognition-only referral programme (27 Nov 2026). **No cash, data, gift cards, prizes, commissions, balances or wallets.** Rewards are badges, visible status, leaderboards and monthly recognition. TECHMED's own referral/commission system is untouched.

## Architecture (reuse first)
| Need | Reused | New (additive) |
|---|---|---|
| Codes | `cbt.profiles.referral_code` (existing, was empty) — filled for all 97 signed-up students | `_ref_new_code`, `_ref_code_for` |
| Badges | `cbt.badges` + `cbt.user_badges` (existing achievement framework, earned once) | 6 rows, category `referral` |
| Activation | `cbt.attempts` + `cbt.attempt_answers` (server records) | — |
| Admin auth | `cbt._require_admin()`, `cbt._audit()` | `fi_referrals`, `fi_referral_set`, `fi_referral_review` |
| Push / email | OneSignal app "Kairo", Resend (`TECHMED_RESEND_API_KEY`, `auth.techmedng.com`), `notify_hook_secret`, `cbt.push_log` | Edge Function `kairo-referrals`, cron `kairo-referrals-tick` |
| Tables | — | `referral_settings`, `referral_visits`, `referrals`, `referral_notices` (RLS on, no client grants) |
| XP | `_xp_events` / `_xp_board` | referral badges excluded from XP (academic ranking unchanged); board rows carry a display-only `ref` |

Migrations: `20261127150000_cbt_proudly_kairo_referrals.sql`, `20261127150100_cbt_referral_tick_cron.sql`. Tests: `supabase/drafts/tests/23_referrals_test.sql`.

## Rules
- **Link**: `https://kairo.techmedng.com/r/<CODE>`; any page also accepts `?ref=<CODE>`. Codes: up to 5 letters of the first name + 4 unambiguous characters.
- **Attribution**: first touch on the phone (30 days), recorded by `claim_referral` once the student has a real account; the code also travels in sign-up metadata (`ref_code`) so email confirmation on another device still counts. One referral per student, never changed.
- **Genuinely new**: account ≤ 7 days old, not a guest, not the referrer, not circular. Same email (Gmail dots/+tags ignored) → rejected as self-referral. Same phone or same device as the referrer → **flagged**, not counted until the founder approves.
- **Activated**: friend finished a practice/quiz/mock with **10+ answered questions**, started after their account was created.
- **Retained**: after activating, the friend started learning again on a later Lagos day.
- **Badges** (activated referrals): Proud KAIRO User 1 · Advocate 3 · Ambassador 5 · Champion 10 · Legend 25 · Icon 50. Awarded server-side, inserted once, never revoked (threshold changes or rejections never remove a badge).
- **Pause**: founder can pause (new referrals not recorded; existing data and badges kept).

## Student experience
`/referrals` dashboard (code, link, WhatsApp/copy/native share, 4 explained metrics, current badge + progress, 6-badge collection, private journey history, enter-a-code for new accounts), `/ambassadors` board (podium, ranked list, your position, all-time / this month, monthly recognition), `/r/:code` invite landing, profile badge pill, academic leaderboard marker, achievements section, home and profile cards, result-screen prompt, one-time launch banner, one-time server-recorded celebration (never inside the exam runner).

## Notifications
- Badge earned → push (if subscribed) + email, once each (`referral_notices`), via the 10-minute tick.
- Launch announcement → push to all subscribed devices + personal email with each student's own link; guarded by `push_log` key `kairo:referral-launch` (can run once).

## Known limitations
- Device/phone duplicate detection is best-effort; a determined student with another phone and email can still create a second account (the 10-question activation and founder review limit the value).
- Attribution on a phone that blocks storage relies on sign-up metadata or the manual code.
- Emails have no automatic unsubscribe link (reply STOP is handled manually).
- Push reaches only devices that opted in (15 web subscribers on 27 Nov).
