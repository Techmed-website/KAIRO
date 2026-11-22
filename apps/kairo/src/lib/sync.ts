import { db } from './db';
import { cbt } from './supabase';
import type { LocalAttempt } from './types';

const listeners = new Set<() => void>();
export const onSyncChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((f) => f());

export function buildPayload(a: LocalAttempt, questions: { id: string; version: number }[]) {
  return {
    id: a.id, assessment_id: a.assessment_id, origin: a.origin ?? 'online',
    started_at: a.started_at, submitted_at: a.submitted_at, duration_sec: a.duration_sec,
    device_id: deviceId(),
    answers: questions.map((q) => {
      const ans = a.answers[q.id];
      return { question_id: q.id, version: q.version, selected: ans?.selected ?? null,
               time_ms: Math.round(ans?.time_ms ?? 0), flagged: !!ans?.flagged };
    }),
  };
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('kairo-device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kairo-device', id); }
    return id;
  } catch { return 'unknown'; }
}

/** Queue a submitted attempt and try to send it now. */
export async function enqueueSubmit(a: LocalAttempt, questions: { id: string; version: number }[]) {
  await db.outbox.put({ id: a.id, payload: buildPayload(a, questions), tries: 0, next_at: 0 });
  return flushOutbox();
}

let flushing: Promise<void> | null = null;
/** Send every due item. Idempotent on the server, so re-sending is safe. Back-off: 5 s, 15 s, 45 s … max 10 min. */
export function flushOutbox(force = false): Promise<void> {
  flushing ??= (async () => {
    try {
      const now = Date.now();
      const items = await db.outbox.toArray();
      for (const item of items) {
        if (!force && item.next_at > now) continue;
        if (!navigator.onLine) break;
        await db.attempts.update(item.id, { sync: 'syncing' }); emit();
        const { data, error } = await cbt().rpc('submit_attempt', { p: item.payload });
        if (error) {
          const tries = item.tries + 1;
          await db.outbox.update(item.id, { tries, next_at: Date.now() + Math.min(600_000, 5000 * 3 ** (tries - 1)) });
          await db.attempts.update(item.id, { sync: 'failed' });
        } else {
          const r = data as { status: string; score: number; total: number; reject_reason: string | null };
          await db.transaction('rw', db.attempts, db.outbox, async () => {
            await db.attempts.update(item.id, { sync: 'synced', server: r });
            await db.outbox.delete(item.id);
          });
        }
        emit();
      }
    } finally { flushing = null; }
  })();
  return flushing;
}

export function startSyncLoop() {
  window.addEventListener('online', () => flushOutbox(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushOutbox(); });
  setInterval(() => flushOutbox(), 20_000);
  flushOutbox();
}
