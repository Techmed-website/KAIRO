import { Link } from 'react-router-dom';
import { IcArrowRight, IcBolt, IcCheckCircle, IcFlame, IcTarget } from '../../ui/icons';
import { dailyState, pct, type HomeQuiz } from './data';

interface Props {
  q: HomeQuiz | null | undefined;
  failed: boolean;
  onRetry: () => void;
  /** Current streak from the server, shown on the completed card. */
  streak: number | null;
  onPractise: () => void;
}

/** The Daily Builder Quiz card: loading, error, none today, ready, in progress, completed. */
export function DailyCard({ q, failed, onRetry, streak, onPractise }: Props) {
  const state = dailyState(q, failed);

  if (state === 'loading') return <section className="daily daily-skel" aria-busy="true" aria-label="Loading today’s quiz"><div className="skeleton" /></section>;

  if (state === 'error') {
    return (
      <section className="daily" aria-label="Daily Builder Quiz">
        <p className="daily-eyebrow">Daily Builder Quiz</p>
        <h2 className="daily-h">We couldn’t load today’s quiz.</h2>
        <p className="daily-sub">Check your connection and try again.</p>
        <button className="btn btn-accent btn-block" onClick={onRetry}>Try again</button>
      </section>
    );
  }

  const meta = q ? [q.subject && (q.topic_label ? `${q.subject} · ${q.topic_label}` : q.subject), q.time_limit_sec ? `${Math.round(q.time_limit_sec / 60)} min` : null].filter(Boolean) : [];

  if (state === 'none') {
    return (
      <section className="daily" aria-label="Daily Builder Quiz">
        <div className="daily-top"><p className="daily-eyebrow">Daily Builder Quiz</p><span className="daily-ic" aria-hidden="true"><IcTarget /></span></div>
        <h2 className="daily-h">Today’s quiz is on its way.</h2>
        <p className="daily-sub">A new Daily Builder Quiz opens every morning. Warm up with 10 questions from a subject you pick while you wait.</p>
        <button className="btn btn-accent btn-block daily-cta" onClick={onPractise}><IcBolt />Practise 10 questions</button>
        {q && <Link className="daily-link" to={`/quiz/${q.id}`}>See the last quiz{q.day_number ? ` (Day ${q.day_number})` : ''} <IcArrowRight /></Link>}
      </section>
    );
  }

  const quiz = q!;
  const n = quiz.question_count;

  if (state === 'done') {
    const r = quiz.result!;
    const total = r.total || n;
    return (
      <section className="daily daily-done" aria-label="Daily Builder Quiz completed">
        <div className="daily-top">
          <p className="daily-eyebrow">Daily Builder Quiz{quiz.day_number ? ` · Day ${quiz.day_number}` : ''}</p>
          <span className="done-mark" aria-hidden="true"><IcCheckCircle /></span>
        </div>
        <h2 className="daily-h">Today’s challenge completed!</h2>
        <p className="daily-sub">You’ve shown up. That’s what Builders do.</p>
        <dl className={`done-stats ${streak != null && streak > 0 ? 'n4' : 'n3'}`}>
          <div><dt>Score</dt><dd className="num">{r.score}/{total}</dd></div>
          <div><dt>Accuracy</dt><dd className="num">{pct(r.score, total)}%</dd></div>
          <div><dt>Answered</dt><dd className="num">{r.answered}/{total}</dd></div>
          {streak != null && streak > 0 && <div><dt>Streak</dt><dd className="num"><IcFlame className="flame" />{streak} day{streak === 1 ? '' : 's'}</dd></div>}
        </dl>
        {quiz.best != null && quiz.best > r.score && <p className="daily-sub small num">Best on a retry: {quiz.best}/{total}. Your first attempt is the one ranked.</p>}
        <button className="btn btn-accent btn-block daily-cta" onClick={onPractise}><IcBolt />Practise 10 more questions</button>
        <Link className="daily-link" to={`/quiz/${quiz.id}`}>See your result and rank <IcArrowRight /></Link>
      </section>
    );
  }

  const answered = state === 'in_progress' ? quiz.in_progress!.answered : 0;
  return (
    <section className="daily" aria-label="Daily Builder Quiz">
      <div className="daily-top">
        <p className="daily-eyebrow">Daily Builder Quiz{quiz.day_number ? ` · Day ${quiz.day_number}` : ''}</p>
        <span className="daily-pill num">{n} questions</span>
      </div>
      <h2 className="daily-h">{state === 'in_progress' ? 'You’ve started today’s quiz.' : 'Today’s quiz is ready.'}</h2>
      <p className="daily-sub">{state === 'in_progress' ? 'Pick up where you stopped before the timer runs out.' : `${n} questions. One step closer to your goal.`}</p>
      {meta.length > 0 && <p className="daily-meta">{meta.join(' · ')}{quiz.players > 0 ? ` · ${quiz.players.toLocaleString()} Builder${quiz.players === 1 ? '' : 's'} took it` : ''}</p>}
      <div className="daily-progress">
        <div className="row-between small"><span className="num"><b>{answered}</b>/{n}</span><span>{state === 'in_progress' ? 'answered so far' : 'completed today'}</span></div>
        <div className="bar" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={n} aria-valuenow={answered}>
          <i style={{ width: `${pct(answered, n)}%` }} />
        </div>
      </div>
      <Link className="btn btn-accent btn-block btn-lg daily-cta" to={`/q/${quiz.id}`}>
        <IcBolt />{state === 'in_progress' ? 'Resume today’s quiz' : 'Start today’s quiz'}<IcArrowRight />
      </Link>
    </section>
  );
}
