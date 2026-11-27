// First-party product analytics (cbt.events via cbt.track_events). Context only: practice, quizzes, mocks and answers
// are already recorded authoritatively by the server in cbt.attempts, so they are never re-sent from here.
//
// Rules this file keeps:
//   - never throws, never awaits on the student's path: track() only pushes to an in-memory queue
//   - batched (up to 20 events, flushed after 8 s, or when the app is hidden), at most one request in flight
//   - every event has a random id, so a resent batch is ignored by the server (no double counting)
//   - offline: the queue is kept in localStorage (max 200 events, max 3 days old) and sent when back online
//   - no question text, answers, names, emails or tokens in events; the server also allow-lists properties
//   - the exam runner (/cbt) and staff screens send nothing
import { supabase } from './supabase';
import { deviceId } from './sync';

export type EventName =
  | 'page_viewed' | 'user_login' | 'user_logout' | 'user_session_started'
  | 'answer_review_opened' | 'offline_pack_downloaded' | 'study_plan_saved' | 'search_performed' | 'share_clicked';

export type Feature =
  | 'home' | 'quiz_hub' | 'daily_quiz' | 'challenge' | 'practice_hub' | 'question_bank' | 'topic_practice' | 'year_practice'
  | 'custom_practice' | 'mock' | 'review_retry' | 'offline' | 'results' | 'leaderboard' | 'profile' | 'planner' | 'syllabus'
  | 'onboarding' | 'landing';

interface QueuedEvent {
  id: string; name: EventName; feature?: Feature; entity_id?: string; subject?: string; props?: Record<string, string | number | boolean>;
  session_id: string; anon_id: string; device: string; app_version: string; path?: string; client_at: string;
}

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const STORE = 'kairo-events';
const SESSION = 'kairo-analytics-session';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const APP_VERSION = '2.0';

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let token: string | null = null;
let started = false;

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
const uuid = () => safe(() => crypto.randomUUID(), `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

export function deviceCategory(width = safe(() => window.innerWidth, 400)): 'mobile' | 'tablet' | 'desktop' {
  return width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
}

/** The app session: a new one starts after 30 minutes without any event. Returns [id, isNew]. */
function session(now = Date.now()): [string, boolean] {
  const cur = safe(() => JSON.parse(localStorage.getItem(SESSION) || 'null') as { id: string; last: number } | null, null);
  const fresh = !cur || now - cur.last > SESSION_IDLE_MS;
  const id = fresh ? uuid() : cur!.id;
  safe(() => localStorage.setItem(SESSION, JSON.stringify({ id, last: now })), undefined);
  return [id, fresh];
}

function persist() {
  safe(() => localStorage.setItem(STORE, JSON.stringify(queue.slice(-200))), undefined);
}

function restore() {
  const cutoff = Date.now() - 3 * 864e5;
  const saved = safe(() => JSON.parse(localStorage.getItem(STORE) || '[]') as QueuedEvent[], []);
  queue = (Array.isArray(saved) ? saved : []).filter((e) => e && e.id && Date.parse(e.client_at) > cutoff).slice(-200);
}

/** Record one product event. Cheap and synchronous; delivery happens later in the background. */
export function track(name: EventName, fields: Omit<Partial<QueuedEvent>, 'id' | 'name' | 'session_id' | 'anon_id' | 'client_at'> = {}) {
  try {
    if (!started) start();
    const [sid, isNew] = session();
    const base = { session_id: sid, anon_id: deviceId(), device: deviceCategory(), app_version: APP_VERSION };
    if (isNew && name !== 'user_session_started') {
      queue.push({ id: uuid(), name: 'user_session_started', ...base, client_at: new Date().toISOString() });
    }
    queue.push({ ...base, ...fields, id: uuid(), name, client_at: new Date().toISOString() });
    if (queue.length > 200) queue = queue.slice(-200);
    schedule(queue.length >= 20 ? 0 : 8000);
  } catch { /* analytics never breaks the app */ }
}

function schedule(ms: number) {
  if (timer) { if (ms > 0) return; clearTimeout(timer); }
  timer = setTimeout(() => { timer = null; void flush(); }, ms);
}

async function send(batch: QueuedEvent[], keepalive: boolean): Promise<boolean> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/track_events`, {
    method: 'POST', keepalive,
    headers: { 'Content-Type': 'application/json', 'Content-Profile': 'cbt', apikey: KEY, Authorization: `Bearer ${token ?? KEY}` },
    body: JSON.stringify({ p_events: batch }),
  });
  // 4xx other than auth problems would fail forever: drop the batch rather than retrying it endlessly.
  return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429);
}

