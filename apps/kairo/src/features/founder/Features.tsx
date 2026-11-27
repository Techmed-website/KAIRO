import { useState } from 'react';
import { useFounder } from './Founder';
import { fmtRange, getFeatures, num, pct, type FeatureRow } from './data';
import { CoverageNote, ErrorCard, Loading, ShareBar } from './ui';
import { useLoad } from './useLoad';

type Sort = 'users' | 'starters' | 'rate' | 'repeat' | 'returned';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'users', label: 'Unique users' }, { value: 'starters', label: 'Started primary action' },
  { value: 'rate', label: 'Completion rate' }, { value: 'repeat', label: 'Repeat usage' }, { value: 'returned', label: 'Students who came back' },
];
const rate = (f: FeatureRow) => (f.primary_kind === 'attempt' ? pct(f.completions, f.starts) : null);
const metric = (f: FeatureRow, s: Sort) => s === 'users' ? f.users : s === 'starters' ? f.starters ?? -1 : s === 'rate' ? rate(f) ?? -1
  : s === 'repeat' ? pct(f.repeat_users, f.users) ?? -1 : pct(f.returned_users, f.users) ?? -1;

export default function Features() {
  const { range, refreshKey } = useFounder();
  const { data, error, reload } = useLoad((fresh) => getFeatures(range, fresh), [range.from, range.to, refreshKey]);
  const [sort, setSort] = useState<Sort>('users');
  const [compare, setCompare] = useState(false);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!data) return <Loading h={420} />;
  const prev = new Map(data.previous.map((f) => [f.feature, f]));
  const rows = [...data.current].sort((a, b) => metric(b, sort) - metric(a, sort));
  const lowCompletion = data.current.filter((f) => (f.starts ?? 0) >= 5 && (rate(f) ?? 100) < 50);

  return (
    <div className="stack">
      <CoverageNote range={range} since={data.coverage.events_since} what="events" />
      <div className="card stack-sm">
        <label className="field"><span className="small muted">Rank features by</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="row small"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with {fmtRange({ from: data.period.prev_from, to: data.period.prev_to })}</label>
        <p className="muted small">Features are never ranked by raw clicks. Starts and completions for practice, quizzes and mocks come from KAIRO's attempt records (complete history). Opens and the other features' actions come from product events, recorded from the release of this dashboard onwards.</p>
      </div>
      {lowCompletion.length > 0 && <p className="card fi-flag small"><b>High starts, low completion:</b> {lowCompletion.map((f) => `${f.label} (${num(f.completions)} of ${num(f.starts)})`).join(' · ')}</p>}
      <div className="fi-table-wrap card"><table className="fi-table fi-feat">
        <thead><tr><th>Feature</th><th className="num">Unique users</th><th className="num">Opens</th><th className="num">Started</th><th className="num">Completed</th>
          <th>Completion rate</th><th className="num">Abandoned</th><th className="num">Repeat users</th><th className="num">Came back later</th></tr></thead>
        <tbody>{rows.map((f) => { const p = prev.get(f.feature); return (
          <tr key={f.feature}>
            <th scope="row">{f.label}<span className="muted small fi-kind">{f.primary_kind === 'attempt' ? 'records' : f.primary_kind === 'event' ? `action: ${f.primary_event?.replace(/_/g, ' ')}` : 'views only'}</span></th>
            <td className="num">{num(f.users)}{compare && p && <Prev v={p.users} />}</td>
            <td className="num">{num(f.opens)}{compare && p && <Prev v={p.opens} />}</td>
            <td className="num">{f.starts == null ? '—' : `${num(f.starts)} (${num(f.starters)})`}{compare && p && p.starts != null && <Prev v={p.starts} />}</td>
            <td className="num">{f.completions == null ? '—' : `${num(f.completions)} (${num(f.completers)})`}{compare && p && p.completions != null && <Prev v={p.completions} />}</td>
            <td>{f.primary_kind === 'attempt' ? <ShareBar value={rate(f)} /> : <span className="muted">—</span>}</td>
            <td className="num">{f.abandoned == null ? '—' : num(f.abandoned)}</td>
            <td className="num">{num(f.repeat_users)}<span className="muted small"> {f.users ? `${pct(f.repeat_users, f.users)}%` : ''}</span></td>
            <td className="num">{num(f.returned_users)}<span className="muted small"> {f.users ? `${pct(f.returned_users, f.users)}%` : ''}</span></td>
          </tr>); })}</tbody>
      </table></div>
      <details className="fi-def card"><summary>Column definitions</summary>
        <ul className="small">
          <li><b>Unique users</b>: students who opened the feature or started its primary action in the period.</li>
          <li><b>Opens</b>: page views of the feature (product events).</li>
          <li><b>Started / Completed</b>: sessions started in the period and how many were submitted; students in brackets.</li>
          <li><b>Abandoned</b>: started, never submitted, and open for more than 24 hours (or past the timer).</li>
          <li><b>Repeat users</b>: used the feature on 2+ different Lagos days in the period.</li>
          <li><b>Came back later</b>: had qualifying activity anywhere in KAIRO on a later day than their first use of this feature in the period — a sign of features associated with returning students.</li>
        </ul>
      </details>
    </div>
  );
}
const Prev = ({ v }: { v: number | null }) => <span className="fi-prev">prev {num(v)}</span>;
