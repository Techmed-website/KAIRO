import { cbt } from '../../lib/supabase';

export interface RecapData {
  questions: number; prev_questions: number; correct: number; accuracy: number | null; prev_accuracy: number | null;
  minutes: number; active_days: number; day_map: boolean[] | null; sessions: number; daily_quizzes: number; mocks: number; xp: number;
  best_subject: { name: string; accuracy: number; n: number } | null;
  subjects: { code: string; name: string; accuracy: number; n: number }[];
  focus_topic: { name: string; code: string; accuracy: number; n: number } | null;
  strong_topic: { name: string; code: string; accuracy: number; n: number } | null;
  streak: { current: number; best: number }; badges: string[]; beat_pct: number | null; active_students?: number;
  attendance: { held: number; attended: number; rate: number | null } | null;
}
export interface Recap { kind: 'week' | 'month'; period_start: string; period_end: string; data: RecapData; created_at?: string; fresh?: boolean }
export interface MyRecaps { latest: Recap | null; history: Recap[] }

export async function loadMyRecaps(): Promise<MyRecaps> {
  const { data, error } = await cbt().rpc('my_recaps');
  if (error) throw error;
  const d = (data ?? {}) as Partial<MyRecaps>;
  return { latest: d.latest ?? null, history: d.history ?? [] };
}

const d = (s: string) => new Date(`${s}T12:00:00Z`);
export function periodLabel(r: Pick<Recap, 'kind' | 'period_start' | 'period_end'>) {
  if (r.kind === 'month') return d(r.period_start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${d(r.period_start).toLocaleDateString('en-GB', o)} – ${d(r.period_end).toLocaleDateString('en-GB', o)}`;
}
export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round((100 * (cur - prev)) / prev);
}
