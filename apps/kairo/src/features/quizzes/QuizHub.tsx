import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kvGet, kvSet } from '../../lib/db';
import { friendlyError } from '../../lib/supabase';
import { day, loadHub, mins, quizState, split, type Hub, type QuizCard } from './data';
import './quizzes.css';

/** The Quizzes tab: today's Daily Builder Quiz, live challenges, and every recent quiz with your score. */
export default function QuizHub() {
  const [hub, setHub] = useState<Hub | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    kvGet<Hub>('quiz-hub').then((c) => c && setHub((h) => h ?? c));          // last copy first: works offline
    loadHub().then((h) => { setHub(h); kvSet('quiz-hub', h); }).catch((e) => setErr(friendlyError(e)));
  }, []);

  return (
    <div className="page stack quizzes">
      <div className="stack-sm">
        <h1>Quizzes</h1>
        <p className="muted small">A new Daily Builder Quiz every morning. Your first try goes on the leaderboard; retakes are practice.</p>
      </div>
      {err && !hub && <p className="card error">{err}</p>}
      {!hub ? <div className="skeleton" style={{ height: 220 }} /> : <>
        {hub.today ? <TodayCard q={hub.today} /> : <p className="card muted">Today’s quiz opens at 4:30am.</p>}

        {hub.challenges.length > 0 && <section className="stack-sm">
          <h2>Challenges</h2>
          {hub.challenges.map((q) => <Row key={q.id} q={q} />)}
        </section>}

        <section className="stack-sm">
          <h2>Recent quizzes</h2>
          {hub.recent.filter((q) => q.id !== hub.today?.id).map((q) => <Row key={q.id} q={q} />)}
          {hub.recent.length <= 1 && <p className="muted small">Past quizzes appear here.</p>}
        </section>
      </>}
    </div>
  );
}

function TodayCard({ q }: { q: QuizCard }) {
  const t = split(q);
  const me = q.me;
  return (
    <section className="qz-today">
      <p className="eyebrow">TODAY’S DAILY BUILDER QUIZ</p>
      <h2>{t.heading}</h2>
      {t.sub && <p className="qz-sub">{t.sub}</p>}
      <p className="qz-meta num">{q.question_count} questions · {mins(q.time_limit_sec)} · {q.players} {q.players === 1 ? 'Builder' : 'Builders'} played</p>
      {me?.in_progress_id ? (
        <Link className="btn btn-accent btn-block" to={`/q/${q.id}`}>Continue your attempt</Link>
      ) : me?.best != null ? (
        <>
          <p className="qz-mine num">Your score <b>{me.best}/{q.question_count}</b>{me.rank ? <> · rank <b>#{me.rank}</b> of {q.players}</> : null}</p>
          <div className="row">
            <Link className="btn btn-accent grow" to={`/quiz/${q.id}`}>Leaderboard</Link>
            <Link className="btn grow qz-ghost" to={`/q/${q.id}`}>Retake</Link>
          </div>
        </>
      ) : (
        <Link className="btn btn-accent btn-block" to={`/q/${q.id}`}>Start today’s quiz</Link>
      )}
      <Link className="qz-link" to={`/quiz/${q.id}`}>See the leaderboard ›</Link>
    </section>
  );
}

function Row({ q }: { q: QuizCard }) {
  const t = split(q);
  const st = quizState(q);
  return (
    <Link to={`/quiz/${q.id}`} className="card card-link qz-row">
      <div className="grow">
        <b>{t.heading}</b>{t.sub && <span className="muted small block">{t.sub}</span>}
        <span className="muted small block num">
          {q.type === 'daily_quiz' ? day(q.opens_at) : st === 'soon' ? `Opens ${day(q.opens_at)}` : st === 'closed' ? 'Closed' : 'Open now'}
          {' · '}{q.question_count} q · {q.players} played{q.prize_text ? ` · 🏆 ${q.prize_text}` : ''}{q.has_passcode ? ' · 🔐' : ''}
        </span>
      </div>
      {q.me?.best != null
        ? <span className="badge badge-ok num">{q.me.best}/{q.question_count}{q.me.rank ? ` · #${q.me.rank}` : ''}</span>
        : <span className="badge">{st === 'closed' ? 'Results' : st === 'soon' ? 'Soon' : 'Start'}</span>}
    </Link>
  );
}
