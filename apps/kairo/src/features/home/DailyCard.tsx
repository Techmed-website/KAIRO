import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuizzes, shortTitle, type DailyQuiz } from '../daily/data';

/** Today's Daily Builder Quiz on Home (hidden until KAIRO has one). */
export function DailyCard() {
  const [q, setQ] = useState<DailyQuiz | null>(null);
  useEffect(() => { dailyQuizzes(1).then((l) => setQ(l[0] ?? null)).catch(() => {}); }, []);
  if (!q) return null;
  const today = new Date(q.opens_at).toDateString() === new Date().toDateString();
  return (
    <section className="card stack-sm daily-card">
      <p className="eyebrow">{today ? 'Today’s Daily Builder Quiz' : 'Latest Daily Builder Quiz'}</p>
      <b>{shortTitle(q.title)}</b>
      <p className="muted small num">{q.question_count} questions · {Math.round((q.time_limit_sec ?? 600) / 60)} minutes · {q.players} Builders took it</p>
      <div className="row-between">
        {q.my_best != null
          ? <><span className="badge badge-ok num">Your best: {q.my_best}/{q.question_count}</span><Link className="btn btn-sm" to={`/q/${q.id}`}>Try again</Link></>
          : <Link className="btn btn-accent btn-block" to={`/q/${q.id}`}>Take today’s quiz</Link>}
      </div>
      <Link className="small" to="/quizzes">All quizzes and leaderboards ›</Link>
    </section>
  );
}
