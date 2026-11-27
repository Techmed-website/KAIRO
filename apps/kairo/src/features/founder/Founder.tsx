import { useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../ui/components';
import { clearCache, daysBetween, fmtRange, lagosToday, PRESETS, presetRange, RELAUNCH, type Preset, type Range } from './data';
import './founder.css';

export interface FounderCtx { range: Range; refreshKey: number }
export const useFounder = () => useOutletContext<FounderCtx>();

const TABS = [
  { to: '/founder', label: 'Overview', end: true }, { to: '/founder/live', label: 'Live Activity' },
  { to: '/founder/engagement', label: 'Engagement & Retention' }, { to: '/founder/features', label: 'Feature Performance' },
  { to: '/founder/funnel', label: 'Conversion Funnel' }, { to: '/founder/students', label: 'Student Explorer' },
];

/** KAIRO admin only. The server refuses every fi_* call from anyone else; this just keeps them out of the screens. */
export default function Founder() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const today = lagosToday();

  const range = useMemo<Range>(() => {
    const p = (params.get('p') as Preset) || 'relaunch';
    if (p === 'custom') {
      const from = params.get('from') || RELAUNCH; const to = params.get('to') || today;
      return { from: from <= to ? from : to, to: from <= to ? to : from, preset: 'custom' };
    }
    return presetRange(PRESETS.some((x) => x.value === p) ? p : 'relaunch', today);
  }, [params, today]);

  if (!profile) return <Spinner />;
  if (profile.role !== 'admin') return <Navigate to="/" replace />;

  const setPreset = (p: Preset) => {
    const next = new URLSearchParams(params);
    next.set('p', p);
    if (p === 'custom') { next.set('from', range.from); next.set('to', range.to); } else { next.delete('from'); next.delete('to'); }
    setParams(next, { replace: true });
  };
  const setCustom = (k: 'from' | 'to', v: string) => {
    if (!v) return;
    const next = new URLSearchParams(params);
    next.set('p', 'custom'); next.set('from', k === 'from' ? v : range.from); next.set('to', k === 'to' ? v : range.to);
    setParams(next, { replace: true });
  };
  const days = daysBetween(range.from, range.to) + 1;
  const qs = params.toString() ? `?${params.toString()}` : '';

  return (
    <div className="page fi">
      <header className="stack-sm">
        <p className="eyebrow">KAIRO admin</p>
        <div className="row-between wrap"><h1>Founder Intelligence</h1>
          <button className="btn btn-sm" onClick={() => { clearCache(); setRefreshKey((k) => k + 1); }}>Refresh</button></div>
      </header>

      <nav className="fi-tabs" aria-label="Founder Intelligence">
        {TABS.map((t) => <NavLink key={t.to} to={t.to + qs} end={t.end} className={({ isActive }) => `chip ${isActive ? 'chip-on' : ''}`}>{t.label}</NavLink>)}
      </nav>

      <section className="fi-toolbar card" aria-label="Reporting period">
        <div className="chip-scroll" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" className={`chip ${range.preset === p.value ? 'chip-on' : ''}`} aria-pressed={range.preset === p.value}
              onClick={() => setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        {range.preset === 'custom' && (
          <div className="row wrap fi-dates">
            <label className="field"><span className="small muted">From</span>
              <input className="input" type="date" value={range.from} min="2026-01-01" max={today} onChange={(e) => setCustom('from', e.target.value)} /></label>
            <label className="field"><span className="small muted">To</span>
              <input className="input" type="date" value={range.to} min="2026-01-01" max={today} onChange={(e) => setCustom('to', e.target.value)} /></label>
          </div>
        )}
        <p className="fi-period"><b>{fmtRange(range)}</b> <span className="muted">· {days} day{days === 1 ? '' : 's'} · Lagos time (WAT){range.to === today ? ' · today is still in progress' : ''}</span></p>
      </section>

      <Outlet context={{ range, refreshKey } satisfies FounderCtx} />
    </div>
  );
}
