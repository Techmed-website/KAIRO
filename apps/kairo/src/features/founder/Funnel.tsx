import { useState } from 'react';
import { useFounder } from './Founder';
import { fmtRange, getFunnel, num, pct } from './data';
import { CoverageNote, ErrorCard, Loading } from './ui';
import { useLoad } from './useLoad';

export default function Funnel() {
  const { range, refreshKey } = useFounder();
  const [win, setWin] = useState(14);
  const { data, error, reload } = useLoad((fresh) => getFunnel(range, win, fresh), [range.from, range.to, win, refreshKey]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!data) return <Loading h={360} />;
  const first = data.stages[0]?.n ?? 0;
  let worst = -1, worstDrop = -1;
  data.stages.forEach((s, i) => { if (i > 0) { const prevN = data.stages[i - 1].n; const drop = prevN - s.n; if (prevN > 0 && drop > worstDrop) { worstDrop = drop; worst = i; } } });

  return (
    <div className="stack">
      <div className="card stack-sm">
        <p><b>Cohort:</b> students who registered {fmtRange(range)} ({num(first)}).</p>
        <label className="field"><span className="small muted">Time window after registration</span>
          <select className="input" value={win} onChange={(e) => setWin(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}</select></label>
        {data.immature > 0 && <p className="fi-note">{num(data.immature)} of these students registered less than {win} days ago and may still move further down the funnel.</p>}
        <CoverageNote range={range} since={data.coverage.events_since} what="events" />
      </div>
      {first === 0 ? <p className="card muted">No students registered in this period.</p> : (
        <ol className="fi-funnel">
          {data.stages.map((s, i) => {
            const prevN = i ? data.stages[i - 1].n : s.n;
            return (
              <li key={s.key} className={i === worst ? 'fi-worst' : ''}>
                <div className="row-between wrap"><b>{i + 1}. {s.label}</b><span className="num"><b>{num(s.n)}</b> <span className="muted small">{pct(s.n, first) ?? 0}% of cohort</span></span></div>
                <span className="fi-funnel-bar" style={{ width: `${Math.max(2, pct(s.n, first) ?? 0)}%` }} />
                {i > 0 && <p className="small muted">{pct(s.n, prevN) ?? 0}% converted from the previous stage · {num(prevN - s.n)} dropped off ({pct(prevN - s.n, prevN) ?? 0}%){i === worst ? ' · biggest drop-off' : ''}</p>}
              </li>
            );
          })}
        </ol>
      )}
      <details className="fi-def card" open><summary>How the funnel is counted</summary>
        <ol className="small">
          <li><b>Registered</b>: KAIRO profile created in the period (guests and staff excluded).</li>
          <li><b>First meaningful feature interaction</b>: qualifying activity, or opening any feature other than Home/onboarding. Feature opens are only known from when event tracking began, so for earlier cohorts this stage equals "any qualifying activity".</li>
          <li><b>First practice or quiz started</b>: an attempt started at or after stage 2.</li>
          <li><b>First practice or quiz completed</b>: an attempt started at or after stage 3 that was submitted.</li>
          <li><b>Returned on a later day</b>: qualifying activity after that completion, on a Lagos day later than the registration day.</li>
          <li><b>Consistent</b>: reached stage 5 and was active on 3+ different days.</li>
        </ol>
        <p className="small">Every stage must happen after the one before it and within the chosen window from registration. Steps done out of order do not count.</p>
      </details>
    </div>
  );
}
