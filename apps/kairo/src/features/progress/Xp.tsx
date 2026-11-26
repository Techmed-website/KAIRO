import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BadgeMedal } from './Badges';
import { levelProgress, onCelebrate, type Celebration, type Xp } from './progress';
import './xp.css';

/** Level, XP and the way to the next level. */
export function XpCard({ xp, title = 'Your experience' }: { xp: Xp; title?: string }) {
  const pct = Math.round(levelProgress(xp) * 100);
  const toGo = Math.max(0, xp.next - xp.total);
  return (
    <section className="xp-card" aria-label={`Level ${xp.level}, ${xp.total} XP`}>
      <div className="row-between"><span className="xp-label">{title}</span><span className="xp-level">Level {xp.level} · {xp.tier}</span></div>
      <b className="xp-total num">{xp.total.toLocaleString()} XP</b>
      <div className="xp-bar" role="progressbar" aria-label="Progress to the next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      <div className="row-between xp-foot small">
        <span className="num">{toGo.toLocaleString()} XP to Level {xp.level + 1}</span>
        <span className="num">+{xp.today} today · +{xp.week} this week</span>
      </div>
    </section>
  );
}

/** Lives in the app shell (never inside the exam): a short, dismissible celebration for new badges or a new level. */
export function Celebrations() {
  const [queue, setQueue] = useState<Celebration[]>([]);
  useEffect(() => onCelebrate((c) => setQueue((q) => [...q, c])), []);
  const cur = queue[0];
  const close = () => setQueue((q) => q.slice(1));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cur) return;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cur]);
  if (!cur) return null;
  const shown = cur.badges.slice(0, 3);
  const heading = cur.level ? `Level ${cur.level}!` : cur.badges.length > 1 ? `${cur.badges.length} new achievements` : 'Achievement unlocked';
  return createPortal(
    <div className="cel-scrim" onClick={close}>
      <div className="cel" role="dialog" aria-modal="true" aria-labelledby="cel-h" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        {cur.level
          ? <div className="cel-level num" aria-hidden="true">{cur.level}</div>
          : <div className="cel-medals">{shown.map((b) => <BadgeMedal key={b.code} b={b} size={shown.length > 1 ? 60 : 84} />)}</div>}
        <h2 id="cel-h">{heading}</h2>
        {cur.level
          ? <p className="muted">You are now a {cur.tier} Builder. Every question you answer moves you closer to the next level.</p>
          : <ul className="cel-list">{shown.map((b) => <li key={b.code}><b>{b.title}</b><span className="muted small">{b.description}</span></li>)}
              {cur.badges.length > 3 && <li className="muted small">and {cur.badges.length - 3} more</li>}</ul>}
        {cur.badges.length > 0 && <p className="cel-xp num">+{25 * cur.badges.length} XP</p>}
        {cur.level && cur.badges.length > 0 && <p className="muted small">Plus {cur.badges.length} new achievement{cur.badges.length > 1 ? 's' : ''}.</p>}
        <div className="cel-actions">
          <button className="btn btn-accent btn-block" onClick={close}>Keep going</button>
          <Link className="btn btn-ghost btn-block" to="/achievements" onClick={close}>See all achievements</Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
