// Founder Intelligence: typed calls to the admin-only cbt.fi_* RPCs. The server checks the admin role on every call;
// the client guard only keeps other people out of the screens.
import { cbt } from '../../lib/supabase';

export const RELAUNCH = '2026-11-24';
export const TZ = 'Africa/Lagos';

/** Today's date in Lagos as YYYY-MM-DD. */
export const lagosToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'relaunch' | 'custom';
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' }, { value: 'relaunch', label: 'Since relaunch' }, { value: 'custom', label: 'Custom' },
];
export interface Range { from: string; to: string; preset: Preset }

export function presetRange(p: Preset, today = lagosToday()): Range {
  switch (p) {
    case 'today': return { from: today, to: today, preset: p };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1), preset: p };
    case '7d': return { from: addDays(today, -6), to: today, preset: p };
    case '30d': return { from: addDays(today, -29), to: today, preset: p };
    default: return { from: RELAUNCH < today ? RELAUNCH : today, to: today, preset: p === 'custom' ? 'custom' : 'relaunch' };
  }
}

const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDay = (d: string) => dFmt.format(new Date(`${d}T12:00:00Z`));
export const fmtShortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
export const fmtRange = (r: { from: string; to: string }) => (r.from === r.to ? fmtDay(r.from) : `${fmtShortDay(r.from)} – ${fmtDay(r.to)}`);
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';
export const pct = (n: number | null | undefined, d: number | null | undefined) => (n == null || !d ? null : Math.round((1000 * n) / d) / 10);
export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-NG'));

// ───────────────────────── calls (with a short in-memory cache) ─────────────────────────
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
const TTL = 60_000;
async function rpc<T>(fn: string, args: Record<string, unknown>, fresh = false): Promise<T> {
  const key = fn + JSON.stringify(args);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = (async () => {
    const { data, error } = await cbt().rpc(fn, args);
    if (error) throw error;
    return data as T;
  })();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}
export const clearCache = () => cache.clear();

export interface Coverage { relaunch: string; attempts_since: string | null; profiles_since: string | null; events_since: string | null; today: string; generated_at: string }
export interface Kpis {
  registrations: number; active_users: number; dau_avg: number | null; dau_last: number | null; wau: number; mau: number;
  returning_users: number; new_active_users: number; questions: number;
  practice_started: number; practice_completed: number; practice_abandoned: number;
  quiz_started: number; quiz_completed: number; mock_started: number; mock_completed: number;
  guest_plays: number; guests: number; q_returning: number | null; q_first_time: number | null;
  n_returning_with_q: number; n_first_time_with_q: number;
}
export interface Overview {
  period: { from: string; to: string; days: number; prev_from: string; prev_to: string; grain: 'day' | 'week' };
  coverage: Coverage; current: Kpis; previous: Kpis; lifetime: { students: number; guests: number };
  series: { bucket: string; registrations: number; active: number; returning: number }[];
}
export interface FeedItem {
  at: string; kind: 'registered' | 'started' | 'completed' | 'opened' | 'event'; name: string; feature: string | null;
  subject: string | null; questions: number | null; student: string; student_name: string | null; user_id: string; props: Record<string, unknown>;
}
export interface Engagement {
  coverage: Coverage;
  daily: { day: string; dau: number; wau: number; mau: number; new: number; returning: number; questions: number }[];
  sessions: { sessions: number; users: number; per_user: number | null; avg_minutes: number | null; measured_sessions: number };
  summary: { active_users: number; active_days_per_user: number | null; engaged: number; questions_per_active: number | null; practice_started: number; practice_completed: number };
  cohorts: { cohort: string; size: number; d1: number | null; d7: number | null; d30: number | null; w7: number | null; d1_mature: boolean; d7_mature: boolean; d30_mature: boolean }[];
}
export interface FeatureRow {
  feature: string; label: string; primary_kind: 'attempt' | 'event' | 'view'; primary_event: string | null;
  users: number; opens: number; openers: number; starts: number | null; starters: number | null;
  completions: number | null; completers: number | null; abandoned: number | null; repeat_users: number; returned_users: number;
}
export interface Features { period: { from: string; to: string; prev_from: string; prev_to: string }; coverage: Coverage; current: FeatureRow[]; previous: FeatureRow[] }
export interface Funnel { window_days: number; immature: number; coverage: Coverage; stages: { key: string; label: string; n: number }[] }
export interface StudentRow {
  user_id: string; student: string; full_name: string | null; email: string | null; phone: string | null; exam_year: number | null; registered_at: string; last_active: string | null; last_seen: string | null; active_days: number;
  sessions: number | null; questions: number; practice_completed: number; quizzes_completed: number; mocks_completed: number;
  starts: number; completions: number; features: string[];
}
export interface StudentDetail {
  student: string; full_name: string | null; email: string | null; phone: string | null; registered_at: string; exam_year: number | null; subject_count: number;
  by_feature: { feature: string; starts: number; completed: number; questions: number }[];
  timeline: { at: string; kind: FeedItem['kind']; name: string | null; feature: string | null; subject: string | null; questions: number | null }[];
}

