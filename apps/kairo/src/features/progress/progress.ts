import { cbt } from '../../lib/supabase';

export interface Streak { current: number; best: number; today: boolean; days: number; week: boolean[] }
export interface Badge { code: string; title: string; description: string; icon: string; goal: number | null; earned_at: string | null; progress: number | null }
export interface Progress { streak: Streak; questions: number; daily_quizzes: number; new: string[]; badges: Badge[] }

let cache: { at: number; p: Progress } | null = null;

/** Streak and badges for the signed-in student; awards any badge just earned. Cached briefly so Home and Profile share one call. */
export async function loadProgress(fresh = false): Promise<Progress | null> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return { ...cache.p, new: [] };
  const { data, error } = await cbt().rpc('my_progress');
  if (error || !data) return null;
  cache = { at: Date.now(), p: data as Progress };
  return cache.p;
}

export async function bankCount(): Promise<number | null> {
  const { data } = await cbt().rpc('bank_count');
  return (data as { total?: number } | null)?.total ?? null;
}

export function streakLine(s: Streak): string {
  if (s.current === 0) return s.best > 0 ? `Your best was ${s.best} days. Start a new streak today.` : 'Finish one practice today to start your streak.';
  if (!s.today) return `Practise today to keep your ${s.current}-day streak.`;
  return s.current === 1 ? 'Day 1 done. Come back tomorrow for day 2.' : `${s.current} days in a row. See you tomorrow.`;
}
