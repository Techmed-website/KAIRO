import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { topicNames } from '../../lib/catalog';
import { db, kvGet } from '../../lib/db';
import { aggregate, formatDuration, scoreBySubject, to100 } from '../../lib/score';
import { startPractice, type PracticeRequest } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import { flushOutbox, onSyncChange } from '../../lib/sync';
import type { Assessment, LocalAttempt, SubjectCode } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { claimRank, linkGoogle, saveGuestAccount } from '../../lib/guest';
import { shortTitle } from '../daily/data';
import { BandArt, bandMessage, ClassesNudge } from './Encourage';
import { shareScore } from './share';
import { PushPrompt } from '../../app/PushPrompt';
import { ProgressRing, Spinner, toast } from '../../ui/components';
import { IcArrowRight, IcBolt, IcClose, IcFlame, IcNext, IcShare, IcTrophy } from '../../ui/icons';
import { loadPaperBoard, NOT_RANKED, type PaperBoard } from '../leaderboard/paper';
import { loadReview, type ReviewData } from './data';
import { loadProgress, type Progress } from '../progress/progress';
import { analysisLines, topicResults, useAttemptAnalysis, weakestTopic } from './AttemptInsights';
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
  const [busy, setBusy] = useState('');
  const [asmt, setAsmt] = useState<Assessment | null>(null);
  const [rankKey, setRankKey] = useState(0);
  const { session } = useAuth();
  const guest = !!session?.user?.is_anonymous;
  const [prog, setProg] = useState<Progress | null>(null);

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
  const topics = useMemo(() => (d ? topicResults(d.questions, d.answers) : []), [d]);

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

  // The quiz's own settings (pass mark, result images and quotes, public link) from the paper on this phone.
  useEffect(() => { if (att?.assessment_id) db.papers.get(att.assessment_id).then((p) => setAsmt(p?.assessment ?? null)); }, [att?.assessment_id]);
  // A guest who has since created an account: their first attempt goes on the leaderboard (harmless if already there).
  useEffect(() => {
    if (att?.sync === 'synced' && session && !guest && asmt?.ranked) claimRank(id).then(() => setRankKey((k) => k + 1)).catch(() => {});
  }, [att?.sync, session, guest, asmt?.ranked, id]);
  // Once the server has the attempt: update streak and award badges (fresh, so a badge earned now shows here).
  useEffect(() => { if (att?.sync === 'synced' && session) loadProgress(true).then(setProg).catch(() => {}); }, [att?.sync, session]);
  const insight = useAttemptAnalysis(id, att?.sync === 'synced' && !guest);

  const go = async (key: string, req: PracticeRequest) => {
    setBusy(key);
    try { nav(`/cbt/${await startPractice(req)}`); }
    catch (e) { toast(friendlyError(e)); setBusy(''); }
  };

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!d) return <Spinner label="Marking" />;
  if (d.pending) return (
    <div className="page px result">
      <Top title={d.title} att={att} />
      <section className="r-hero r-pending">
        <h1>Submitted</h1>
        <p>Your answers are safe on this phone. KAIRO marks this paper on the server, so answers stay hidden until you submit, just like JAMB.</p>
        <p className="r-dim small">Your score and review appear as soon as you are back online.</p>
        <button className="btn btn-accent btn-block" onClick={() => flushOutbox(true)}>Try now</button>
      </section>
      <Link className="btn btn-ghost btn-block" to="/">Back to home</Link>
    </div>
  );

  const dur = att?.server?.status ? att.duration_sec : d.server?.duration_sec ?? att?.duration_sec;
  const sync = att?.sync;
  const improved = best != null && best >= 0 && pct > best;
  const answered = Object.values(d.answers).filter((a) => a.selected).length;
  const wrong = answered - correct;
  const quizLike = d.type === 'daily_quiz' || d.type === 'challenge';
  const oneSubject: SubjectCode | null = d.questions.length && d.questions.every((q) => q.subject === d.questions[0].subject) ? d.questions[0].subject : null;
  const msg = bandMessage(pct, asmt?.result_config, id);
  const headlineText = quizLike ? msg.headline : headline(pct, improved);
  const weak = weakestTopic(topics);
  const weakQ = weak ? d.questions.find((q) => q.topic_id === weak.tid) : undefined;
  const lines = insight ? analysisLines(insight) : [];
  const share = () => shareScore({
    score: correct, total, heading: shortTitle(d.title).replace(/\s*\(.*\)\s*$/, ''), sub: asmt?.topic_label ?? null,
    url: asmt?.slug ? `https://techmedng.com/quizzes/${asmt.slug}` : `https://kairo.techmedng.com/q/${att?.assessment_id ?? ''}`,
  }).then((r) => r === 'downloaded' && toast('Score card saved. Post it on WhatsApp!')).catch(() => toast('Could not make the score card on this phone.'));

  return (
    <div className="page px result">
      <Top title={d.type === 'daily_quiz' ? shortTitle(d.title) : d.title} att={att} />

      {/* 1. How did I do? */}
      <section className={`r-hero band-${msg.band}`} aria-labelledby="r-h">
        <div className="r-head">
          <ProgressRing value={agg.max ? agg.score / agg.max : 0} size={104} stroke={9}>
            {quizLike ? <><b className="r-big num">{correct}</b><span className="r-dim small num">/{total}</span></>
              : <><b className="r-big num">{agg.score}</b><span className="r-dim small num">/{agg.max}</span></>}
          </ProgressRing>
          <div className="grow r-msg">
            <h1 id="r-h">{headlineText}</h1>
            {quizLike && <p className="r-dim small">“{msg.quote}”</p>}
          </div>
          {quizLike && sync === 'synced' && <button className="r-share" onClick={share} aria-label="Share my score on WhatsApp"><IcShare /></button>}
        </div>
        <dl className="r-stats">
          <div><dt>Correct</dt><dd className="num">{correct}/{total}</dd></div>
          <div><dt>Accuracy</dt><dd className="num">{answered ? Math.round((100 * correct) / answered) : 0}%</dd></div>
          {dur ? <div><dt>Time</dt><dd className="num">{formatDuration(dur)}</dd></div> : null}
          <div><dt>Blank</dt><dd className="num">{total - answered}</dd></div>
        </dl>
        {subjects.length > 1 && (
          <ul className="r-subj" aria-label="By subject">
            {subjects.map((s) => (
              <li key={s.code}>
                <span className="r-subj-n">{subjectName(s.code)}</span>
                <span className="r-bar" aria-hidden="true"><i style={{ width: `${s.score100}%` }} /></span>
                <b className="num">{s.score100}<small>/100</small></b>
              </li>
            ))}
          </ul>
        )}
        {quizLike && msg.image && <img src={msg.image} alt="" className="r-band-img" />}
        {quizLike && !msg.image && <span className="r-band-art"><BandArt band={msg.band} size={40} /></span>}
      </section>

      {/* Streak, badges and rank: one line each, only when there is something to say. */}
      {prog && (prog.streak.current > 0 || (prog.gained ?? 0) > 0) && (
        <p className="r-strip" role="status">
          {(prog.gained ?? 0) > 0 && <span className="r-xp num">+{prog.gained} XP</span>}
          {prog.streak.current > 0 && <span><IcFlame className="r-flame" /><b className="num">{prog.streak.current}-day streak</b></span>}
          {prog.xp && <span className="num">Level {prog.xp.level}</span>}
        </p>
      )}
      {guest && sync === 'synced' && <GuestSave attemptId={id} onSaved={() => setRankKey((k) => k + 1)} />}
      {sync === 'synced' && !guest && <RankRow key={rankKey} id={id} quizId={quizLike ? att?.assessment_id : undefined} />}
      {sync === 'synced' && guest && quizLike && att?.assessment_id && <Link className="r-row" to={`/quiz/${att.assessment_id}`}><IcTrophy /><span className="grow">See the leaderboard</span><IcNext className="chev" /></Link>}

      {/* 2. What next? One clear action, at most two follow-ups. */}
      <section className="r-next" aria-labelledby="r-next-h">
        <h2 id="r-next-h">What to do next</h2>
        <Link className="btn btn-accent btn-lg btn-block r-primary" to={`/review/${id}`}>
          <span>Review answers</span><small className="num">{wrong ? `${wrong} wrong` : 'All correct'}{total - answered ? ` · ${total - answered} blank` : ''} · with explanations</small>
        </Link>
        {wrong > 0 && (
          <button className="r-row" disabled={!!busy || sync !== 'synced'} onClick={() => go('retry', { mode: 'retry', attempt_id: id, feedback: 'instant' })}>
            <IcBolt /><span className="grow"><b>{busy === 'retry' ? 'Preparing…' : `Retry the ${wrong} you missed`}</b><small>{sync !== 'synced' ? 'Available once your result is synced' : 'Same questions, answers shown as you go'}</small></span><IcNext className="chev" />
          </button>
        )}
        {weak && weakQ ? (
          <button className="r-row" disabled={!!busy} onClick={() => go('topic', { mode: 'topic', subject: weakQ.subject, topic_ids: [weak.tid], count: 10, feedback: 'instant' })}>
            <IcArrowRight /><span className="grow"><b>{busy === 'topic' ? 'Preparing…' : `Practise ${names.get(weak.tid) ?? 'your weakest topic'}`}</b><small className="num">Your weakest topic here ({weak.c}/{weak.n}) · 10 new questions</small></span><IcNext className="chev" />
          </button>
        ) : wrong === 0 && oneSubject ? (
          <button className="r-row" disabled={!!busy} onClick={() => go('more', { mode: 'mixed', subjects: [{ code: oneSubject, count: 10 }], feedback: 'instant' })}>
            <IcArrowRight /><span className="grow"><b>{busy === 'more' ? 'Preparing…' : `10 more ${subjectName(oneSubject)} questions`}</b><small>Keep the momentum</small></span><IcNext className="chev" />
          </button>
        ) : null}
      </section>

      {/* 3. Where exactly? */}
      {(topics.length > 0 || lines.length > 0) && (
        <section className="r-break" aria-labelledby="r-break-h">
          <h2 id="r-break-h">Breakdown</h2>
          {topics.length > 0 && (
            <ul className="r-topics">
              {topics.slice(0, 5).map((t) => (
                <li key={t.tid}>
                  <span className="grow">{names.get(t.tid) ?? 'Topic'}</span>
                  <span className="r-bar sm" aria-hidden="true"><i className={t.pct >= 0.7 ? 'good' : t.pct < 0.4 ? 'low' : 'mid'} style={{ width: `${Math.round(t.pct * 100)}%` }} /></span>
                  <b className="num">{t.c}/{t.n}</b>
                </li>
              ))}
            </ul>
          )}
          {topics.length > 5 && <p className="muted small">and {topics.length - 5} more topics. See them all in the review.</p>}
          {lines.length > 0 && <ul className="r-lines">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          {!guest && <Link className="gold-link small" to="/progress">See your progress over time <IcArrowRight /></Link>}
        </section>
      )}

      {att?.server?.status === 'rejected' && <p className="error">This attempt was not accepted by the server ({att.server.reject_reason}). It still counts as practice.</p>}
      {quizLike && <ClassesNudge band={msg.band} subject={oneSubject} />}
      {quizLike && <PushPrompt where="result" />}

      {firstRun
        ? <Link className="btn btn-block" to="/install">Next: keep KAIRO on your phone</Link>
        : <Link className="btn btn-ghost btn-block" to="/">Back to home</Link>}
    </div>
  );
}

