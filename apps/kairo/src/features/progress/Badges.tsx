import type { ComponentType, SVGProps } from 'react';
import { IcBook, IcCalendarCheck, IcCap, IcClipboard, IcCompass, IcFlag, IcFlame, IcLock, IcMedal, IcStar, IcTarget, IcTrendUp, IcTrophy } from '../../ui/icons';
import type { Badge, Streak } from './progress';
import './progress.css';

type Ic = ComponentType<SVGProps<SVGSVGElement>>;
const BY_CODE: Record<string, Ic> = {
  first_quiz: IcFlag, perfect: IcStar, rising: IcTrendUp, top_10: IcMedal, weekly_top10: IcMedal, weekly_champion: IcTrophy, topic_master: IcCap,
};
const BY_PREFIX: [string, Ic][] = [['streak_', IcFlame], ['daily_', IcCalendarCheck], ['questions_', IcBook], ['accuracy_', IcTarget],
  ['mock', IcClipboard], ['all_subjects', IcCompass], ['topics_', IcCompass]];
export const badgeIcon = (code: string): Ic => BY_CODE[code] ?? BY_PREFIX.find(([p]) => code.startsWith(p))?.[1] ?? IcMedal;

/** A badge as a medallion: category colour, line icon; locked badges are muted with a lock. */
export function BadgeMedal({ b, size = 56 }: { b: Badge; size?: number }) {
  const I = badgeIcon(b.code);
  return (
    <span className={`medal c-${b.category ?? 'practice'} ${b.earned_at ? 'earned' : 'locked'}`} style={{ width: size, height: size }} aria-hidden="true">
      <I />
      {!b.earned_at && <span className="medal-lock"><IcLock /></span>}
    </span>
  );
}

/** One badge in a grid: medallion, name, and either the date earned or progress towards it. */
export function BadgeTile({ b, onOpen }: { b: Badge; onOpen?: (b: Badge) => void }) {
  const pct = b.goal && b.progress != null ? Math.round((100 * b.progress) / b.goal) : null;
  return (
    <button type="button" className={`btile ${b.earned_at ? 'earned' : ''}`} onClick={() => onOpen?.(b)}
      aria-label={`${b.title}. ${b.earned_at ? 'Earned' : 'Locked'}. ${b.description}`}>
      <BadgeMedal b={b} />
      <b>{b.title}</b>
      {b.earned_at
        ? <span className="btile-sub">{new Date(b.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        : pct != null
          ? <><span className="btile-sub num">{b.progress?.toLocaleString()}/{b.goal?.toLocaleString()}</span><span className="btile-bar"><i style={{ width: `${pct}%` }} /></span></>
          : <span className="btile-sub">{shortHow(b)}</span>}
    </button>
  );
}
const shortHow = (b: Badge) => b.description.replace(/\.$/, '').slice(0, 42);

/** Seven dots for the last seven days, today last. */
export function WeekStrip({ s }: { s: Streak }) {
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().getDay();
  return (
    <div className="week-strip" aria-label={`Practised ${s.week.filter(Boolean).length} of the last 7 days`}>
      {s.week.map((on, i) => (
        <span key={i} className={`wk ${on ? 'on' : ''} ${i === 6 ? 'is-today' : ''}`}>
          <i aria-hidden="true">{on ? <IcFlame /> : null}</i><small>{DAYS[(today + i + 1) % 7]}</small>
        </span>
      ))}
    </div>
  );
}
