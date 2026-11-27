import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useFounder } from './Founder';
import { describe, FEATURE_LABEL, fmtDateTime, fmtTime, getFeed, lagosToday, type FeedItem } from './data';
import { ErrorCard, Loading } from './ui';

const KINDS = [
  { value: 'registered', label: 'Registrations' }, { value: 'started', label: 'Starts' }, { value: 'completed', label: 'Completions' },
  { value: 'event', label: 'Actions' }, { value: 'opened', label: 'Page opens' },
];
type Conn = 'connecting' | 'live' | 'polling' | 'offline';

/** Newest first. New rows arrive through Supabase Realtime (one channel, admin-only rows), with a 60 s fallback poll. */
export default function Live() {
  const { range, refreshKey } = useFounder();
  const [kinds, setKinds] = useState<string[]>([]);
  const [feature, setFeature] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<Conn>('connecting');
  const [updated, setUpdated] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const filters = useRef({ kinds, feature, range });
  filters.current = { kinds, feature, range };
  const isToday = range.to >= lagosToday();

  const loadTop = useCallback(async () => {
    const f = filters.current;
    try {
      const r = await getFeed({ limit: 50, kinds: f.kinds, feature: f.feature || null, from: f.range.from, to: f.range.to });
      setItems((old) => {
        const seen = new Set(old.map(key));
        const added = r.items.filter((i) => !seen.has(key(i))).length;
        if (old.length && added) setFresh((n) => n + added);
        // keep older pages that were already loaded beneath the refreshed top
        const top = new Set(r.items.map(key));
        return [...r.items, ...old.filter((i) => !top.has(key(i)) && i.at < (r.items[r.items.length - 1]?.at ?? ''))].slice(0, 500);
      });
      setMore(r.items.length === 50); setUpdated(r.generated_at); setError(null);
    } catch (e) { setError(e); }
    setLoading(false);
  }, []);

  useEffect(() => { setItems([]); setLoading(true); setFresh(0); loadTop(); }, [kinds, feature, range.from, range.to, refreshKey, loadTop]);

  // Realtime: any new product event triggers a (debounced) refresh of the merged feed. Attempts and registrations
  // live in other tables, so the fallback poll also catches those when nobody is navigating.
  useEffect(() => {
    if (!isToday) { setConn('offline'); return; }
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) return; t = setTimeout(() => { t = null; if (document.visibilityState === 'visible') loadTop(); }, 2500); };
    const ch = supabase.channel('founder-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'cbt', table: 'events' }, bump)
      .subscribe((s) => setConn(s === 'SUBSCRIBED' ? 'live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'polling' : s === 'CLOSED' ? 'offline' : 'connecting'));
    const poll = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) loadTop(); }, 60_000);
    const vis = () => { if (document.visibilityState === 'visible') loadTop(); };
    document.addEventListener('visibilitychange', vis);
    return () => { supabase.removeChannel(ch); clearInterval(poll); if (t) clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
  }, [isToday, loadTop]);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const r = await getFeed({ before: last.at, limit: 50, kinds, feature: feature || null, from: range.from, to: range.to });
      const seen = new Set(items.map(key));
      setItems([...items, ...r.items.filter((i) => !seen.has(key(i)))].slice(0, 500));
      setMore(r.items.length === 50 && items.length < 500);
    } catch (e) { setError(e); }
  };

  const toggleKind = (k: string) => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);
  const status = !isToday ? 'Historical period: live updates off'
    : conn === 'live' ? 'Live' : conn === 'polling' ? 'Realtime unavailable: refreshing every minute' : conn === 'offline' ? 'Disconnected' : 'Connecting…';

  return (
    <div className="stack">
      <div className="row-between wrap">
        <p className={`fi-conn fi-conn-${isToday ? conn : 'offline'}`} role="status"><i aria-hidden="true" />{status}</p>
        <p className="muted small">{updated ? `Last updated ${fmtTime(updated)}` : ''}</p>
      </div>
      <div className="card stack-sm">
        <div className="chip-row" role="group" aria-label="Event type">
          {KINDS.map((k) => <button key={k.value} type="button" className={`chip ${kinds.includes(k.value) ? 'chip-on' : ''}`} aria-pressed={kinds.includes(k.value)} onClick={() => toggleKind(k.value)}>{k.label}</button>)}
        </div>
        <label className="field"><span className="small muted">Feature</span>
          <select className="input" value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">All features</option>
            {Object.entries(FEATURE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <p className="muted small">Registrations, starts and completions come from KAIRO's own records. Actions and page opens are product events, collected from the Founder Intelligence release onwards. Students are shown by name (or code when no name is set; G- = guest).</p>
      </div>
      {fresh > 0 && <button className="btn btn-sm" onClick={() => { setFresh(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{fresh} new — back to top</button>}
      {error ? <ErrorCard error={error} onRetry={loadTop} /> : null}
      {loading ? <Loading h={320} /> : items.length === 0 ? <p className="card muted">No activity matches this period and these filters (zero activity, not missing data).</p> : (
        <ol className="fi-feed">
          {items.map((i) => (
            <li key={key(i)} className={`fi-feed-item fi-k-${i.kind}`}>
              <time dateTime={i.at} title={fmtDateTime(i.at)}>{range.from === range.to ? fmtTime(i.at) : fmtDateTime(i.at)}</time>
              <span className="grow"><b>{i.student_name || i.student}</b> {describe(i)}</span>
              {i.feature && <span className="badge">{FEATURE_LABEL[i.feature] ?? i.feature}</span>}
            </li>
          ))}
        </ol>
      )}
      {!loading && more && items.length > 0 && items.length < 500 && <button className="btn btn-sm" onClick={loadMore}>Load older activity</button>}
      {items.length >= 500 && <p className="muted small">Showing the latest 500 items. Narrow the period or filters to see older ones.</p>}
    </div>
  );
}
const key = (i: FeedItem) => `${i.kind}:${i.name}:${i.user_id}:${i.at}`;