/** Send what is queued. `keepalive` is used when the app is being hidden or closed. */
export async function flush(keepalive = false): Promise<void> {
  if (inFlight || !queue.length) return;
  if (safe(() => !navigator.onLine, false)) { persist(); return; }
  inFlight = true;
  const batch = queue.slice(0, 20);
  try {
    if (!keepalive) token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    if (await send(batch, keepalive)) {
      const sent = new Set(batch.map((e) => e.id));
      queue = queue.filter((e) => !sent.has(e.id));
    }
  } catch { /* network: keep the batch and retry later */ }
  inFlight = false;
  persist();
  if (queue.length && !keepalive) schedule(queue.length >= 20 ? 1500 : 30000);
}

function start() {
  started = true;
  restore();
  safe(() => {
    supabase.auth.onAuthStateChange((_e, s) => { token = s?.access_token ?? null; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { persist(); void flush(true); } });
    window.addEventListener('online', () => schedule(1000));
  }, undefined);
  if (queue.length) schedule(3000);
}

// ───────────────────────── page views ─────────────────────────

/** Route → [pattern without ids, feature]. Routes that return null are not tracked (exam runner, staff screens). */
export function routeFeature(pathname: string): { path: string; feature: Feature; subject?: string; entity?: string } | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (/^\/(cbt|editor|founder)(\/|$)/.test(p)) return null;
  const m = (re: RegExp) => p.match(re);
  let r: RegExpMatchArray | null;
  if (p === '/') return { path: '/', feature: 'home' };
  if (p === '/quizzes' || p === '/daily') return { path: '/quizzes', feature: 'quiz_hub' };
  if ((r = m(/^\/(quiz|q)\/([^/]+)$/))) return { path: `/${r[1]}/:id`, feature: 'daily_quiz', entity: r[2] };
  if (p === '/practice') return { path: '/practice', feature: 'practice_hub' };
  if (p === '/practice/mixed') return { path: p, feature: 'custom_practice' };
  if (p === '/practice/mock') return { path: p, feature: 'mock' };
  if (p === '/practice/offline') return { path: p, feature: 'offline' };
  if ((r = m(/^\/practice\/([A-Za-z]{3})\/topics$/))) return { path: '/practice/:code/topics', feature: 'topic_practice', subject: r[1].toUpperCase() };
  if ((r = m(/^\/practice\/([A-Za-z]{3})\/years$/))) return { path: '/practice/:code/years', feature: 'year_practice', subject: r[1].toUpperCase() };
  if ((r = m(/^\/practice\/([A-Za-z]{3})$/))) return { path: '/practice/:code', feature: 'question_bank', subject: r[1].toUpperCase() };
  if ((r = m(/^\/(result|review)\/([^/]+)$/))) return { path: `/${r[1]}/:id`, feature: 'results', entity: r[2] };
  if (p === '/progress' || p === '/history') return { path: p, feature: 'results' };
  if (p === '/leaderboard') return { path: p, feature: 'leaderboard' };
  if ((r = m(/^\/rank\/([^/]+)$/))) return { path: '/rank/:id', feature: 'leaderboard', entity: r[1] };
  if (/^\/(profile|achievements)(\/|$)/.test(p)) return { path: p.startsWith('/achievements') ? '/achievements' : '/profile', feature: 'profile' };
  if (p === '/planner') return { path: p, feature: 'planner' };
  if (/^\/syllabus(\/|$)/.test(p)) return { path: '/syllabus', feature: 'syllabus' };
  if (/^\/(setup|tour|starter|install)$/.test(p)) return { path: p, feature: 'onboarding' };
  if (/^\/(welcome|signin)$/.test(p)) return { path: p, feature: 'landing' };
  return null;
}

let lastPath = ''; let lastAt = 0;
/** Called on every route change. Ignores immediate repeats (React strict mode, redirects). */
export function trackPage(pathname: string) {
  try {
    const now = Date.now();
    if (pathname === lastPath && now - lastAt < 2000) return;
    lastPath = pathname; lastAt = now;
    const r = routeFeature(pathname);
    if (!r) return;
    track('page_viewed', { feature: r.feature, path: r.path, subject: r.subject, entity_id: r.entity });
    if (r.path === '/review/:id') track('answer_review_opened', { feature: 'results', entity_id: r.entity });
  } catch { /* never */ }
}

/** Test hook. */
export const _internal = { get queue() { return queue; }, reset() { queue = []; lastPath = ''; lastAt = 0; started = true; } };
