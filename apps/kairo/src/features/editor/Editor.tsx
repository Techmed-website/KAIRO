import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { subjectName } from '../../lib/subjects';
import { cbt, friendlyError } from '../../lib/supabase';
import { parseExplanation } from '../../lib/explain';
import type { OptionKey } from '../../lib/types';
import { Tabs, toast } from '../../ui/components';
import { Options, Passage, Stem, whyNotFor } from '../cbt/Question';
import '../cbt/cbt.css';
import { changeKey, closeReports, loadQuestions, saveExplanation, type EditorQuestion } from './data';
import './editor.css';

interface Report { id: number; question_id: string; reason: string; note: string | null; created_at: string }
interface Review { id: number; question_id: string; current_option: string; proposed_option: string | null; verdict: string; reasoning: string; model: string; created_at: string }
type Tab = 'reports' | 'reviews' | 'pipeline';
const REASON: Record<string, string> = { wrong_key: 'Answer is wrong', typo: 'Typo', unclear: 'Unclear', missing_content: 'Missing diagram/text', other: 'Other' };

export default function Editor() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('reviews');
  const [reports, setReports] = useState<Report[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [qs, setQs] = useState<Map<string, EditorQuestion>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [{ data: r, error: e1 }, { data: k, error: e2 }] = await Promise.all([
        cbt().from('question_reports').select('id,question_id,reason,note,created_at').eq('status', 'open').order('created_at').limit(200),
        cbt().from('key_reviews').select('id,question_id,current_option,proposed_option,verdict,reasoning,model,created_at').eq('status', 'open').order('created_at').limit(200),
      ]);
      if (e1 || e2) throw e1 ?? e2;
      setReports((r ?? []) as Report[]); setReviews((k ?? []) as Review[]);
      setQs(await loadQuestions([...new Set([...(r ?? []), ...(k ?? [])].map((x) => x.question_id))]));
    } catch (e) { setErr(friendlyError(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (profile && profile.role !== 'editor' && profile.role !== 'admin') return <Navigate to="/" replace />;
  const byQuestion = new Map<string, Report[]>();
  for (const r of reports) byQuestion.set(r.question_id, [...(byQuestion.get(r.question_id) ?? []), r]);

  return (
    <div className="page stack editor">
      <div className="row-between"><div className="stack-sm"><p className="eyebrow">TECHMED editors</p><h1>Question desk</h1></div>
        <div className="row">{profile?.role === 'admin' && <Link className="btn btn-sm" to="/founder">Founder ›</Link>}<Link className="btn btn-sm" to="/editor/quizzes">Quizzes ›</Link></div></div>
      <Tabs value={tab} onChange={setTab} label="Desk" items={[
        { value: 'reviews', label: `Key reviews ${reviews.length}` }, { value: 'reports', label: `Reports ${byQuestion.size}` }, { value: 'pipeline', label: 'Pipeline' }]} />
      {err && <p className="card error">{err}</p>}
      {loading ? <div className="skeleton" style={{ height: 300 }} /> : tab === 'reviews' ? (
        reviews.length ? reviews.map((r) => qs.get(r.question_id) && <ReviewCard key={r.id} review={r} q={qs.get(r.question_id)!} onDone={load} />)
          : <p className="card muted">No key reviews waiting. The explanation pipeline adds questions here when it disagrees with a key.</p>
      ) : tab === 'reports' ? (
        byQuestion.size ? [...byQuestion.entries()].map(([qid, list]) => qs.get(qid) && <ReportCard key={qid} reports={list} q={qs.get(qid)!} onDone={load} />)
          : <p className="card muted">No open reports from students.</p>
      ) : <Pipeline />}
    </div>
  );
}

function QuestionView({ q }: { q: EditorQuestion }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ed-q">
      {q.passage_html && <Passage html={q.passage_html} open={open} onToggle={() => setOpen(!open)} />}
      <p className="muted small">{subjectName(q.subject)}{q.year ? ` · ${q.year}` : ''} · key {q.correct_option}{q.key_source === 'editor' ? ' (editor-confirmed)' : ''} · explanation: {q.explanation_source}</p>
      <Stem q={q} />
      <Options q={q} selected={null} reveal whyNot={whyNotFor(q)} />
    </div>
  );
}

function ReviewCard({ review, q, onDone }: { review: Review; q: EditorQuestion; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const resolve = async (accept: boolean) => {
    setBusy(true);
    const { data, error } = await cbt().rpc('resolve_key_review', { p_id: review.id, p_accept: accept });
    setBusy(false);
    if (error) { toast(friendlyError(error)); return; }
    toast(String(data)); onDone();
  };
  return (
    <article className="card stack-sm">
      <div className="row wrap">
        <span className={`badge ${review.verdict === 'disagree' ? 'badge-bad' : 'badge-flag'}`}>{review.verdict}</span>
        {review.proposed_option && <span className="badge">proposes {review.proposed_option} (now {review.current_option})</span>}
        <span className="muted small">{review.model.replace(/^.*?:/, '')}</span>
      </div>
      <p className="ed-reason">{review.reasoning}</p>
      <QuestionView q={q} />
      <div className="row wrap">
        {review.proposed_option && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => resolve(true)}>Change key to {review.proposed_option}</button>}
        <button className="btn btn-sm" disabled={busy} onClick={() => resolve(false)}>Keep key {review.current_option}</button>
      </div>
      <Fixer q={q} onDone={onDone} hint="Wording problem? Fix the explanation here, then keep the key." />
    </article>
  );
}

function ReportCard({ reports, q, onDone }: { reports: Report[]; q: EditorQuestion; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const close = async (status: 'resolved' | 'rejected') => {
    setBusy(true);
    try { await closeReports(reports.map((r) => r.id), status); toast(status === 'resolved' ? 'Marked as fixed' : 'Report dismissed'); onDone(); }
    catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  return (
    <article className="card stack-sm">
      <div className="row wrap">{[...new Set(reports.map((r) => r.reason))].map((r) => <span key={r} className={`badge ${r === 'wrong_key' ? 'badge-bad' : ''}`}>{REASON[r] ?? r}</span>)}
        <span className="muted small">{reports.length} report{reports.length > 1 ? 's' : ''}</span></div>
      {reports.filter((r) => r.note).map((r) => <p key={r.id} className="ed-reason">“{r.note}”</p>)}
      <QuestionView q={q} />
      <Fixer q={q} onDone={async () => { await closeReports(reports.map((r) => r.id), 'resolved'); onDone(); }} />
      <div className="row wrap">
        <button className="btn btn-sm" disabled={busy} onClick={() => close('resolved')}>Mark fixed</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => close('rejected')}>Dismiss (question is fine)</button>
      </div>
    </article>
  );
}

/** Edit the key and/or explanation in the TECHMED format. */
function Fixer({ q, onDone, hint }: { q: EditorQuestion; onDone: () => void; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<OptionKey>(q.correct_option!);
  const [text, setText] = useState(q.explanation_html ?? template(q, q.correct_option!));
  const [busy, setBusy] = useState(false);
  const untouched = (t: string) => !t.trim() || t === q.explanation_html || q.options.some((o) => t === template(q, o.key));
  const pickKey = (k: OptionKey) => { setKey(k); if (untouched(text)) setText(template(q, k)); };
  const problem = untouched(text) ? null : checkExplanation(text, q, key);
  const save = async () => {
    setBusy(true);
    try {
      if (key !== q.correct_option) await changeKey(q.id, key, untouched(text) ? null : text);
      else await saveExplanation(q.id, text);
      toast(key !== q.correct_option ? `Key changed to ${key}` : 'Explanation saved'); setOpen(false); onDone();
    } catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  if (!open) return <button className="btn btn-sm ed-fix" onClick={() => setOpen(true)}>Fix key or explanation</button>;
  const keyOnly = key !== q.correct_option && untouched(text);
  return (
    <div className="ed-fixer stack-sm">
      {hint && <p className="muted small">{hint}</p>}
      <div className="row wrap"><span className="small"><b>Answer key</b></span>
        {q.options.map((o) => <button key={o.key} className="chip" aria-pressed={key === o.key} onClick={() => pickKey(o.key)}>{o.key}</button>)}</div>
      {key !== q.correct_option && <p className="small error">Changing the key creates a new version: students already marked keep their score. {keyOnly ? 'The old explanation will be removed and the pipeline will write one for ' + key + '. Or write it below.' : ''}</p>}
      <label className="small" htmlFor={`ex-${q.id}`}><b>Explanation</b> (Concept, Steps, Why the other options are wrong, TECHMED TIP)</label>
      <textarea id={`ex-${q.id}`} className="input ed-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} />
      {problem && <p className="small error">{problem}</p>}
      <div className="row"><button className="btn btn-primary btn-sm" disabled={busy || !!problem || (key === q.correct_option && untouched(text))} onClick={save}>{busy ? 'Saving…' : keyOnly ? `Change key to ${key}` : 'Save'}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

const template = (q: EditorQuestion, key: OptionKey) => ['Concept: ', 'Steps:', '1. ', 'Why the other options are wrong:',
  ...q.options.filter((o) => o.key !== key).map((o) => `${o.key}: `), 'TECHMED TIP: '].join('\n');

/** The same bar the pipeline must meet: a concept, steps, and a real "why not" for every wrong option. */
export function checkExplanation(text: string, q: Pick<EditorQuestion, 'options'>, key: OptionKey): string | null {
  const p = parseExplanation(text);
  if (!p?.concept && !p?.main) return 'Write the concept (what the question tests).';
  const missing = q.options.filter((o) => o.key !== key && !(p.whyNot[o.key] ?? '').trim()).map((o) => o.key);
  if (missing.length) return `Explain why ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} wrong.`;
  if (p.whyNot[key]) return `Option ${key} is the answer, so it should not have a "why not" line.`;
  return null;
}

function Pipeline() {
  const [n, setN] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    (async () => {
      const count = async (src: string) => (await cbt().from('question_keys').select('question_id', { count: 'exact', head: true }).eq('explanation_source', src)).count ?? 0;
      const [ai, editor, failed] = await Promise.all([count('ai_techmed'), count('editor'),
        cbt().from('explanation_tries').select('question_id', { count: 'exact', head: true }).gte('tries', 2).then((r) => r.count ?? 0)]);
      setN({ ai, editor, failed });
    })();
  }, []);
  if (!n) return <div className="skeleton" style={{ height: 160 }} />;
  return (
    <div className="card stack-sm">
      <h2>TECHMED explanations</h2>
      <div className="ed-stats">
        <div><b className="num">{n.ai.toLocaleString()}</b><span className="muted small">written by the pipeline</span></div>
        <div><b className="num">{n.editor.toLocaleString()}</b><span className="muted small">written by editors</span></div>
        <div><b className="num">{n.failed.toLocaleString()}</b><span className="muted small">failed twice, need a stronger model or an editor</span></div>
      </div>
      <p className="muted small">Run more from GitHub → Actions → KAIRO explanations.</p>
    </div>
  );
}
