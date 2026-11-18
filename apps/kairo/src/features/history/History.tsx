import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../lib/db';
import { scoreBySubject } from '../../lib/score';
import { startPractice } from '../../lib/session';
import { cbt, friendlyError } from '../../lib/supabase';
import { flushOutbox, onSyncChange } from '../../lib/sync';
import type { LocalAttempt } from '../../lib/types';
import { Spinner, toast } from '../../ui/components';
import { SyncPill } from '../review/Result';

interface Row { id: string; title: string; date: string; correct: number; total: number; wrong: number; sync?: LocalAttempt['sync'] }

export default function History() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const local = await db.attempts.where('status').equals('submitted').toArray();
    const map = new Map<string, Row>();
    for (const a of local) {
      const p = await db.papers.get(a.assessment_id);
      const subs = p ? scoreBySubject(p.questions, a.answers) : [];
      const correct = a.server?.score ?? subs.reduce((x, s) => x + s.correct, 0);
      const answered = subs.reduce((x, s) => x + s.answered, 0);
      map.set(a.id, { id: a.id, title: a.title, date: a.submitted_at ?? '', correct, total: a.server?.total ?? p?.questions.length ?? 0,
        wrong: answered - subs.reduce((x, s) => x + s.correct, 0), sync: a.sync });
    }
    setRows(sortRows([...map.values()]));
    // Results from other devices.
    const { data } = await cbt().rpc('my_results');
    for (const r of (data ?? []) as { attempt_id: string; title: string; score: number; total: number; submitted_at: string }[]) {
      if (!map.has(r.attempt_id)) map.set(r.attempt_id, { id: r.attempt_id, title: r.title, date: r.submitted_at, correct: r.score, total: r.total, wrong: -1, sync: 'synced' });
    }
    setRows(sortRows([...map.values()]));
  };
  useEffect(() => { load().catch(() => {}); return onSyncChange(() => { load().catch(() => {}); }); }, []);

  const retry = async (id: string) => {
    setBusy(id);
    try { nav(`/cbt/${await startPractice({ mode: 'retry', attempt_id: id })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(null); }
  };

  if (!rows) return <Spinner />;
  return (
    <div className="page stack">
      <h1>History</h1>
      {rows.length === 0 ? (
        <div className="card stack-sm"><p>No finished practice yet.</p><Link to="/practice" className="btn btn-primary">Start practising</Link></div>
      ) : rows.map((r) => (
        <article key={r.id} className="card stack-sm">
          <div className="row-between">
            <div className="grow"><b>{r.title}</b><p className="muted small">{fmtDate(r.date)}</p></div>
            <div style={{ textAlign: 'right' }}>
              <b className="num" style={{ fontSize: 20, color: 'var(--heading)' }}>{r.total ? Math.round((r.correct / r.total) * 100) : 0}%</b>
              <p className="muted small num">{r.correct}/{r.total}</p>
            </div>
          </div>
          <div className="row wrap">
            <Link to={`/review/${r.id}`} className="btn btn-sm">Review</Link>
            {r.wrong !== 0 && <button className="btn btn-sm" disabled={busy === r.id || r.sync !== 'synced'} onClick={() => retry(r.id)}>{busy === r.id ? 'Preparing…' : 'Retry wrong ones'}</button>}
            <span className="grow" />
            <SyncPill state={r.sync} onRetry={() => flushOutbox(true)} />
          </div>
        </article>
      ))}
    </div>
  );
}
const sortRows = (r: Row[]) => r.sort((a, b) => b.date.localeCompare(a.date));
const fmtDate = (d: string) => d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
