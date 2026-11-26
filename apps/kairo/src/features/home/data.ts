import { cbt } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';

/** Today's Daily Builder Quiz for the Home card, with the student's own state (cbt.home_today). */
export interface HomeQuiz {
  id: string; title: string; day_number: number | null; topic_label: string | null;
  subject: string | null; subject_code: SubjectCode | null;
  question_count: number; time_limit_sec: number | null; opens_at: string;
  /** Opened today (Lagos). False means today's quiz has not been built yet and this is the previous one. */
  is_today: boolean;
  players: number;
  best: number | null;
  in_progress: { attempt_id: string; deadline_at: string | null; answered: number } | null;
  /** The first finished attempt: the one that counts for the leaderboard. */
  result: { attempt_id: string; score: number; total: number; answered: number } | null;
}

export async function homeToday(): Promise<HomeQuiz | null> {
  const { data, error } = await cbt().rpc('home_today');
  if (error) throw error;
  return (data ?? null) as HomeQuiz | null;
}

export type DailyState = 'loading' | 'error' | 'none' | 'ready' | 'in_progress' | 'done';

/** Which face the card shows. Completion always wins, so a retry in progress never hides a finished quiz. */
export function dailyState(q: HomeQuiz | null | undefined, failed: boolean): DailyState {
  if (failed) return 'error';
  if (q === undefined) return 'loading';
  if (!q || !q.is_today) return 'none';
  if (q.result) return 'done';
  if (q.in_progress) return 'in_progress';
  return 'ready';
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "THURSDAY, 26 NOVEMBER" style date (uppercased in CSS), from the device clock. */
export const longDate = (d = new Date()) =>
  `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;

export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'K';
}
