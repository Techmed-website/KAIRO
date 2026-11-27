import { useState, type ReactNode } from 'react';
import { friendlyError } from '../../lib/supabase';
import { fmtDay, fmtShortDay, num, type Coverage, type Range } from './data';

/** Change against the previous equivalent period; null when there is nothing honest to compare with. */
export function Delta({ cur, prev, comparable, invert = false }: { cur: number | null; prev: number | null; comparable: boolean; invert?: boolean }) {
  if (!comparable || cur == null || prev == null) return <span className="fi-delta fi-delta-na">no earlier data to compare</span>;
  if (prev === 0 && cur === 0) return <span className="fi-delta">no change (0 → 0)</span>;
  const diff = cur - prev;
  const up = diff > 0;
  const good = invert ? !up : up;
  const label = prev === 0 ? `+${num(cur)} (from 0)` : `${up ? '+' : ''}${Math.round((100 * diff) / prev)}% vs ${num(prev)}`;
  return <span className={`fi-delta ${diff === 0 ? '' : good ? 'fi-up' : 'fi-down'}`}><span aria-hidden="true">{diff === 0 ? '→' : up ? '▲' : '▼'}</span> {diff === 0 ? `no change (${num(prev)})` : label}</span>;
}

export function Kpi({ label, value, sub, def, delta, state }: { label: string; value: ReactNode; sub?: ReactNode; def: string; delta?: ReactNode; state?: ReactNode }) {
  return (
    <article className="fi-kpi">
      <h3 className="fi-kpi-label">{label}</h3>
      <p className="fi-kpi-value num">{value}</p>
      {sub && <p className="fi-kpi-sub">{sub}</p>}
      {delta}
      {state}
      <details className="fi-def"><summary>Definition</summary><p>{def}</p></details>
    </article>
  );
}

export function Loading({ h = 240 }: { h?: number }) { return <div className="skeleton" style={{ height: h }} aria-label="Loading" />; }

export function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = friendlyError(error);
  const denied = /admins only|42501|permission/i.test(msg);
  return (
    <div className="card fi-error" role="alert">
      <p><b>{denied ? 'Founder analytics are for the KAIRO admin account only.' : 'Could not load this report.'}</b></p>
      <p className="muted small">{msg}</p>
      {!denied && <button className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Says when part of the period predates the data that a metric needs. */
export function CoverageNote({ range, since, what }: { range: Range; since: string | null; what: 'events' | 'records' }) {
  if (!since) return <p className="fi-note">{what === 'events' ? 'Data still being collected: product event tracking has not recorded anything yet.' : 'No records yet.'}</p>;
  if (range.to < since) return <p className="fi-note">Unavailable for this period: {what === 'events' ? 'event tracking' : 'records'} start on {fmtDay(since)}.</p>;
  if (range.from < since) return <p className="fi-note">{what === 'events' ? 'Collecting since' : 'Records start'} {fmtDay(since)}; earlier days in this period have no {what === 'events' ? 'event' : ''} data.</p>;
  return null;
}
export const eventsCovered = (c: Coverage, r: Range) => !!c.events_since && r.from >= c.events_since;

export interface Series { key: string; label: string; color: string; values: number[] }

/** Multi-series line chart (one y-axis, starting at zero), crosshair tooltip, legend, and a table view. */
export function LineChart({ labels, series, height = 200, title }: { labels: string[]; series: Series[]; height?: number; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640, H = height, L = 36, R = 12, T = 12, B = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (labels.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v: number) => T + ((top - v) * (H - T - B)) / top;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.max(1, Math.ceil(labels.length / 7));
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect(); const sx = ((clientX - r.left) / r.width) * W;
    let best = 0; labels.forEach((_, i) => { if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i; }); setHover(best);
  };
  return (
    <figure className="fi-chart">
      <div className="row-between wrap">
        <ul className="fi-legend" aria-label="Series">{series.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>)}</ul>
        <button className="btn btn-ghost btn-sm" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {table ? (
        <div className="fi-table-wrap"><table className="fi-table">
          <caption className="sr-only">{title}</caption>
          <thead><tr><th>Date</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr></thead>
          <tbody>{labels.map((l, i) => <tr key={l}><td>{fmtShortDay(l)}</td>{series.map((s) => <td key={s.key} className="num">{num(s.values[i])}</td>)}</tr>)}</tbody>
        </table></div>
      ) : (
        <div className="fi-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="fi-grid" />
                <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fi-axis">{v}</text></g>
            ))}
            {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
              <text key={l} x={x(i)} y={H - 6} textAnchor="middle" className="fi-axis">{fmtShortDay(l)}</text>))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="fi-cross" />}
            {series.map((s) => (
              <g key={s.key}>
                {labels.length > 1 && <path d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                  fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {s.values.map((v, i) => (labels.length === 1 || i === hover || i === labels.length - 1) && (
                  <circle key={i} cx={x(i)} cy={y(v)} r={i === hover ? 5 : 4} fill={s.color} className="fi-dot" />))}
              </g>
            ))}
          </svg>
          {hover !== null && (
            <div className="fi-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
              <b>{fmtDay(labels[hover])}</b>
              {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}: <b className="num">{num(s.values[hover])}</b></span>)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
function niceStep(max: number) {
  const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); const n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}

/** A horizontal bar for a share (0–100%), with its value printed beside it. */
export function ShareBar({ value, label }: { value: number | null; label?: string }) {
  return (
    <span className="fi-bar" title={label}>
      <span className="fi-bar-track"><span className="fi-bar-fill" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></span>
      <span className="num fi-bar-val">{value == null ? '—' : `${value}%`}</span>
    </span>
  );
}
