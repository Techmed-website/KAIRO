import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dailyQuizzes, shortTitle, type DailyQuiz } from '../daily/data';
import { WeekStrip } from '../progress/Badges';
import { streakLine, type Streak } from '../progress/progress';

/** The big card at the top of Home: your streak this week and today's Daily Builder Quiz. */
export function HeroCard({ streak, onQuick, busy }: { streak: Streak | null; onQuick: () => void; busy: boolean }) {
  const [q, setQ] = useState<DailyQuiz | null | undefined>(undefined);
  useEffect(() => { dailyQuizzes(1).then((l) => setQ(l[0] ?? null)).catch(() => setQ(null)); }, []);
  const today = q && new Date(q.opens_at).toDateString() === new Date().toDateString();
  return (
    <section className="hero-card">
      <div className="row-between">
        <p className="eyebrow">{streak && streak.current > 0 ? `🔥 ${streak.current}-day streak` : 'Your week'}</p>
        {streak && streak.best > 0 && <span className="small hero-dim num">Best: {streak.best}</span>}
      </div>
      {streak && <WeekStrip s={streak} />}
      {streak && <p className="small hero-dim">{streakLine(streak)}</p>}
      <div className="hero-quiz">
        {q === undefined ? <div className="skeleton" style={{ height: 56 }} /> : q ? (
          <>
            <p className="eyebrow">{today ? 'Today’s Daily Builder Quiz' : 'Latest Daily Builder Quiz'}</p>
            <b className="hero-title">{shortTitle(q.title)}</b>
            <p className="small hero-dim num">{q.question_count} questions · {Math.round((q.time_limit_sec ?? 600) / 60)} min · {q.players} Builders took it</p>
            {q.my_best != null
              ? <div className="row-between"><span className="badge badge-ok num">Your best: {q.my_best}/{q.question_count}</span><Link className="btn btn-sm btn-accent" to={`/q/${q.id}`}>Try again</Link></div>
              : <Link className="btn btn-accent btn-block" to={`/q/${q.id}`}>Take today’s quiz</Link>}
          </>
        ) : null}
        <button className="btn btn-block hero-quick" onClick={onQuick} disabled={busy}>{busy ? 'Picking questions…' : '⚡ 10 quick questions from your subjects'}</button>
      </div>
    </section>
  );
}
