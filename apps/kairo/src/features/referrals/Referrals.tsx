import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { canNativeShare, claimPendingReferral, copy, loadMyReferrals, markCelebrated, referralUrl, shareNative, shareWhatsApp, type MyReferrals } from '../../lib/referral';
import { friendlyError } from '../../lib/supabase';
import { Sheet, toast } from '../../ui/components';
import { IcBack, IcShare, IcTrophy } from '../../ui/icons';
import { REF_LEVELS, RefBadge, refLevel } from './RefBadge';
import './referrals.css';

const STATS: { key: keyof MyReferrals['stats']; label: string; help: string }[] = [
  { key: 'visits', label: 'Link visits', help: 'Times your link was opened (repeat opens from one phone within an hour count once).' },
  { key: 'registrations', label: 'Signed up', help: 'Friends who created a brand-new KAIRO account through you.' },
  { key: 'activated', label: 'Activated', help: 'Friends who finished a practice, quiz or mock with at least 10 answered questions. Only these count for badges.' },
  { key: 'retained', label: 'Came back', help: 'Activated friends who learned again on a later day. Real impact.' },
];

/** PROUDLY KAIRO: your link, your numbers, your badges. Recognition only: no money, no prizes. */
export default function Referrals() {
  const { session } = useAuth();
  const [d, setD] = useState<MyReferrals | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => loadMyReferrals().then((r) => { setD(r); setErr(''); }).catch((e) => { setErr(friendlyError(e)); setD((x) => x ?? null); });
  useEffect(() => { load(); }, []);
  // Celebrations on this page are shown inline (the badge collection), so mark them seen here.
  useEffect(() => { if (d?.celebrate?.length) markCelebrated(d.celebrate.map((c) => c.code)); }, [d?.celebrate]);

  if (d === undefined) return <div className="page refp"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 300 }} /></div>;
  if (!d) return <div className="page refp"><p className="card">{err || 'Your referral dashboard opens when you are online.'}</p></div>;

  const link = d.code ? referralUrl(d.code) : '';
  const n = d.stats.activated;
  const cur = refLevel(d.level);
  const prevGoal = cur?.goal ?? 0;
  const pct = d.next ? Math.round((100 * (n - prevGoal)) / (d.next.goal - prevGoal)) : 100;
  const earned = new Map(d.badges.map((b) => [b.code, b.earned_at]));
  const openBadge = open ? d.badges.find((b) => b.code === open) : null;

  const enter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const s = await claimPendingReferral(session.user.id, session.user.created_at, code);
    setBusy(false);
    const msg: Record<string, string> = {
      recorded: 'Done! Your friend gets the credit once you finish your first practice (10+ questions).',
      under_review: 'Got it. This one is being checked by the KAIRO team.',
      self_referral: 'That is your own code. Nice try 😄', invalid_code: 'That code does not exist. Check the spelling.',
      existing_account: 'Invite codes are for accounts in their first 7 days.', already_referred: 'You are already linked to a friend.',
      paused: 'Invites are paused right now. Try again soon.', circular: 'You referred this friend, so they cannot refer you back.',
    };
    toast(msg[s ?? ''] ?? 'Could not check that code. Try again.');
    if (s && s !== 'invalid_code') load();
  };

  return (
    <div className="page refp">
      <nav className="crumbs-lite"><Link to="/profile" className="icon-btn" aria-label="Back to profile"><IcBack /></Link></nav>

      <header className="ref-hero">
        <p className="ref-kicker">PROUDLY KAIRO</p>
        <h1>Learn. Refer. Inspire.</h1>
        <p>Invite your friends to experience smarter CBT practice. Help more students discover KAIRO, and earn badges the whole community can see.</p>
        <div className="ref-hero-badge">
          {cur ? <RefBadge code={cur.code} size={72} /> : <RefBadge code="ref_1" size={72} locked />}
          <div>
            <b>{cur ? cur.title.toUpperCase() : 'No badge yet'}</b>
            <span className="num">{n} activated referral{n === 1 ? '' : 's'}</span>
          </div>
        </div>
      </header>

      {!d.enabled && <p className="card ref-paused">Invites are paused for now. Your badges and numbers are safe, and new sign-ups will count again when invites reopen.</p>}

      <section className="card stack-sm ref-share" aria-labelledby="h-link">
        <h2 id="h-link">Your invite link</h2>
        {d.code ? <>
          <div className="ref-code-row">
            <div className="ref-code"><small>Your code</small><b className="num">{d.code}</b></div>
            <button className="btn btn-sm" onClick={async () => toast((await copy(d.code!, 'code')) ? 'Code copied' : 'Copy failed')}>Copy code</button>
          </div>
          <div className="ref-link num" aria-label="Your invite link">{link}</div>
          <div className="ref-actions">
            <button className="btn btn-accent ref-wa" onClick={() => shareWhatsApp(link)}>Share on WhatsApp</button>
            <button className="btn" onClick={async () => toast((await copy(link, 'link')) ? 'Link copied. Drop it in your class group 👀' : 'Copy failed')}>Copy link</button>
            {canNativeShare() && <button className="btn" onClick={() => shareNative(link)}><IcShare /> More</button>}
          </div>
          <p className="muted small">A friend counts when they sign up with your link (or code) and finish their first practice, quiz or mock with 10+ questions.</p>
        </> : <p className="muted">Your code is being set up. Pull to refresh in a moment.</p>}
      </section>

      <section className="stack-sm" aria-labelledby="h-stats">
        <h2 id="h-stats">Your impact</h2>
        <div className="ref-stats">
          {STATS.map((s) => (
            <details key={s.key} className={`ref-stat ${s.key === 'activated' ? 'hl' : ''}`}>
              <summary><b className="num">{d.stats[s.key].toLocaleString()}</b><span>{s.label}</span></summary>
              <p>{s.help}</p>
            </details>
          ))}
        </div>
        {d.stats.under_review > 0 && <p className="muted small">{d.stats.under_review} sign-up{d.stats.under_review === 1 ? ' is' : 's are'} being checked by the KAIRO team before counting.</p>}
      </section>

      <section className="card stack-sm ref-next" aria-labelledby="h-next">
        <h2 id="h-next">{cur ? cur.title.toUpperCase() : 'Your first badge'}</h2>
        {d.next ? <>
          <p className="num"><b>{n} of {d.next.goal}</b> activated referrals</p>
          <div className="ref-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
          <p className="muted small num">{d.next.remaining} more activated referral{d.next.remaining === 1 ? '' : 's'} to unlock <b>{d.next.title.toUpperCase()}</b>.</p>
        </> : <p>You hold every Proudly KAIRO badge. Absolute icon behaviour. 💎</p>}
      </section>

      <section className="stack-sm" aria-labelledby="h-coll">
        <div className="sec-head"><h2 id="h-coll">Badge collection</h2><span className="muted small num">{d.badges.filter((b) => b.earned_at).length}/6</span></div>
        <div className="ref-grid">
          {REF_LEVELS.map((l) => {
            const at = earned.get(l.code);
            return (
              <button key={l.code} className={`ref-tile ${at ? 'got' : ''}`} onClick={() => setOpen(l.code)} aria-label={`${l.title}: ${at ? 'earned' : `${l.goal} activated referrals needed`}`}>
                <RefBadge code={l.code} size={58} locked={!at} />
                <b>{l.title}</b>
                <small className="num">{at ? `Earned ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : `${l.goal} referral${l.goal === 1 ? '' : 's'}`}</small>
              </button>
            );
          })}
        </div>
      </section>

      {d.friends.length > 0 && (
        <section className="stack-sm" aria-labelledby="h-hist">
          <h2 id="h-hist">Your journey</h2>
          <ol className="ref-hist">
            {d.badges.filter((b) => b.earned_at).sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? '')).map((b) => (
              <li key={b.code} className="ref-hist-badge"><RefBadge code={b.code} size={26} /><span className="grow"><b>{b.title}</b> unlocked</span>
                <time className="muted small">{new Date(b.earned_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time></li>
            ))}
            {d.friends.map((f, i) => (
              <li key={i}><span className="ref-dot" aria-hidden="true">{f.retained ? '🔥' : f.activated ? '✅' : f.under_review ? '🔎' : '👋'}</span>
                <span className="grow">A friend {f.retained ? 'is learning regularly' : f.activated ? 'started learning' : f.under_review ? 'signed up (being checked)' : 'signed up'}</span>
                <time className="muted small">{new Date(f.joined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time></li>
            ))}
          </ol>
          <p className="muted small">Friends stay private: you never see their names or contact details.</p>
        </section>
      )}

      {d.can_enter_code && (
        <form className="card stack-sm" onSubmit={enter} aria-labelledby="h-got">
          <h2 id="h-got">Got invited by a friend?</h2>
          <p className="muted small">Enter their code so they get the credit. Works in your first 7 days on KAIRO.</p>
          <div className="row"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ADA7K2Q" autoCapitalize="characters" aria-label="Friend's invite code" />
            <button className="btn btn-sm" disabled={busy || code.trim().length < 4}>{busy ? 'Checking…' : 'Apply'}</button></div>
        </form>
      )}

      <Link to="/ambassadors" className="card card-link ref-board-link"><IcTrophy /><span className="grow"><b>KAIRO Ambassadors</b><small>See who is bringing the most students</small></span><span aria-hidden="true">›</span></Link>
      <p className="muted small ref-fine">Proudly KAIRO is recognition only: badges, status and leaderboards. There are no cash, data, gift or prize rewards.</p>

      <Sheet open={!!openBadge} onClose={() => setOpen(null)} label={openBadge?.title ?? 'Badge'}>
        {openBadge && (
          <div className="sheet-body ref-detail">
            <RefBadge code={openBadge.code} size={120} locked={!openBadge.earned_at} />
            <h2>{openBadge.title.toUpperCase()}</h2>
            <p className="muted">{openBadge.description}</p>
            <p className="ref-milestone num">{openBadge.goal} activated referral{openBadge.goal === 1 ? '' : 's'}</p>
            {openBadge.earned_at
              ? <p className="ach-got">Earned {new Date(openBadge.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              : <p className="small num">{Math.min(n, openBadge.goal)} of {openBadge.goal} so far</p>}
            <button className="btn btn-block" onClick={() => setOpen(null)}>Close</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
