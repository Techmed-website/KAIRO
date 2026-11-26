import { kvGet, kvSet } from '../../lib/db';
import { cbt } from '../../lib/supabase';

export interface Streak { current: number; best: number; today: boolean; days: number; week: boolean[] }
export type BadgeCategory = 'consistency' | 'practice' | 'accuracy' | 'exam' | 'competition' | 'exploration';
export interface Badge {
  code: string; title: string; description: string; icon: string; goal: number | null;
  category?: BadgeCategory | null; earned_at: string | null; progress: number | null;
}
/** XP and level from the server (cbt._xp_summary). Level n starts at 50·n·(n−1) XP. */
export interface Xp { total: number; today: number; week: number; week_ends_at: string; level: number; floor: number; next: number; tier: string }
export interface Progress {
  streak: Streak; questions: number; correct?: number; daily_quizzes: number; quizzes?: number;
  xp?: Xp; new: string[]; badges: Badge[];
  /** XP gained since this phone last loaded progress (fresh loads only). */
  gained?: number;
}

/** Something worth celebrating (shown by <Celebrations/> on screens outside the exam). */
export interface Celebration { badges: Badge[]; level: number | null; tier: string | null }
const listeners = new Set<(c: Celebration) => void>();
export const onCelebrate = (fn: (c: Celebration) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

let cache: { at: number; p: Progress } | null = null;

/** Streak, XP and badges for the signed-in student; awards any badge just earned. Cached briefly so screens share one call. */
export async function loadProgress(fresh = false): Promise<Progress | null> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return { ...cache.p, new: [] };
  const { data, error } = await cbt().rpc('my_progress');
  if (error || !data) return null;
  const p = data as Progress;
  if (p.xp) {
    const last = await kvGet<number>('xp-total').catch(() => undefined);
    if (last != null && p.xp.total > last) p.gained = p.xp.total - last;
    kvSet('xp-total', p.xp.total).catch(() => {});
  }
  cache = { at: Date.now(), p: { ...p, gained: undefined } };
  celebrate(p).catch(() => {});
  return p;
}

/** New badges come back once from the server; a level-up is noticed against the last level this phone saw. */
const shownBadges = new Set<string>();
let shownLevel = 0;
async function celebrate(p: Progress) {
  const badges = p.badges.filter((b) => p.new.includes(b.code) && !shownBadges.has(b.code));
  badges.forEach((b) => shownBadges.add(b.code));
  let level: number | null = null;
  if (p.xp && p.xp.level > shownLevel) {
    const prev = shownLevel;
    shownLevel = p.xp.level; // set before the await, so two loads at once celebrate once
    const seen = prev || await kvGet<number>('seen-level').catch(() => undefined);
    if (seen && p.xp.level > seen) level = p.xp.level;
    await kvSet('seen-level', p.xp.level).catch(() => {}); // first time: remember quietly
  }
  if (badges.length || level) listeners.forEach((f) => f({ badges, level, tier: p.xp?.tier ?? null }));
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

/** Share of the way from this level to the next, 0..1. */
export const levelProgress = (x: Xp) => (x.next > x.floor ? Math.min(1, Math.max(0, (x.total - x.floor) / (x.next - x.floor))) : 1);

export const CATEGORIES: { key: BadgeCategory; title: string; blurb: string }[] = [
  { key: 'consistency', title: 'Consistency', blurb: 'Show up, day after day.' },
  { key: 'practice', title: 'Practice', blurb: 'Every question answered counts.' },
  { key: 'accuracy', title: 'Accuracy', blurb: 'Get them right, and keep improving.' },
  { key: 'exam', title: 'Exams', blurb: 'Full JAMB mocks, taken seriously.' },
  { key: 'competition', title: 'Competition', blurb: 'Rise up the boards.' },
  { key: 'exploration', title: 'Exploration', blurb: 'Cover every subject and topic.' },
];
