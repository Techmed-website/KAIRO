import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { Spinner } from '../../ui/components';
import { IcBack, IcNext } from '../../ui/icons';
import { changePct, loadMyRecaps, periodLabel, type MyRecaps, type Recap as R } from './data';
import './recap.css';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** /recap: the latest weekly or monthly recap in full, plus every earlier one. */
export default function Recap() {
  const [d, setD] = useState<MyRecaps | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useSearchParams();
  useEffect(() => { loadMyRecaps().then(setD).catch((e) => setErr(friendlyError(e))); }, []);
  if (err) return <div className="page"><p className="muted">{err}</p></div>;
  if (!d) return <Spinner />;
  const pick = q.get('p');
  const shown = (pick && d.history.find((h) => `${h.kind}-${h.period_start}` === pick)) || d.latest;
  return (
    <div className="page rc">
      <nav className="crumbs-lite"><Link to="/" className="icon-btn" aria-label="Back to home"><IcBack /></Link></nav>
      <header className="stack-sm"><h1>Your recaps</h1><p className="muted">Every Monday you get last week in numbers, and on the 1st your month. Here is what you did and what to do next.</p></header>
      {shown ? <RecapView r={shown} /> : (
        <section className="card stack-sm">
          <b>Your first recap lands on Monday morning</b>
          <p className="muted small">Practise this week and we will show you your questions, accuracy, streak, how you rank and the topic to fix next.</p>
          <Link to="/practice" className="btn btn-accent btn-sm">Start practising</Link>
        </section>
      )}
      {d.history.length > 1 && (
        <section className="stack-sm" aria-labelledby="rc-h">
          <h2 id="rc-h">Earlier recaps</h2>
          <div className="rc-hist">
            {d.history.map((h) => {
              const key = `${h.kind}-${h.period_start}`;
              const on = shown && key === `${shown.kind}-${shown.period_start}`;
              return (
                <button key={key} className={`rc-hrow${on ? ' on' : ''}`} onClick={() => { setQ({ p: key }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <span><b>{h.kind === 'week' ? 'Week' : 'Month'} · {periodLabel(h)}</b><small className="num">{h.data.questions.toLocaleString()} questions{h.data.accuracy != null ? ` · ${h.data.accuracy}%` : ''}</small></span>
                  <IcNext aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function RecapView({ r }: { r: R }) {
  const x = r.data; const unit = r.kind;
  const ch = changePct(x.questions, x.prev_questions);
  if (!x.questions) {
    return (
      <section className="card rc-hero stack-sm">
        <p className="eyebrow">{unit === 'week' ? 'Your week' : 'Your month'} · {periodLabel(r)}</p>
        <h2>No practice logged this {unit}.</h2>
        <p className="muted">Ten questions a day adds up to 3,600 by exam day.{x.streak.best ? ` Your best streak is ${x.streak.best} days. Beat it.` : ''}</p>
        <Link to="/quizzes" className="btn btn-accent">Take today’s 5-minute quiz</Link>
      </section>
    );
  }
  return (
    <>
      <section className="card rc-hero stack-sm">
        <p className="eyebrow">{unit === 'week' ? 'Your week' : 'Your month'} · {periodLabel(r)}</p>
        <h2 className="num">{x.questions.toLocaleString()} questions answered {x.questions >= 200 ? '🔥' : '💪'}</h2>
        <p className="rc-sub num">
          {ch != null && <span className={ch >= 0 ? 'up' : 'down'}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch)}% vs last {unit}</span>}
          {x.beat_pct != null && x.beat_pct >= 50 && <span> · more than <b>{x.beat_pct}%</b> of KAIRO students</span>}
        </p>
        {unit === 'week' && x.day_map && (
          <div className="rc-days" aria-label={`${x.active_days} of 7 days active`}>
            {x.day_map.map((on, i) => <span key={i} className={on ? 'on' : ''}><i>{on ? '✓' : ''}</i>{DAYS[i]}</span>)}
          </div>
        )}
      </section>
      <div className="rc-tiles num">
        <Tile big={x.accuracy != null ? `${x.accuracy}%` : '–'} label="accuracy" sub={x.accuracy != null && x.prev_accuracy != null ? (x.accuracy >= x.prev_accuracy ? `▲ ${x.accuracy - x.prev_accuracy} pts` : `▼ ${x.prev_accuracy - x.accuracy} pts`) : undefined} up={x.accuracy != null && x.prev_accuracy != null ? x.accuracy >= x.prev_accuracy : undefined} />
        <Tile big={`${x.minutes.toLocaleString()} min`} label="focused practice" />
        <Tile big={`${x.active_days}${unit === 'week' ? '/7' : ''}`} label="days active" />
        <Tile big={`🔥 ${x.streak.current}`} label="day streak" sub={x.streak.best > x.streak.current ? `best ${x.streak.best}` : undefined} />
        <Tile big={`+${x.xp.toLocaleString()}`} label="XP earned" />
        <Tile big={x.sessions.toLocaleString()} label="sessions finished" sub={x.mocks ? `incl. ${x.mocks} mock${x.mocks > 1 ? 's' : ''}` : undefined} />
      </div>
      {x.attendance && x.attendance.held > 0 && (
        <section className="card rc-att">
          <b>🎓 TECHMED classes</b>
          <p className="num">You attended <b>{x.attendance.attended} of {x.attendance.held}</b> live classes{x.attendance.rate != null ? ` (${x.attendance.rate}%)` : ''}.</p>
          <p className="muted small">{x.attendance.attended < x.attendance.held ? 'Check in at every class on your TECHMED dashboard. Consistency is the edge.' : 'Perfect attendance. Respect. 🙌'}</p>
        </section>
      )}
      {x.subjects.length > 0 && (
        <section className="card stack-sm">
          <b>By subject</b>
          {x.subjects.map((s) => (
            <div key={s.code} className="rc-bar">
              <span>{s.name}</span>
              <span className="rc-track"><i style={{ width: `${Math.max(3, s.accuracy)}%` }} /></span>
              <span className="num small">{s.accuracy}% · {s.n}</span>
            </div>
          ))}
        </section>
      )}
      {(x.strong_topic || x.badges.length > 0) && (
        <section className="card stack-sm">
          {x.strong_topic && <p>💪 <b>Strongest topic:</b> {x.strong_topic.name} ({x.strong_topic.accuracy}%)</p>}
          {x.badges.length > 0 && <p>🏅 <b>New badges:</b> {x.badges.join(', ')}</p>}
        </section>
      )}
      {x.focus_topic ? (
        <section className="card rc-next stack-sm">
          <p className="eyebrow">Your next move</p>
          <h3>Fix “{x.focus_topic.name}”</h3>
          <p className="small">You got {x.focus_topic.accuracy}% here this {unit}. Ten targeted questions with explanations will move it fast.</p>
          <Link to={`/practice/${x.focus_topic.code}/topics`} className="btn btn-accent">Practise it now</Link>
        </section>
      ) : <Link to="/practice" className="btn btn-accent">Keep the run going</Link>}
    </>
  );
}

function Tile({ big, label, sub, up }: { big: string; label: string; sub?: string; up?: boolean }) {
  return <div className="rc-tile"><b>{big}</b><span>{label}</span>{sub && <small className={up === undefined ? '' : up ? 'up' : 'down'}>{sub}</small>}</div>;
}