function Top({ title, att }: { title: string; att: LocalAttempt | null }) {
  return (
    <header className="r-top">
      <Link to="/" className="icon-btn" aria-label="Close and go home"><IcClose /></Link>
      <div className="grow"><p className="eyebrow">Result</p><p className="r-title">{title}</p></div>
      {att && <SyncPill state={att.sync} onRetry={() => flushOutbox(true)} />}
    </header>
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

/** "#59 of 430" once the server has marked the attempt; a short note when the paper is not ranked. */
function RankRow({ id, quizId }: { id: string; quizId?: string }) {
  const [b, setB] = useState<PaperBoard | null>(null);
  useEffect(() => { loadPaperBoard(id, 3).then(setB).catch(() => setB(null)); }, [id]);
  if (!b) return quizId ? <Link className="r-row" to={`/quiz/${quizId}`}><IcTrophy /><span className="grow">See the leaderboard</span><IcNext className="chev" /></Link> : null;
  if (!b.eligible) return quizId
    ? <Link className="r-row" to={`/quiz/${quizId}`}><IcTrophy /><span className="grow">See the leaderboard<small>{NOT_RANKED[b.reason]}</small></span><IcNext className="chev" /></Link>
    : <p className="muted small">{NOT_RANKED[b.reason]}</p>;
  return (
    <Link to={quizId ? `/quiz/${quizId}` : `/rank/${id}`} className="r-row r-rank" aria-label={`Your rank ${b.this.rank} of ${b.participants}. See the leaderboard`}>
      <span className="r-rank-n num">#{b.this.rank}</span>
      <span className="grow"><b>Your rank of {b.participants}</b><small>{b.this.personal_best && b.participants > 1 ? 'Your best on this paper · ' : ''}See the leaderboard</small></span>
      <IcNext className="chev" />
    </Link>
  );
}

function headline(pct: number, improved: boolean) {
  if (improved) return 'New personal best. Your work is paying off.';
  if (pct >= 80) return 'Excellent work. Keep this standard.';
  if (pct >= 60) return 'Good result. Review the ones you missed to push higher.';
  if (pct >= 40) return 'A solid start. Your review shows exactly where to improve.';
  return 'Every mistake here is one you won’t make in JAMB.';
}

export function SyncPill({ state, onRetry }: { state?: LocalAttempt['sync']; onRetry: () => void }) {
  if (state === 'synced') return <span className="badge badge-ok">Synced ✓</span>;
  if (state === 'syncing') return <span className="badge">Syncing…</span>;
  if (state === 'failed') return <button className="badge badge-bad" onClick={onRetry}>Not synced, tap to retry</button>;
  return <span className="badge">Saved on phone</span>;
}
export { to100 };
