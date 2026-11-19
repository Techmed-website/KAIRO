import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kvGet } from '../../lib/db';
import { predictScore, type MockScore } from '../../lib/predict';
import { startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { cbt, friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import { toast } from '../../ui/components';
import { loadTopics, type Topic } from '../performance/Performance';

interface Due { due: number; upcoming: number; by_subject: { code: SubjectCode; due: number }[] }

/** What to do today: review what you missed, fix your weakest topic, and where your mocks put you. */
export function Today() {
  const nav = useNavigate();
  const [due, setDue] = useState<Due | null>(null);
  const [weak, setWeak] = useState<(Topic & { pct: number; attempted: number }) | null>(null);
  const [pred, setPred] = useState<ReturnType<typeof predictScore>>(null);
  const [target, setTarget] = useState<number | undefined>();
  const [busy, setBusy] = useState('');

  useEffect(() => {
    cbt().rpc('review_due').then(({ data }) => data && setDue(data as Due));
    cbt().rpc('my_mock_scores').then(({ data }) => setPred(predictScore((data ?? []) as MockScore[])));
    kvGet<number>('target').then(setTarget);
    Promise.all([loadTopics(), cbt().from('topic_stats').select('topic_id,attempted,correct').gte('attempted', 10)]).then(([topics, { data }]) => {
      const byId = new Map(topics.map((t) => [t.id, t]));
      const worst = ((data ?? []) as { topic_id: number; attempted: number; correct: number }[])
        .filter((s) => byId.has(s.topic_id)).map((s) => ({ ...byId.get(s.topic_id)!, attempted: s.attempted, pct: (100 * s.correct) / s.attempted }))
        .filter((t) => t.pct < 70).sort((a, b) => a.pct - b.pct)[0];
      setWeak(worst ?? null);
    }).catch(() => {});
  }, []);

  const go = async (id: string, req: Parameters<typeof startPractice>[0]) => {
    setBusy(id);
    try { nav(`/cbt/${await startPractice(req)}`); } catch (e) { toast(friendlyError(e)); setBusy(''); }
  };

  const items = [
    due && due.due > 0 && (
      <div key="review" className="today-item">
        <div className="grow"><b>Review {due.due} question{due.due > 1 ? 's' : ''} you missed</b>
          <p className="muted small">{due.by_subject.map((s) => `${subjectName(s.code)} ${s.due}`).join(' · ')}. Spaced review makes them stick.</p></div>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => go('review', { mode: 'review', count: Math.min(due.due, 20) })}>{busy === 'review' ? '…' : 'Review'}</button>
      </div>
    ),
    weak && (
      <div key="weak" className="today-item">
        <div className="grow"><b>Fix your weakest topic: {weak.name}</b>
          <p className="muted small num">{subjectName(weak.subject)} · {Math.round(weak.pct)}% so far. 20 questions with explanations.</p></div>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => go('weak', { mode: 'topic', subject: weak.subject, topic_ids: [weak.id], count: 20, feedback: 'instant' })}>{busy === 'weak' ? '…' : 'Practise'}</button>
      </div>
    ),
    pred && (
      <div key="pred" className="today-item">
        <div className="grow"><b>Predicted UTME score: <span className="num">{pred.score}</span>/400</b>
          <p className="muted small num">Likely {pred.low}–{pred.high}, from your last {pred.basis === 1 ? 'mock' : `${pred.basis} mocks`}.{target ? ` Target ${target}: ${pred.score >= target ? 'on track.' : `${target - pred.score} to go.`}` : ''}</p></div>
      </div>
    ),
  ].filter(Boolean);

  if (!items.length) return null;
  return <section className="stack-sm"><h2>Today</h2><div className="card today">{items}</div></section>;
}
