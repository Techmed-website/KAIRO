import type { Badge, Streak } from './progress';
import './progress.css';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Seven dots for the last seven days, today last. */
export function WeekStrip({ s }: { s: Streak }) {
  const today = new Date().getDay();
  return (
    <div className="week-strip" aria-label={`Practised ${s.week.filter(Boolean).length} of the last 7 days`}>
      {s.week.map((on, i) => (
        <span key={i} className={`wk ${on ? 'on' : ''} ${i === 6 ? 'is-today' : ''}`}>
          <i aria-hidden="true">{on ? '🔥' : ''}</i><small>{DAYS[(today + i + 1) % 7]}</small>
        </span>
      ))}
    </div>
  );
}

export function BadgeGrid({ badges }: { badges: Badge[] }) {
  return (
    <div className="badge-grid">
      {badges.map((b) => (
        <div key={b.code} className={`bdg ${b.earned_at ? 'earned' : ''}`} title={b.description}>
          <span className="bdg-icon" aria-hidden="true">{b.icon}</span>
          <b>{b.title}</b>
          <span className="muted small">{b.earned_at
            ? new Date(b.earned_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            : b.goal && b.progress != null ? `${b.progress}/${b.goal}` : b.description}</span>
          {!b.earned_at && b.goal && b.progress != null && <span className="bdg-meter"><i style={{ width: `${(100 * b.progress) / b.goal}%` }} /></span>}
        </div>
      ))}
    </div>
  );
}

/** "New badge!" banner on the result screen. */
export function NewBadges({ badges, codes }: { badges: Badge[]; codes: string[] }) {
  const list = badges.filter((b) => codes.includes(b.code));
  if (!list.length) return null;
  return (
    <section className="card new-badges" role="status">
      <p className="eyebrow">{list.length > 1 ? 'New badges' : 'New badge'}</p>
      {list.map((b) => (
        <div key={b.code} className="row-gap"><span className="bdg-icon big" aria-hidden="true">{b.icon}</span>
          <span><b>{b.title}</b><br /><span className="muted small">{b.description}</span></span></div>
      ))}
    </section>
  );
}
