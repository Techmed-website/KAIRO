import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import { toast } from '../../ui/components';
import { StaffOnly } from './StaffOnly';
import { downloadCsv, fmt, quizAction, quizDetail, quizResults, setAttempt, TYPE_LABEL, updateQuestion, type QuizDetail, type ResultRow } from './data';
import './admin.css';

/** One quiz: share it, open/close it, see who played, export results, take an unfair attempt off the board. */
export default function QuizManage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<QuizDetail | null>(null);
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    quizDetail(id).then(setD).catch((e) => setErr(friendlyError(e)));
    quizResults(id).then(setRows).catch(() => setRows([]));
  }, [id]);
  useEffect(load, [load]);

  const act = async (action: Parameters<typeof quizAction>[1], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await quizAction(id, action);
      if (action === 'duplicate') { toast('Copy made as a draft'); nav(`/editor/quizzes/${r.id}/edit`); return; }
      toast('Done'); load();
    } catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  const reject = async (r: ResultRow) => {
    const reason = window.prompt(`Why take ${r.full_name}'s attempt off the leaderboard?`);
    if (!reason?.trim()) return;
    try { await setAttempt(r.attempt_id, true, reason); toast('Attempt taken off the board'); load(); } catch (e) { toast(friendlyError(e)); }
  };
  const restore = async (r: ResultRow) => {
    try { await setAttempt(r.attempt_id, false); toast('Attempt restored'); load(); } catch (e) { toast(friendlyError(e)); }
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Could not copy on this phone'); }
  };

  if (err) return <StaffOnly><div className="page"><p className="card error">{err}</p></div></StaffOnly>;
  if (!d) return <StaffOnly><div className="page"><div className="skeleton" style={{ height: 300 }} /></div></StaffOnly>;
  const z = d.quiz;
  const finals = (rows ?? []).filter((r) => r.status === 'final');
  const avg = finals.length ? Math.round(finals.reduce((a, r) => a + (r.pct ?? 0), 0) / finals.length) : null;

  return (
    <StaffOnly>
      <div className="page stack admin">
        <div>
          <Link to="/editor/quizzes" className="small">‹ Quizzes</Link>
          <div className="aq-tags" style={{ marginTop: 6 }}>
            <span className={`badge st-${z.status}`}>{z.status}</span><span className="badge">{TYPE_LABEL[z.type] ?? z.type}</span>
            {z.featured && <span className="badge badge-ok">featured</span>}{z.has_passcode && <span className="badge">🔐 private</span>}
          </div>
          <h1>{z.title}</h1>
          <p className="muted small">{d.questions.length} questions · {z.time_limit_sec ? `${Math.round(z.time_limit_sec / 60)} min` : 'no time limit'} · opens {fmt(z.opens_at)}{z.closes_at ? ` · closes ${fmt(z.closes_at)}` : ''}{z.prize_text ? ` · 🏆 ${z.prize_text}` : ''}</p>
        </div>

        <section className="card stack-sm">
          <h2>Share</h2>
          {z.caption && <pre className="aq-caption">{z.caption}</pre>}
          <div className="enc-ctas">
            {z.caption && <button className="btn btn-accent" onClick={() => copy(z.caption!, 'Caption')}>Copy caption</button>}
            {z.caption && <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(z.caption)}`} target="_blank" rel="noopener">Send on WhatsApp</a>}
            {z.slug && <button className="btn" onClick={() => copy(z.url, 'Link')}>Copy website link</button>}
          </div>
          {z.slug && <p className="small"><a href={z.url} target="_blank" rel="noopener">{z.url.replace('https://', '')}</a></p>}
        </section>

        <section className="card stack-sm">
          <h2>Manage</h2>
          <div className="aq-actions">
            {(z.status === 'draft' || z.status === 'scheduled') && <button className="btn btn-accent" disabled={busy} onClick={() => act('publish_now', 'Open this quiz to students now?')}>Publish now</button>}
            {(z.status === 'live' || z.status === 'scheduled') && <button className="btn" disabled={busy} onClick={() => act('close', 'Close this quiz now? Students can no longer start it.')}>Close now</button>}
            {z.status === 'closed' && <button className="btn" disabled={busy} onClick={() => act('reopen')}>Reopen</button>}
            {z.status !== 'archived' && <Link className="btn" to={`/editor/quizzes/${id}/edit`}>Edit</Link>}
            <button className="btn" disabled={busy} onClick={() => act(z.featured ? 'unfeature' : 'feature')}>{z.featured ? 'Unfeature' : 'Feature on website'}</button>
            <button className="btn" disabled={busy} onClick={() => act('duplicate')}>Duplicate</button>
            {z.status !== 'archived' && <button className="btn btn-ghost" disabled={busy} onClick={() => act('archive', 'Archive this quiz? It disappears from the website. Results are kept.')}>Archive</button>}
          </div>
        </section>

        <section className="card stack-sm">
          <div className="row-between">
            <h2>Results</h2>
            {rows && rows.length > 0 && <button className="btn btn-sm" onClick={() => downloadCsv(z.title, rows)}>Export CSV</button>}
          </div>
          <p className="muted small">{finals.length} submitted{avg != null ? ` · average ${avg}%` : ''} · ranked by score, then time; first attempts only.</p>
          {!rows ? <div className="skeleton" style={{ height: 120 }} /> : rows.length === 0 ? <p className="muted">No attempts yet.</p> : (
            <div className="aq-table">
              {rows.map((r) => (
                <div key={r.attempt_id} className={`aq-res ${r.status === 'rejected' ? 'rej' : ''}`}>
                  <span className="rk num">{r.rank ?? '–'}</span>
                  <span className="grow"><b>{r.full_name}</b>{r.guest && <span className="badge">guest</span>}
                    <span className="muted small block">{r.status === 'in_progress' ? 'in progress' : `${r.score ?? 0}/${r.total ?? 0} · ${r.pct ?? 0}% · ${r.duration_sec ?? '–'}s`}
                      {r.reject_reason ? ` · ${r.reject_reason}` : ''}{!r.counts_for_rank && r.status === 'final' ? ' · practice retake' : ''}</span></span>
                  {r.status === 'final' && r.counts_for_rank && <button className="btn btn-sm btn-ghost" onClick={() => reject(r)}>Take off board</button>}
                  {r.status === 'rejected' && r.score != null && <button className="btn btn-sm btn-ghost" onClick={() => restore(r)}>Restore</button>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card stack-sm">
          <h2>Questions</h2>
          <ol className="aq-picked">
            {d.questions.map((q) => (
              <li key={q.id}>
                <span className="grow"><span className="muted small">{subjectName(q.subject)}{q.topic ? ` · ${q.topic}` : ''} · {q.year ?? '—'}{q.status === 'retired' ? ' · retired' : ''}</span>
                  <span className="block">{q.stem}</span></span>
                <QuestionTools id={q.id} difficulty={q.difficulty} status={q.status} />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </StaffOnly>
  );
}

/** Difficulty 1–5 and retire/restore, right where editors see the question. */
function QuestionTools({ id, difficulty, status }: { id: string; difficulty: number | null; status: string }) {
  const [diff, setDiff] = useState(difficulty);
  const [st, setSt] = useState(status);
  const setD = async (v: string) => {
    const n = v ? Number(v) : null;
    try { const r = await updateQuestion(id, { difficulty: n }); setDiff(r.difficulty); } catch (e) { toast(friendlyError(e)); }
  };
  const toggle = async () => {
    if (st === 'published' && !window.confirm('Retire this question? It stops appearing in new practice and quizzes.')) return;
    try { const r = await updateQuestion(id, { status: st === 'published' ? 'retired' : 'published' }); setSt(r.status); } catch (e) { toast(friendlyError(e)); }
  };
  return (
    <span className="aq-qt">
      <select className="input mini" aria-label="Difficulty" value={diff ?? ''} onChange={(e) => setD(e.target.value)}>
        <option value="">Diff.</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button className="btn btn-sm btn-ghost" onClick={toggle}>{st === 'published' ? 'Retire' : 'Restore'}</button>
    </span>
  );
}
