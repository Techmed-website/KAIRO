import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { kvGet, kvSet } from '../../lib/db';
import { startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { cbt, friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import { toast } from '../../ui/components';
import { TrendChart, type Point } from './TrendChart';
import './performance.css';

interface Stat { topic_id: number; attempted: number; correct: number }
export interface Topic { id: number; name: string; subject: SubjectCode }
interface Row extends Topic { attempted: number; correct: number; pct: number }
const MIN = 10; // answered questions before a topic gets a mastery label

export function mastery(attempted: number, pct: number): { label: string; tone: 'ok' | 'mid' | 'bad' | 'new' } {
  if (attempted < MIN) return { label: `Keep going · ${attempted}/${MIN}`, tone: 'new' };
  if (pct >= 80) return { label: 'Strong', tone: 'ok' };
  if (pct >= 60) return { label: 'Getting there', tone: 'mid' };
  return { label: 'Needs work', tone: 'bad' };
}

export async function loadTopics(): Promise<Topic[]> {
  const cached = await kvGet<{ at: number; topics: Topic[] }>('topics');
  if (cached && Date.now() - cached.at < 7 * 86400_000) return cached.topics;
  const [{ data: subs }, { data: tops, error }] = await Promise.all([
    cbt().from('subjects').select('id,code'), cbt().from('topics').select('id,name,subject_id'),
  ]);
  if (error) throw error;
  const code = new Map((subs ?? []).map((s: { id: number; code: SubjectCode }) => [s.id, s.code]));
  const topics = (tops ?? []).map((t: { id: number; name: string; subject_id: number }) => ({ id: t.id, name: t.name, subject: code.get(t.subject_id)! }));
  await kvSet('topics', { at: Date.now(), topics });
  return topics;
}

export default function Performance() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [trend, setTrend] = useState<Point[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<SubjectCode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [topics, { data: stats, error }, { data: results }] = await Promise.all([
          loadTopics(), cbt().from('topic_stats').select('topic_id,attempted,correct'), cbt().rpc('my_results'),
        ]);
        if (error) throw error;
        const byId = new Map(topics.map((t) => [t.id, t]));
        setRows(((stats ?? []) as Stat[]).filter((s) => byId.has(s.topic_id) && s.attempted > 0)
          .map((s) => ({ ...byId.get(s.topic_id)!, attempted: s.attempted, correct: s.correct, pct: (100 * s.correct) / s.attempted })));
        setTrend(((results ?? []) as { submitted_at: string; percentage: number | null; title: string }[])
          .filter((r) => r.percentage != null).slice(0, 20).reverse()
          .map((r) => ({ at: r.submitted_at, pct: Number(r.percentage), title: r.title })));
      } catch (e) { setErr(friendlyError(e)); }
    })();
  }, []);

  const subjects = useMemo(() => {
    const m = new Map<SubjectCode, { attempted: number; correct: number; topics: Row[] }>();
    for (const r of rows ?? []) {
      const s = m.get(r.subject) ?? { attempted: 0, correct: 0, topics: [] };
      s.attempted += r.attempted; s.correct += r.correct; s.topics.push(r); m.set(r.subject, s);
    }
    return [...m.entries()].sort((a, b) => b[1].attempted - a[1].attempted);
  }, [rows]);

  const weakest = useMemo(() => {
    const pool = (rows ?? []).filter((r) => r.attempted >= MIN);
    const list = (pool.length >= 3 ? pool : (rows ?? []).filter((r) => r.attempted >= 5));
    return [...list].sort((a, b) => a.pct - b.pct || b.attempted - a.attempted).slice(0, 3);
  }, [rows]);

  const practise = async (r: Row) => {
    setBusy(r.id);
    try { nav(`/cbt/${await startPractice({ mode: 'topic', subject: r.subject, topic_ids: [r.id], count: 20, feedback: 'instant' })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(null); }
  };

  if (err) return <div className="page"><p className="card error">{err}</p></div>;
  if (!rows) return <div className="page stack"><h1>Your progress</h1><div className="skeleton" style={{ height: 160 }} /><div className="skeleton" style={{ height: 240 }} /></div>;

  if (!rows.length && !trend.length) return (
    <div className="page stack">
      <h1>Your progress</h1>
      <div className="card stack-sm">
        <p className="lead">Your progress appears here after your first practice.</p>
        <p className="muted small">KAIRO tracks your accuracy in every JAMB topic and shows where to focus next.</p>
        <Link to="/practice" className="btn btn-primary">Start practising</Link>
      </div>
    </div>
  );

  return (
    <div className="page stack perf">
      <h1>Your progress</h1>

      {trend.length > 0 && (
        <section className="card stack-sm">
          <div className="row-between"><h2>Score trend</h2><span className="muted small">last {trend.length} finished</span></div>
          <TrendChart points={trend} />
          {trend.length >= 2 && <p className="small">{trendLine(trend)}</p>}
        </section>
      )}

      {weakest.length > 0 && (
        <section className="stack-sm">
          <h2>Focus next</h2>
          <p className="muted small">Your three weakest topics{weakest.some((w) => w.attempted < MIN) ? ' so far (an early read: fewer than 10 answered in some)' : ''}.</p>
          {weakest.map((r) => (
            <div key={r.id} className="card focus">
              <div className="grow">
                <b>{r.name}</b>
                <p className="muted small num">{subjectName(r.subject)} · {r.correct}/{r.attempted} correct ({Math.round(r.pct)}%)</p>
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => practise(r)}>{busy === r.id ? 'Preparing…' : 'Practise this'}</button>
            </div>
          ))}
        </section>
      )}

      <section className="stack-sm">
        <h2>By subject</h2>
        {subjects.map(([code, s]) => {
          const pct = (100 * s.correct) / s.attempted;
          const isOpen = open === code;
          return (
            <div key={code} className="card subj">
              <button className="subj-h" onClick={() => setOpen(isOpen ? null : code)} aria-expanded={isOpen}>
                <span className="grow"><b>{subjectName(code)}</b><span className="muted small num"> · {s.attempted} answered</span></span>
                <b className="num">{Math.round(pct)}%</b>
              </button>
              <div className="meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
              {isOpen && (
                <ul className="topics">
                  {[...s.topics].sort((a, b) => b.attempted - a.attempted).map((t) => {
                    const m = mastery(t.attempted, t.pct);
                    return (
                      <li key={t.id}>
                        <span className="grow">{t.name}</span>
                        <span className="muted small num">{t.correct}/{t.attempted}</span>
                        <span className={`badge ${m.tone === 'ok' ? 'badge-ok' : m.tone === 'bad' ? 'badge-bad' : m.tone === 'mid' ? 'badge-flag' : ''}`}>{m.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function trendLine(t: Point[]) {
  const half = Math.floor(t.length / 2);
  const avg = (a: Point[]) => a.reduce((s, p) => s + p.pct, 0) / a.length;
  const diff = Math.round(avg(t.slice(half)) - avg(t.slice(0, half)));
  if (diff >= 3) return `You are improving: your recent scores are ${diff} points higher than before. Keep it up.`;
  if (diff <= -3) return `Your recent scores dipped by ${-diff} points. Review your last attempts and practise your focus topics.`;
  return 'Your scores are steady. Push on your weakest topics to move up.';
}
