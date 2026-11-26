import { useState } from 'react';
import type { SubjectCode } from '../../lib/types';
import { Sheet } from '../../ui/components';
import { OptionsPicker, suggestedSec, useStart, type Opts, type TopicStat } from './common';

const COUNTS = [10, 20, 40];

/** Question count chips. Sizes above what is available are disabled, except the smallest. */
function CountPicker({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number }) {
  return (
    <div className="opt-row"><span className="small"><b>Questions</b></span>
      <div className="chip-row">{COUNTS.map((n) => (
        <button key={n} type="button" className="chip num" aria-pressed={value === n} disabled={n > max && n !== COUNTS[0]} onClick={() => onChange(n)}>{n}</button>))}
      </div>
    </div>
  );
}

export function Progress({ stat }: { stat?: TopicStat }) {
  if (!stat || !stat.attempted) return <span className="muted small">Not practised yet</span>;
  const pct = Math.round((100 * stat.correct) / stat.attempted);
  return (
    <span className="tp-prog">
      <span className="tp-bar" aria-hidden="true"><i className={pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low'} style={{ width: `${pct}%` }} /></span>
      <span className="small num">{pct}% of {stat.attempted}</span>
    </span>
  );
}

/** One topic: its size, your progress on it, and a practice session from it. */
export function TopicSheet({ subject, topic, stat, onClose }: {
  subject: SubjectCode; topic: { id: number; name: string; count: number } | null; stat?: TopicStat; onClose: () => void;
}) {
  const { busy, start } = useStart();
  const [count, setCount] = useState(10);
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  const n = topic ? Math.min(count, topic.count) : count;
  return (
    <Sheet open={!!topic} onClose={onClose} label="Practise this topic">
      {topic && (
        <div className="sheet-body stack">
          <div className="stack-sm">
            <p className="eyebrow">Topic</p>
            <h2>{topic.name}</h2>
            <p className="muted small num">{topic.count.toLocaleString()} questions</p>
            <Progress stat={stat} />
          </div>
          <CountPicker value={count} onChange={setCount} max={topic.count} />
          <OptionsPicker value={opts} onChange={setOpts} count={n} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => start({ mode: 'topic', subject, topic_ids: [topic.id], count: n,
            feedback: opts.feedback, time_limit_sec: opts.timed ? suggestedSec(n) : null })}>{busy ? 'Preparing…' : `Start ${n} questions`}</button>
        </div>
      )}
    </Sheet>
  );
}

/** A past paper by year, in paper order. */
export function YearSheet({ subject, name, year, onClose }: { subject: SubjectCode; name: string; year: { year: number; count: number } | null; onClose: () => void }) {
  const { busy, start } = useStart();
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  return (
    <Sheet open={!!year} onClose={onClose} label="Start year paper">
      {year && (
        <div className="sheet-body stack">
          <div className="stack-sm"><p className="eyebrow">Past questions</p><h2>{name} {year.year}</h2><p className="muted small num">{year.count} questions, in paper order</p></div>
          <OptionsPicker value={opts} onChange={setOpts} count={year.count} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => start({ mode: 'year', subject, year: year.year, feedback: opts.feedback,
            time_limit_sec: opts.timed ? suggestedSec(year.count) : null })}>{busy ? 'Preparing…' : 'Start'}</button>
        </div>
      )}
    </Sheet>
  );
}

/** All questions in a subject: questions you have not seen come first, the rest at random. */
export function AllSheet({ subject, name, total, open, onClose }: { subject: SubjectCode; name: string; total: number; open: boolean; onClose: () => void }) {
  const { busy, start } = useStart();
  const [count, setCount] = useState(20);
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  const n = Math.min(count, total);
  return (
    <Sheet open={open} onClose={onClose} label={`All ${name} questions`}>
      <div className="sheet-body stack">
        <div className="stack-sm"><p className="eyebrow">All questions</p><h2>{name}</h2>
          <p className="muted small num">From all {total.toLocaleString()} questions, every year and topic. Questions you haven’t seen come first.</p></div>
        <CountPicker value={count} onChange={setCount} max={total} />
        <OptionsPicker value={opts} onChange={setOpts} count={n} />
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !total} onClick={() => start({ mode: 'mixed', subjects: [{ code: subject, count: n }],
          feedback: opts.feedback, time_limit_sec: opts.timed ? suggestedSec(n) : null })}>{busy ? 'Preparing…' : `Start ${n} questions`}</button>
      </div>
    </Sheet>
  );
}
