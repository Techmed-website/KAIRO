import type { ReactNode } from 'react';
import { IcBook, IcFlame, IcTarget } from '../../ui/icons';
import type { Progress } from '../progress/progress';
import { pct } from './data';

/** Three lifetime numbers from the server: current streak, questions answered, overall accuracy. Never invented: "–" when unknown. */
export function Snapshot({ prog }: { prog: Progress | null | undefined }) {
  if (prog === undefined) {
    return <section className="snap" aria-busy="true" aria-label="Loading your stats">{[0, 1, 2].map((i) => <div key={i} className="snap-tile skeleton" />)}</section>;
  }
  const streak = prog?.streak.current;
  const answered = prog?.questions;
  const correct = prog?.correct;
  const hasAcc = answered != null && answered > 0 && correct != null;
  return (
    <section className="snap" aria-label="Your stats">
      <Tile icon={<IcFlame />} tone="gold" value={streak == null ? '–' : `${streak} day${streak === 1 ? '' : 's'}`} label="Current streak"
        hint={prog && streak === 0 ? (prog.streak.best > 0 ? `Best: ${prog.streak.best}` : 'Practise to start') : prog && !prog.streak.today && streak ? 'Practise today' : undefined} />
      <Tile icon={<IcBook />} tone="blue" value={answered == null ? '–' : answered.toLocaleString()} label="Questions answered" hint={answered === 0 ? 'None yet' : undefined} />
      <Tile icon={<IcTarget />} tone="green" value={hasAcc ? `${pct(correct!, answered!)}%` : '–'} label="Overall accuracy" hint={prog && !hasAcc ? 'After your first answer' : undefined} />
      {prog === null && <p className="snap-note small muted">Your stats will show when you’re back online.</p>}
    </section>
  );
}

function Tile({ icon, value, label, hint, tone }: { icon: ReactNode; value: string; label: string; hint?: string; tone: 'gold' | 'blue' | 'green' }) {
  return (
    <div className={`snap-tile tone-${tone}`}>
      <span className="snap-ic" aria-hidden="true">{icon}</span>
      <b className="snap-v num">{value}</b>
      <span className="snap-l">{label}</span>
      {hint && <span className="snap-h">{hint}</span>}
    </div>
  );
}
