export interface MockScore { attempt_id: string; submitted_at: string; total: number; subjects: Record<string, number> }

/**
 * Predicted UTME score from the student's mocks (newest first): a weighted average of the last three (3 : 2 : 1),
 * with a range that widens when results vary or there are few mocks. Honest by design: one mock gives a wide range.
 */
export function predictScore(mocks: MockScore[]): { score: number; low: number; high: number; basis: number } | null {
  const last = mocks.slice(0, 3);
  if (!last.length) return null;
  const w = [3, 2, 1].slice(0, last.length);
  const score = Math.round(last.reduce((s, m, i) => s + m.total * w[i], 0) / w.reduce((a, b) => a + b, 0));
  const spread = last.length > 1 ? Math.max(...last.map((m) => m.total)) - Math.min(...last.map((m) => m.total)) : 0;
  const margin = Math.max([30, 20, 15][last.length - 1], Math.round(spread / 2));
  return { score, low: Math.max(0, score - margin), high: Math.min(400, score + margin), basis: last.length };
}
