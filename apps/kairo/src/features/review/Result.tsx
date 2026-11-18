import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { topicNames } from '../../lib/catalog';
import { db, kvGet } from '../../lib/db';
import { aggregate400, formatDuration, scoreBySubject, to100 } from '../../lib/score';
import { startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import { flushOutbox, onSyncChange } from '../../lib/sync';
import type { LocalAttempt } from '../../lib/types';
import { ProgressRing, Spinner, toast } from '../../ui/components';
import { loadReview, type ReviewData } from './data';
import './review.css';

export default function Result() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<ReviewData | null>(null);
  const [att, setAtt] = useState<LocalAttempt | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [best, setBest] = useState<number | null>(null);
  const [firstRun, setFirstRun] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadReview(id).then((r) => { setD(r); setAtt(r?.attempt ?? null); }).catch((e) => setErr(friendlyError(e)));
    topicNames().then(setNames);
    kvGet<boolean>('starter-done').then((v) => setFirstRun(!v));
    return onSyncChange(() => db.attempts.get(id).then((a) => a && setAtt(a)));
  }, [id]);

  const subjects = useMemo(() => (d ? scoreBySubject(d.questions, d.answers) : []), [d]);
  const correct = subjects.reduce((a, s) => a + s.correct, 0);
  const total = d?.questions.length ?? 0;
  const pct = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const agg = d?.type === 'mock' ? aggregate400(subjects) : null;

  useEffect(() => {
    if (!d?.attempt) return;
    // Personal best among earlier finished attempts of the same kind on this phone.
    db.attempts.where('status').equals('submitted').toArray().then(async (list) => {
      let top = -1;
      for (const a of list) {
        if (a.id === id || a.type !== d.type || (a.submitted_at ?? '') > (d.attempt!.submitted_at ?? '')) continue;
        const p = await db.papers.get(a.assessment_id);
        if (!p) continue;
        const c = scoreBySubject(p.questions, a.answers).reduce((x, s) => x + s.correct, 0);
        top = Math.max(top, p.questions.length ? (c / p.questions.length) * 100 : 0);
      }
      setBest(top);
    });
  }, [d, id]);

  const topics = useMemo(() => {
    if (!d) return [];
    const m = new Map<number, { c: number; n: number }>();
    for (const q of d.questions) {
      if (q.topic_id == null || !d.answers[q.id]?.selected) continue;
      const t = m.get(q.topic_id) ?? { c: 0, n: 0 };
      t.n++; if (d.answers[q.id].selected === q.correct_option) t.c++;
      m.set(q.topic_id, t);
    }
    return [...m.entries()].map(([tid, v]) => ({ tid, ...v, pct: v.c / v.n })).sort((a, b) => a.pct - b.pct || b.n - a.n);
  }, [d]);

  const wrongCount = d ? d.questions.filter((q) => d.answers[q.id]?.selected && d.answers[q.id].selected !== q.correct_option).length : 0;

  const retry = async () => {
    setBusy(true);
    try { nav(`/cbt/${await startPractice({ mode: 'retry', attempt_id: id, feedback: 'instant' })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(false); }
  };

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!d) return <Spinner label="Marking" />;

  const dur = att?.server?.status ? att.duration_sec : d.server?.duration_sec ?? att?.duration_sec;
  const sync = att?.sync;
  const improved = best != null && best >= 0 && pct > best;
  const answered = Object.values(d.answers).filter((a) => a.selected).length;

  return (
    <div className="page stack">
      <div className="row-between">
        <div><p className="eyebrow">{d.title}</p><h1>Your result</h1></div>
        {att && <SyncPill state={sync} onRetry={() => flushOutbox(true)} />}
      </div>

      <section className="card result-hero">
        <ProgressRing value={agg != null ? agg / 400 : pct / 100} size={128} stroke={11}>
          {agg != null
            ? <><b className="big num">{agg}</b><span className="muted small">/400</span></>
            : subjects.length === 1
              ? <><b className="big num">{subjects[0].score100}</b><span className="muted small">/100</span></>
              : <><b className="big num">{Math.round(pct)}</b><span className="muted small">%</span></>}
        </ProgressRing>
        <div className="stack-sm grow">
          <p className="lead">{headline(pct, improved)}</p>
          <p className="muted small num">{correct} of {total} correct · {pct}%{dur ? ` · ${formatDuration(dur)}` : ''}</p>
          <p className="muted small num">{answered} answered{answered < total ? `, ${total - answered} left blank` : ''}</p>
        </div>
      </section>

      {subjects.length > 1 && (
        <section className="subj-grid">
          {subjects.map((s) => (
            <div key={s.code} className="subj-card">
              <b className="num">{s.score100}</b><span className="muted small">{subjectName(s.code)} /100</span>
              <div className="meter"><i style={{ width: `${s.score100}%` }} /></div>
              <span className="muted small num">{s.correct}/{s.total}</span>
            </div>
          ))}
        </section>
      )}

      {topics.length > 0 && (
        <section className="card stack-sm">
          <h2>By topic</h2>
          {topics.slice(0, 6).map((t) => (
            <div key={t.tid} className="topic-row">
              <span className="grow">{names.get(t.tid) ?? 'Topic'}</span>
              <span className={`badge ${t.pct >= .7 ? 'badge-ok' : t.pct < .4 ? 'badge-bad' : ''} num`}>{t.c}/{t.n}</span>
            </div>
          ))}
          {topics.length > 6 && <p className="muted small">and {topics.length - 6} more topics</p>}
        </section>
      )}

      {att?.server?.status === 'rejected' && <p className="error">This attempt was not accepted by the server ({att.server.reject_reason}). It still counts as practice.</p>}

      <div className="stack-sm">
        <Link className="btn btn-primary btn-lg btn-block" to={`/review/${id}`}>Review answers</Link>
        {wrongCount > 0 && <button className="btn btn-block" onClick={retry} disabled={busy || sync !== 'synced'}>
          {busy ? 'Preparing…' : `Retry the ${wrongCount} you missed`}</button>}
        {firstRun
          ? <Link className="btn btn-accent btn-block" to="/install">Next: keep KAIRO on your phone</Link>
          : <Link className="btn btn-ghost btn-block" to="/">Back to home</Link>}
      </div>
    </div>
  );
}

function headline(pct: number, improved: boolean) {
  if (improved) return 'New personal best. Your work is paying off.';
  if (pct >= 80) return 'Excellent work. Keep this standard.';
  if (pct >= 60) return 'Good result. Review the ones you missed to push higher.';
  if (pct >= 40) return 'A solid start. The review below shows exactly where to improve.';
  return 'Every mistake here is one you will not make in JAMB. Let’s review them.';
}

export function SyncPill({ state, onRetry }: { state?: LocalAttempt['sync']; onRetry: () => void }) {
  if (state === 'synced') return <span className="badge badge-ok">Synced ✓</span>;
  if (state === 'syncing') return <span className="badge">Syncing…</span>;
  if (state === 'failed') return <button className="badge badge-bad" onClick={onRetry}>Not synced, tap to retry</button>;
  return <span className="badge">Saved on phone</span>;
}
export { to100 };
