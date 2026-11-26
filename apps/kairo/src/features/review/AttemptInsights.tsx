import { useEffect, useState } from 'react';
import { cbt } from '../../lib/supabase';
import type { Answer, PaperQuestion } from '../../lib/types';

export interface Insight {
  answered: number; avg_sec: number | null; community_avg_sec: number | null; community_pct: number | null;
  peers: number; peer_avg_pct: number | null; percentile: number | null;
  beat_the_crowd: number; missed_easy: number; slow: number;
}

/** How this attempt compares with other students (cbt.attempt_analysis). Only once the server has the attempt. */
export function useAttemptAnalysis(id: string, enabled: boolean) {
  const [x, setX] = useState<Insight | null>(null);
  useEffect(() => {
    if (!enabled) return;
    cbt().rpc('attempt_analysis', { p_attempt: id }).then(({ data }) => setX((data as Insight) ?? null), () => setX(null));
  }, [id, enabled]);
  return x && x.answered ? x : null;
}

/** At most four short, plain lines; only the ones the data supports. */
export function analysisLines(x: Insight): string[] {
  const out: string[] = [];
  if (x.percentile != null && x.peers >= 3) out.push(`You scored higher than ${Math.round(x.percentile)}% of ${x.peers} other students on this paper.`);
  if (x.avg_sec != null && x.community_avg_sec != null) {
    const s = x.avg_sec <= x.community_avg_sec * 0.85 ? 'faster than' : x.avg_sec >= x.community_avg_sec * 1.15 ? 'slower than' : 'about as fast as';
    out.push(`${x.avg_sec}s a question: ${s} other students (${x.community_avg_sec}s).`);
  }
  if (x.missed_easy > 0) out.push(`${x.missed_easy} you missed were ones most students got right. Review these first.`);
  if (x.beat_the_crowd > 0) out.push(`You got ${x.beat_the_crowd} right that most students missed.`);
  return out.slice(0, 4);
}

export interface TopicResult { tid: number; c: number; n: number; pct: number }

/** Topics in this paper, weakest first (answered questions only). */
export function topicResults(questions: PaperQuestion[], answers: Record<string, Answer>): TopicResult[] {
  const m = new Map<number, { c: number; n: number }>();
  for (const q of questions) {
    if (q.topic_id == null || !answers[q.id]?.selected) continue;
    const t = m.get(q.topic_id) ?? { c: 0, n: 0 };
    t.n++; if (answers[q.id].selected === q.correct_option) t.c++;
    m.set(q.topic_id, t);
  }
  return [...m.entries()].map(([tid, v]) => ({ tid, ...v, pct: v.c / v.n })).sort((a, b) => a.pct - b.pct || b.n - a.n);
}

/** The topic to practise next: the weakest one with at least one miss, preferring topics with more misses. */
export function weakestTopic(topics: TopicResult[]): TopicResult | null {
  const missed = topics.filter((t) => t.c < t.n);
  if (!missed.length) return null;
  return [...missed].sort((a, b) => a.pct - b.pct || (b.n - b.c) - (a.n - a.c))[0];
}
