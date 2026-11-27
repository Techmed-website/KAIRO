import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { markCelebrated, pendingCelebrations } from '../../lib/referral';
import { RefBadge } from './RefBadge';
import './referrals.css';

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/**
 * Lives in the app shell (never in the exam runner): a one-time celebration for each new Proudly KAIRO badge,
 * recorded on the server so it never repeats, and a dismissible launch banner for students who have not looked yet.
 */
export function RefPrompts() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const student = !!session && !session.user.is_anonymous;
  const [cel, setCel] = useState<{ code: string; title: string; activated: number }[]>([]);
  const [banner, setBanner] = useState(false);

  useEffect(() => {
    if (!student) return;
    let live = true;
    const check = () => pendingCelebrations().then((c) => live && c.length && setCel(c));
    check();
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { live = false; document.removeEventListener('visibilitychange', vis); };
  }, [student]);
  useEffect(() => {
    try { setBanner(student && !localStorage.getItem('kairo-ref-banner') && !pathname.startsWith('/referrals')); } catch { setBanner(false); }
    if (pathname.startsWith('/referrals')) try { localStorage.setItem('kairo-ref-banner', 'seen'); } catch { /* ignore */ }
  }, [student, pathname]);

  const top = cel[cel.length - 1];
  const close = () => { markCelebrated(cel.map((c) => c.code)); setCel([]); };
  const dismiss = () => { setBanner(false); try { localStorage.setItem('kairo-ref-banner', 'dismissed'); } catch { /* ignore */ } };

  return (
    <>
      {banner && !top && (
        <div className="ref-banner" role="region" aria-label="New: Proudly KAIRO">
          <RefBadge code="ref_1" size={26} label="" />
          <p><b>NEW · Proudly KAIRO.</b> Put your friends on and unlock 6 elite badges.</p>
          <Link to="/referrals" className="btn btn-sm" onClick={() => setBanner(false)}>See badges</Link>
          <button aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
      )}
      {top && (
        <div className="scrim" onClick={close}>
          <div className="ref-cel" role="dialog" aria-modal="true" aria-labelledby="ref-cel-h" onClick={(e) => e.stopPropagation()}>
            <div className="ref-cel-glow"><RefBadge code={top.code} size={140} /></div>
            <p className="ref-kicker">BADGE UNLOCKED</p>
            <h2 id="ref-cel-h">{top.title.toUpperCase()}</h2>
            <p>Congratulations! {WORDS[top.activated] ?? top.activated} {top.activated === 1 ? 'student has' : 'students have'} joined KAIRO and started learning through your referrals.</p>
            <div className="stack-sm">
              <Link to="/referrals" className="btn btn-accent btn-block" onClick={close}>See my badges</Link>
              <button className="btn btn-ghost btn-block" onClick={close}>Keep building</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Home / profile card: a compact invite prompt with progress. */
export function RefCard({ level, activated, nextTitle, remaining }: { level: string | null; activated: number; nextTitle?: string; remaining?: number }) {
  return (
    <Link to="/referrals" className="card card-link ref-card">
      <RefBadge code={level ?? 'ref_1'} size={46} locked={!level} />
      <div className="grow">
        <p className="ref-kicker">PROUDLY KAIRO</p>
        <b>{level ? 'Keep putting people on' : 'Invite friends, earn badges'}</b>
        <small className="num">{nextTitle && remaining != null ? `${activated} activated · ${remaining} more to ${nextTitle}` : `${activated} activated referrals`}</small>
      </div>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
