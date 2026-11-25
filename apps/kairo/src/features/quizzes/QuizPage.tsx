import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { toast } from '../../ui/components';
import { IcShare } from '../../ui/icons';
import { day, loadQuiz, mins, mmss, quizState, split } from './data';
import './quizzes.css';

/** One quiz inside KAIRO: what it is, your result and rank, the full leaderboard, and Start / Continue / Retake. */
export default function QuizPage() {
  const { id = '' } = useParams();
  const [q, setQ] = useState<Awaited<ReturnType<typeof loadQuiz>> | undefined>(undefined);
  const [err, setErr] = useState('');
  useEffect(() => { loadQuiz(id).then(setQ).catch((e) => { setErr(friendlyError(e)); setQ(null); }); }, [id]);

  if (q === undefined) return <div className="page"><div className="skeleton" style={{ height: 260 }} /></div>;
  if (!q) return <div className="page stack"><p className="card error">{err || 'This quiz is not available.'}</p><Link className="btn btn-block" to="/quizzes">All quizzes</Link></div>;

  const t = split(q);
  const st = quizState(q);
  const me = q.me;
  const meRow = q.board.find((r) => r.is_me);
  const share = async () => {
    const url = q.slug ? `https://techmedng.com/quizzes/${q.slug}` : `https://kairo.techmedng.com/q/${q.id}`;
    const text = `${q.title}. ${q.question_count} questions, ${mins(q.time_limit_sec)}. Can you beat me?`;
    try {
      if (navigator.share) await navigator.share({ title: q.title, text, url });
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
    } catch { /* closed the share sheet */ }
  };

  return (
    <div className="page stack quizzes">
      <Link to="/quizzes" className="small">‹ Quizzes</Link>
      <div>
        <p className="eyebrow">{q.type === 'daily_quiz' ? `DAILY BUILDER QUIZ · ${day(q.opens_at).toUpperCase()}` : q.type === 'challenge' ? 'CHALLENGE' : 'QUIZ'}</p>
        <h1>{t.heading}</h1>
        {t.sub && <p className="lead">{t.sub}</p>}
        <div className="qz-chips">
          <span>{q.question_count} questions</span><span>{mins(q.time_limit_sec)}</span>
          <span>{q.players} played</span>{q.has_passcode && <span>🔐 private</span>}
        </div>
      </div>
      {q.prize_text && <p className="card qz-prize">🏆 <b>{q.prize_text}</b>{q.max_winners ? ` · top ${q.max_winners} win` : ''}</p>}

      {me?.best != null && (
        <section className="card qz-me">
          <div><span className="muted small">Your best</span><b className="num">{me.best}/{q.question_count}</b></div>
          <div><span className="muted small">Your rank</span><b className="num">{me.rank ? `#${me.rank}` : '—'}</b></div>
          <div><span className="muted small">Attempts</span><b className="num">{me.attempts}</b></div>
          {me.last_attempt_id && <Link className="btn btn-sm" to={`/review/${me.last_attempt_id}`}>See my answers</Link>}
        </section>
      )}

      <div className="stack-sm">
        {st === 'open' && (me?.in_progress_id
          ? <Link className="btn btn-accent btn-lg btn-block" to={`/q/${q.id}`}>Continue your attempt</Link>
          : <Link className="btn btn-accent btn-lg btn-block" to={`/q/${q.id}`}>{me?.best != null ? 'Retake (practice)' : 'Start quiz'}</Link>)}
        {st === 'soon' && <p className="card">Opens {day(q.opens_at)}. Come back then.</p>}
        {st === 'closed' && <p className="muted small">This quiz has closed. Final standings below.</p>}
        <button className="btn btn-block" onClick={() => share().catch(() => toast('Could not share'))}><IcShare /> Challenge a friend</button>
      </div>

      <section className="card stack-sm">
        <div className="row-between"><h2>Leaderboard</h2><span className="muted small num">{q.ranked_count ?? q.board.length} ranked</span></div>
        {q.board.length === 0 ? <p className="muted">No scores yet. Be the first on the board.</p> : (
          <ol className="qz-board">
            {q.board.map((r, i) => (
              <li key={i} className={r.is_me ? 'me' : r.rank <= 3 ? 'top' : ''}>
                <span className="rk num">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}</span>
                <span className="nm">{r.name}{r.is_me && ' (you)'}</span>
                <span className="sc num">{r.score}/{r.total}</span>
                <span className="tm num">{mmss(r.duration_sec)}</span>
              </li>
            ))}
          </ol>
        )}
        {me && !meRow && me.best != null && <p className="muted small">Your first attempt is the one that ranks; later tries are practice.</p>}
        {(q.guest_players ?? 0) > 0 && <p className="muted small num">{q.guest_players} more played as {q.guest_players === 1 ? 'a guest' : 'guests'}. Guests join the board once they save their score with a free account.</p>}
        <p className="muted small">Ranked by score, then fastest time. Only each Builder’s first attempt counts.</p>
      </section>
    </div>
  );
}
