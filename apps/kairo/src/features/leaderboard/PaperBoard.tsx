import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { Spinner } from '../../ui/components';
import { BoardList, subjectLine, time } from './BoardList';
import { loadPaperBoard, NOT_RANKED, scopeLabel, type PaperBoard as Board } from './paper';
import './leaderboard.css';

/** Leaderboard for the paper behind one attempt: the student's rank, a podium and everyone's subject-by-subject scores. */
export default function PaperBoard() {
  const { id = '' } = useParams();
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadPaperBoard(id, 100).then(setB).catch((e) => setErr(friendlyError(e))); }, [id]);

  if (err) return <div className="page"><p className="card error">{err}</p></div>;
  if (!b) return <Spinner label="Ranking" />;
  if (!b.eligible) return (
    <div className="page stack"><h1>Paper ranking</h1><p className="card">{NOT_RANKED[b.reason]}</p>
      <Link className="btn btn-ghost btn-block" to={`/result/${id}`}>Back to result</Link></div>
  );
  const breakdown = b.max > 100;
  const meOnList = b.rows.some((r) => r.is_me);
  return (
    <div className="page stack lb">
      <div className="stack-sm">
        <p className="eyebrow">{scopeLabel(b)}</p>
        <h1>Paper ranking</h1>
      </div>
      <section className="card rank-card" aria-label="Your rank">
        <span className="rank-big num">#{b.this.rank}</span>
        <div className="grow">
          <b>of {b.participants} {b.participants === 1 ? 'student' : 'students'}</b>
          <p className="muted small num">{b.this.score}/{b.max}{b.this.duration_sec ? ` · ${time(b.this.duration_sec)}` : ''}{breakdown ? ` · ${subjectLine(b.this)}` : ''}</p>
          {!b.this.personal_best && b.me && <p className="muted small num">Your best on this paper: #{b.me.rank} with {b.me.score}/{b.max}</p>}
        </div>
      </section>
      <p className="muted small">Ranked by score, then by time. Each student counts once, with their best attempt.</p>
      <BoardList rows={b.rows} max={b.max} breakdown={breakdown} />
      {!meOnList && b.me && <p className="muted small num">You: #{b.me.rank} · {b.me.score}/{b.max}</p>}
      <Link className="btn btn-ghost btn-block" to={`/result/${id}`}>Back to result</Link>
    </div>
  );
}
