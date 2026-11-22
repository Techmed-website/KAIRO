import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { Spinner } from '../../ui/components';
import { dailyQuizzes, shortTitle, type DailyQuiz } from './data';

/** Every Daily Builder Quiz so far, newest first, with your best score. */
export default function DailyList() {
  const [list, setList] = useState<DailyQuiz[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { dailyQuizzes(60).then(setList).catch((e) => setErr(friendlyError(e))); }, []);
  if (err) return <div className="page"><p className="card error">{err}</p></div>;
  if (!list) return <Spinner />;
  return (
    <div className="page stack">
      <div className="stack-sm">
        <h1>Daily Builder Quiz</h1>
        <p className="muted small">A new quiz every day at 6:00 am. Answers and explanations right after you submit.</p>
      </div>
      {list.length === 0 && <p className="card">The first KAIRO daily quiz opens at 6:00 am.</p>}
      {list.map((q) => (
        <Link key={q.id} to={`/q/${q.id}`} className="card row-between" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="grow"><b>{shortTitle(q.title)}</b>
            <span className="muted small" style={{ display: 'block' }}>
              {new Date(q.opens_at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })} · {q.question_count} questions · {q.players} took it
            </span></span>
          {q.my_best != null ? <span className="badge badge-ok num">{q.my_best}/{q.question_count}</span> : <span className="badge">Start</span>}
        </Link>
      ))}
    </div>
  );
}