export interface GuestReport {
  guests_now: number; guests_played: number; guests_finished: number; guests_replayed: number;
  prompted: number; gated: number; converted: number; tracking_since: string | null;
}
export const getGuests = (r: Range, fresh = false) => rpc<GuestReport>('fi_guests', { p_from: r.from, p_to: r.to }, fresh);
export interface RefIntel {
  enabled: boolean; settings: { enabled: boolean; updated_at: string };
  thresholds: { code: string; title: string; goal: number }[];
  totals: { visits: number; unique_visitors: number; registrations: number; activated: number; retained: number; cohort_activated: number; cohort_retained: number;
            flagged: number; rejected: number; referrers: number; sharers: number };
  daily: { day: string; visits: number; registrations: number; activated: number }[];
  top_referrers: { user_id: string; student: string; name: string | null; email: string | null; phone: string | null; code: string; badge: string | null;
                   visits: number; registrations: number; activated: number; retained: number; flagged: number }[];
  badges: { code: string; title: string; goal: number; holders: number }[];
  awards: { at: string; badge: string; student: string; name: string | null }[];
  cohorts: { week: string; registrations: number; activated: number; retained: number }[];
  review: { referred_id: string; referred: string; referred_name: string | null; referrer: string; referrer_name: string | null; status: string; reason: string | null;
            source: string; created_at: string; activated: boolean }[];
  coverage: Coverage;
}
export const getRefIntel = (r: Range, fresh = false) => rpc<RefIntel>('fi_referrals', { p_from: r.from, p_to: r.to }, fresh);
export async function setReferralsEnabled(enabled: boolean) { const { error } = await cbt().rpc('fi_referral_set', { p_enabled: enabled }); if (error) throw error; clearCache(); }
export async function reviewReferral(id: string, status: 'valid' | 'rejected', reason?: string) {
  const { error } = await cbt().rpc('fi_referral_review', { p_referred: id, p_status: status, p_reason: reason ?? null }); if (error) throw error; clearCache();
}
export const getOverview = (r: Range, fresh = false) => rpc<Overview>('fi_overview', { p_from: r.from, p_to: r.to }, fresh);
export const getEngagement = (r: Range, fresh = false) => rpc<Engagement>('fi_engagement', { p_from: r.from, p_to: r.to }, fresh);
export const getFeatures = (r: Range, fresh = false) => rpc<Features>('fi_features', { p_from: r.from, p_to: r.to }, fresh);
export const getFunnel = (r: Range, windowDays: number, fresh = false) => rpc<Funnel>('fi_funnel', { p_from: r.from, p_to: r.to, p_window: windowDays }, fresh);
export const getFeed = (p: { before?: string | null; limit?: number; kinds?: string[] | null; feature?: string | null; from?: string | null; to?: string | null }) =>
  rpc<{ items: FeedItem[]; generated_at: string }>('fi_feed', {
    p_before: p.before ?? null, p_limit: p.limit ?? 50, p_kinds: p.kinds?.length ? p.kinds : null, p_feature: p.feature ?? null,
    p_from: p.from ?? null, p_to: p.to ?? null }, true);
