import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../lib/db';

/** Sitewide announcement, edited in TECHMED's Sanity Studio (the same "Announcement Banner" document as techmedng.com,
 *  using its KAIRO fields). Public read, cached on the phone so it also shows offline; no banner if unset or expired. */
interface Doc { kairoActive?: boolean; kairoMessage?: string; kairoCtaLabel?: string; kairoCtaUrl?: string; startDate?: string; endDate?: string }

const QUERY = '*[_id == "announcementBanner"][0]{kairoActive, kairoMessage, kairoCtaLabel, kairoCtaUrl, startDate, endDate}';
const URL = `https://kxoz58eb.apicdn.sanity.io/v2024-01-01/data/query/production?query=${encodeURIComponent(QUERY)}`;

export function visible(d: Doc | null | undefined, now = Date.now()): d is Doc & { kairoMessage: string } {
  if (!d?.kairoActive || !d.kairoMessage) return false;
  if (d.startDate && Date.parse(d.startDate) > now) return false;
  if (d.endDate && Date.parse(d.endDate) < now) return false;
  return true;
}

export function Banner() {
  const [d, setD] = useState<Doc | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    kvGet<Doc>('banner').then((c) => c && setD(c));
    fetch(URL).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setD(j.result ?? null); kvSet('banner', j.result ?? null); } }).catch(() => {});
  }, []);
  if (!visible(d)) return null;
  const key = `banner-dismissed:${d.kairoMessage}`;
  let dismissed = gone;
  try { dismissed ||= localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  if (dismissed) return null;
  const ext = /^https?:\/\//.test(d.kairoCtaUrl ?? '');
  return (
    <div className="banner" role="region" aria-label="Announcement">
      <p>{d.kairoMessage}{d.kairoCtaLabel && d.kairoCtaUrl && <> <a href={d.kairoCtaUrl} {...(ext ? { target: '_blank', rel: 'noopener' } : {})}>{d.kairoCtaLabel} →</a></>}</p>
      <button aria-label="Dismiss this announcement" onClick={() => { setGone(true); try { localStorage.setItem(key, '1'); } catch { /* ignore */ } }}>×</button>
    </div>
  );
}
