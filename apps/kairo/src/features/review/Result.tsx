import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { topicNames } from '../../lib/catalog';
import { db, kvGet } from '../../lib/db';
import { aggregate, formatDuration, scoreBySubject, to100 } from '../../lib/score';
import { startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import { flushOutbox, onSyncChange } from '../../lib/sync';
import type { Assessment, LocalAttempt, SubjectCode } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { claimRank, linkGoogle, saveGuestAccount } from '../../lib/guest';
import { shortTitle } from '../daily/data';
import { Encourage } from './Encourage';
import { shareScore } from './share';
import { ProgressRing, Spinner, toast } from '../../ui/components';
import { loadPaperBoard, NOT_RANKED, type PaperBoard } from '../leaderboard/paper';
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
  const [asmt, setAsmt] = useState<Assessment | null>(null);
  const [rankKey, setRankKey] = useState(0);
  const { session } = useAuth();
  const guest = !!session?.user?.is_anonymous;

  useEffect(() => {
    loadReview(id).then((r) => { setD(r); setAtt(r?.attempt ?? null); }).catch((e) => setErr(friendlyError(e)));
    topicNames().then(setNames);
    kvGet<boolean>('starter-done').then((v) => setFirstRun(!v));
    return onSyncChange(() => db.attempts.get(id).then((a) => {
      if (!a) return;
      setAtt(a);
      if (a.sync === 'synced') loadReview(id).then((r) => r && !r.pending && setD(r)).catch(() => {});
    }));
  }, [id]);

  const subjects = useMemo(() => (d ? scoreBySubject(d.questions, d.answers) : []), [d]);
  const correct = subjects.reduce((a, s) => a + s.correct, 0);
  const total = d?.questions.length ?? 0;
  const pct = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const agg = aggregate(subjects);

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

  // The quiz's own settings (pass mark, result images and quotes, public link) from the paper on this phone.
  useEffect(() => { if (att?.assessment_id) db.papers.get(att.assessment_id).then((p) => setAsmt(p?.assessment ?? null)); }, [att?.assessment_id]);
  // A guest who has since created an account: their first attempt goes on the leaderboard (harmless if already there).
  useEffect(() => {
    if (att?.sync === 'synced' && session && !guest && asmt?.ranked) claimRank(id).then(() => setRankKey((k) => k + 1)).catch(() => {});
  }, [att?.sync, session, guest, asmt?.ranked, id]);

  const wrongCount = d ? d.questions.filter((q) => d.answers[q.id]?.selected && d.answers[q.id].selected !== q.correct_option).length : 0;

  const retry = async () => {
    setBusy(true);
    try { nav(`/cbt/${await startPractice({ mode: 'retry', attempt_id: id, feedback: 'instant' })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(false); }
  };

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!d) return <Spinner label="Marking" />;
  if (d.pending) return (
    <div className="page stack">
      <div className="row-between"><div><p className="eyebrow">{d.title}</p><h1>Submitted</h1></div>{att && <SyncPill state={att.sync} onRetry={() => flushOutbox(true)} />}</div>
      <section className="card stack-sm">
        <p className="lead">Your answers are safe on this phone.</p>
        <p className="muted">KAIRO marks this paper on the server, so answers stay hidden until you submit, just like JAMB. Your score and review appear as soon as you are back online.</p>
        <button className="btn btn-primary" onClick={() => flushOutbox(true)}>Try now</button>
      </section>
      <Link className="btn btn-ghost btn-block" to="/">Back to home</Link>
    </div>
  );

  const dur = att?.server?.status ? att.duration_sec : d.server?.duration_sec ?? att?.duration_sec;
  const sync = att?.sync;
  const improved = best != null && best >= 0 && pct > best;
  const answered = Object.values(d.answers).filter((a) => a.selected).length;
  const quizLike = d.type === 'daily_quiz' || d.type === 'challenge';
  const oneSubject: SubjectCode | null = d.questions.length && d.questions.every((q) => q.subject === d.questions[0].subject) ? d.questions[0].subject : null;

  return (
    <div className="page stack">
      <div className="row-between">
        <div><p className="eyebrow">{d.type === 'daily_quiz' ? shortTitle(d.title) : d.title}</p><h1>Your result</h1></div>
        {att && <SyncPill state={sync} onRetry={() => flushOutbox(true)} />}
      </div>

      <section className="card result-hero">
        <ProgressRing value={agg.max ? agg.score / agg.max : 0} size={112} stroke={10}>
          <b className="big num">{agg.score}</b><span className="muted small num">/{agg.max}</span>
        </ProgressRing>
        <div className="stack-sm grow">
          {!quizLike && <p className="lead">{headline(pct, improved)}</p>}
          {quizLike && <p className="lead num">{correct}/{total}</p>}
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

      {quizLike && <Encourage pct={pct} cfg={asmt?.result_config} subject={oneSubject} seed={id} />}

      {guest && sync === 'synced' && <GuestSave attemptId={id} onSaved={() => setRankKey((k) => k + 1)} />}

      {sync === 'synced' && !guest && <RankCard key={rankKey} id={id} />}

      {quizLike && sync === 'synced' && (
        <button className="btn btn-block share-btn" onClick={() => shareScore({
          score: correct, total, heading: shortTitle(d.title).replace(/\s*\(.*\)\s*$/, ''),
          sub: asmt?.topic_label ?? null,
          url: asmt?.slug ? `https://techmedng.com/quizzes/${asmt.slug}` : `https://kairo.techmedng.com/q/${att?.assessment_id ?? ''}`,
        }).then((r) => r === 'downloaded' && toast('Score card saved. Post it on WhatsApp!')).catch(() => toast('Could not make the score card on this phone.'))}>
          Share my score on WhatsApp
        </button>
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

/** Guest just finished: keep the score and get on the leaderboard by turning this session into a free account. */
function GuestSave({ attemptId, onSaved }: { attemptId: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; info?: string }>({});
  const strong = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!strong) { setMsg({ err: 'Use at least 8 characters with a capital letter, a small letter, a number and a symbol.' }); return; }
    setBusy(true); setMsg({});
    try {
      const r = await saveGuestAccount(name, email, password);
      if (r === 'confirm') { setMsg({ info: `We sent a link to ${email}. Open it, then come back here to see your rank.` }); return; }
      await claimRank(attemptId).catch(() => {});
      toast('Saved. Your score is on the leaderboard.');
      onSaved();
    } catch (e2) {
      setMsg({ err: e2 instanceof Error && !(e2 as { code?: string }).code ? e2.message : friendlyError(e2) });
    } finally { setBusy(false); }
  };
  return (
    <section className="card stack-sm guest-save">
      <h2>Save your score and get your rank</h2>
      <p className="muted small">Create your free TECHMED account in seconds. Your score goes on the leaderboard and every quiz you take is kept.</p>
      <button className="btn btn-block google" type="button" disabled={busy}
        onClick={() => linkGoogle(location.pathname).catch(() => setMsg({ err: 'Google sign-up is not available here yet. Use your email below.' }))}>
        Continue with Google
      </button>
      <form className="stack-sm" onSubmit={save}>
        <input className="input" placeholder="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="email" inputMode="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password (8+ with A–Z, a–z, 0–9, symbol)" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {msg.err && <p className="error" role="alert">{msg.err}</p>}
        {msg.info && <p className="info" role="status">{msg.info}</p>}
        <button className="btn btn-accent btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save my score'}</button>
      </form>
      <p className="muted small">Already have an account? <Link to="/signin">Sign in</Link> (this guest score stays on this phone only).</p>
    </section>
  );
}

/** "Your rank #59 of 430" once the server has marked the attempt; a short note when the paper is not ranked. */
function RankCard({ id }: { id: string }) {
  const [b, setB] = useState<PaperBoard | null>(null);
  useEffect(() => { loadPaperBoard(id, 3).then(setB).catch(() => setB(null)); }, [id]);
  if (!b) return null;
  if (!b.eligible) return <p className="muted small">{NOT_RANKED[b.reason]}</p>;
  return (
    <Link to={`/rank/${id}`} className="card rank-link" aria-label={`Your rank ${b.this.rank} of ${b.participants}. See the leaderboard`}>
      <span className="rank-big num">#{b.this.rank}</span>
      <span className="grow"><b>Your rank of {b.participants}</b>
        <span className="muted small block">{b.this.personal_best && b.participants > 1 ? 'Your best on this paper. ' : ''}See the leaderboard ›</span></span>
    </Link>
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