export const getStudents = (segment: string, search: string, limit: number, offset: number) =>
  rpc<{ total: number; rows: StudentRow[]; coverage: Coverage }>('fi_students', { p_segment: segment, p_search: search || null, p_limit: limit, p_offset: offset });
export const getStudent = (id: string) => rpc<StudentDetail>('fi_student', { p_user: id });

// ───────────────────────── labels ─────────────────────────
export const FEATURE_LABEL: Record<string, string> = {
  home: 'Home', quiz_hub: 'Quizzes tab', daily_quiz: 'Daily Builder Quiz', challenge: 'Challenge', practice_hub: 'Practice hub',
  question_bank: 'Question bank', topic_practice: 'Topic practice', year_practice: 'Year practice', custom_practice: 'Custom practice',
  mock: 'JAMB mock', review_retry: 'Retry / review', offline: 'Offline packs', results: 'Results', leaderboard: 'Leaderboard',
  profile: 'Profile', planner: 'Study planner', syllabus: 'Syllabus', onboarding: 'Onboarding', landing: 'Welcome screen',
};
export const SUBJECT_LABEL: Record<string, string> = { ENG: 'English', MTH: 'Mathematics', PHY: 'Physics', CHM: 'Chemistry', BIO: 'Biology' };
const what = (f: string | null) => (f ? FEATURE_LABEL[f] ?? f : 'KAIRO');

/** One plain sentence per activity: "Student started Chemistry topic practice — 10 questions". */
export function describe(i: Pick<FeedItem, 'kind' | 'name' | 'feature' | 'subject' | 'questions' | 'props'>): string {
  const subj = i.subject ? `${SUBJECT_LABEL[i.subject] ?? i.subject} ` : '';
  const qs = i.questions ? ` — ${i.questions} question${i.questions === 1 ? '' : 's'}` : '';
  const feat = what(i.feature);
  const lower = feat.charAt(0).toLowerCase() + feat.slice(1);
  switch (i.kind) {
    case 'registered': return 'Joined KAIRO';
    case 'started': return `Started ${subj}${i.feature === 'daily_quiz' ? 'the Daily Builder Quiz' : i.feature === 'mock' ? 'a full JAMB mock' : lower}${qs}`;
    case 'completed': return `Completed ${subj}${i.feature === 'daily_quiz' ? 'the Daily Builder Quiz' : i.feature === 'mock' ? 'a full JAMB mock' : lower}${qs}`;
    case 'opened': return `Opened ${subj}${feat}`;
    default:
      switch (i.name) {
        case 'user_login': return 'Signed in';
        case 'user_logout': return 'Signed out';
        case 'answer_review_opened': return 'Opened answer review';
        case 'offline_pack_downloaded': return `Downloaded offline packs${i.props?.count ? ` (${i.props.count})` : ''}`;
        case 'study_plan_saved': return 'Updated their study plan';
        default: return (i.name ?? '').replace(/_/g, ' ');
      }
  }
}

/** The current segment as a CSV file (opens in Excel / Google Sheets) for follow-ups. Pages through the server 200 at a time. */
export async function exportStudentsCsv(segment: string, search: string, label: string) {
  const rows: StudentRow[] = [];
  for (let off = 0; off < 5000; off += 200) {
    const r = await getStudents(segment, search, 200, off);
    rows.push(...r.rows);
    if (rows.length >= r.total || r.rows.length < 200) break;
  }
  const head = ['Code', 'Name', 'Email', 'Phone', 'UTME year', 'Registered (Lagos)', 'Last active (Lagos)', 'Active days', 'Questions',
    'Practice completed', 'Quizzes completed', 'Mocks completed', 'Started', 'Completed', 'Features used'];
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { timeZone: TZ }) : '');
  const lines = [head, ...rows.map((r) => [r.student, r.full_name, r.email, r.phone, r.exam_year, when(r.registered_at), when(r.last_active),
    r.active_days, r.questions, r.practice_completed, r.quizzes_completed, r.mocks_completed, r.starts, r.completions,
    r.features.map((f) => FEATURE_LABEL[f] ?? f).join('; ')])].map((l) => l.map(cell).join(','));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kairo-students-${label}-${lagosToday()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return rows.length;
}
