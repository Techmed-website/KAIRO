import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startPractice } from '../../lib/session';
import { friendlyError } from '../../lib/supabase';
import { cbt } from '../../lib/supabase';
import type { PaperQuestion } from '../../lib/types';
import { toast } from '../../ui/components';

interface Insight {
  answered: number; avg_sec: number | null; community_avg_sec: number | null; community_pct: number | null;
  peers: number; peer_avg_pct: number | null; percentile: number | null;
  beat_the_crowd: number; missed_easy: number; slow: number;
  questions: { question_id: string; correct: boolean; time_sec: number | null; community_pct: number | null; community_avg_sec: number | null }[];
}

/** Result analysis: speed vs everyone, how others did on the same questions, and one topic to practise next. */
export function AttemptInsights({ id, questions, names }: { id: string; questions: PaperQuestion[]; names: Map<number, string> }) {
  const nav = useNavigate();
  const [x, setX] = useState<Insight | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { cbt().rpc('attempt_analysis', { p_attempt: id }).then(({ data }) => setX((data as Insight) ?? null)); }, [id]);
  if (!x || !x.answered) return null;

  // Weakest topic in this attempt (most misses), for "practise this next".
  const byQ = new Map(questions.map((q) => [q.id, q]));
  const miss = new Map<number, number>();
  for (const r of x.questions) { const q = byQ.get(r.question_id); if (q?.topic_id != null && !r.correct) miss.set(q.topic_id, (miss.get(q.topic_id) ?? 0) + 1); }
  const [topicId] = [...miss.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const topicQ = topicId != null ? questions.find((q) => q.topic_id === topicId) : undefined;

  const practise = async () => {
    if (!topicQ || topicId == null) return;
    setBusy(true);
    try { nav(`/cbt/${await startPractice({ mode: 'topic', subject: topicQ.subject, topic_ids: [topicId], count: 20, feedback: 'instant' })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(false); }
  };
  const speed = x.avg_sec != null && x.community_avg_sec != null
    ? x.avg_sec <= x.community_avg_sec * 0.85 ? 'faster than' : x.avg_sec >= x.community_avg_sec * 1.15 ? 'slower than' : 'about the same as' : null;

  return (
    <section className="card stack-sm insights">
      <h2>Analysis</h2>
      <div className="insight-tiles">
        {x.avg_sec != null && <div><b className="num">{x.avg_sec}s</b><span className="muted small">per question{x.community_avg_sec != null ? ` · others ${x.community_avg_sec}s` : ''}</span></div>}
        {x.percentile != null && <div><b className="num">Top {Math.max(1, 100 - x.percentile)}%</b><span className="muted small">of {x.peers} others on this paper</span></div>}
        {x.percentile == null && x.community_pct != null && <div><b className="num">{x.community_pct}%</b><span className="muted small">average on these questions</span></div>}
      </div>
      <ul className="insight-list">
        {speed && <li>⏱️ You were {speed} other students on these questions.</li>}
        {x.beat_the_crowd > 0 && <li>💪 You got {x.beat_the_crowd} right that most students missed.</li>}
        {x.missed_easy > 0 && <li>🎯 {x.missed_easy} you missed were ones most students got right. Review these first.</li>}
        {x.slow > 0 && <li>🐢 {x.slow} question{x.slow > 1 ? 's' : ''} took you more than twice the usual time.</li>}
      </ul>
      {topicQ && topicId != null && (
        <button className="btn btn-primary btn-block" disabled={busy} onClick={practise}>
          {busy ? 'Preparing…' : `Practise next: ${names.get(topicId) ?? 'your weakest topic'}`}
        </button>
      )}
    </section>
  );
}
