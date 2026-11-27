import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { enablePush, pushOptedIn, pushPermission, pushSupported } from '../../lib/push';
import { cbt, friendlyError } from '../../lib/supabase';
import { Logo, Spinner, toast } from '../../ui/components';
import { IcBack } from '../../ui/icons';
import { useAuth } from '../../lib/auth';
import './notifications.css';

type Prefs = Record<'email_recaps' | 'email_classes' | 'email_updates' | 'email_achievements' | 'push_recaps' | 'push_classes' | 'push_reminders' | 'push_achievements' | 'email_all_off', boolean>;
const ROWS: { title: string; sub: string; email?: keyof Prefs; push?: keyof Prefs }[] = [
  { title: 'Weekly recap & monthly milestones', sub: 'Your week in numbers: questions, accuracy, streak, rank and what to practise next.', email: 'email_recaps', push: 'push_recaps' },
  { title: 'Daily practice reminders', sub: 'Morning quiz alert and an evening nudge if you have not practised yet.', push: 'push_reminders' },
  { title: 'Achievements', sub: 'New badges, streak milestones and Proudly KAIRO referrals.', email: 'email_achievements', push: 'push_achievements' },
  { title: 'TECHMED classes & offers', sub: 'Class reminders, attendance and enrolment offers.', email: 'email_classes', push: 'push_classes' },
  { title: 'KAIRO news', sub: 'New features and programme launches (a few times a term).', email: 'email_updates' },
];

/** Profile → Notifications: every category on or off, for email and push separately. */
export function NotificationPrefs() {
  const { session } = useAuth();
  const [p, setP] = useState<Prefs | null>(null);
  const [push, setPush] = useState(false);
  useEffect(() => {
    cbt().rpc('my_notification_prefs').then(({ data, error }) => { if (error) toast(friendlyError(error)); else setP(data as Prefs); });
    pushOptedIn().then(setPush).catch(() => setPush(false));
  }, []);
  const set = async (k: keyof Prefs, v: boolean) => {
    if (!p) return;
    const prev = p; setP({ ...p, [k]: v });
    const { data, error } = await cbt().rpc('set_notification_prefs', { p: { [k]: v } });
    if (error) { setP(prev); toast(friendlyError(error)); } else setP(data as Prefs);
  };
  const turnOnPush = async () => {
    try { const ok = await enablePush(session?.user.id); setPush(ok); if (!ok) return; toast('Notifications are on for this phone'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not turn on notifications'); }
  };
  if (!p) return <Spinner />;
  return (
    <div className="page np">
      <nav className="crumbs-lite"><Link to="/profile" className="icon-btn" aria-label="Back to profile"><IcBack /></Link></nav>
      <header className="stack-sm"><h1>Notifications</h1><p className="muted">Choose what reaches you, and where. Changes save instantly.</p></header>
      {pushSupported() && !push && (
        <section className="card np-push">
          <b>Push notifications are off on this phone</b>
          <p className="muted small">{pushPermission() === 'denied' ? 'Your browser is blocking them. Allow notifications for kairo.techmedng.com in your browser settings, then come back.' : 'Turn them on to get your daily quiz, class reminders and weekly recap the moment they land.'}</p>
          {pushPermission() !== 'denied' && <button className="btn btn-accent btn-sm" onClick={turnOnPush}>Turn on notifications</button>}
        </section>
      )}
      <section className="np-list" aria-label="Notification categories">
        <div className="np-head"><span /><span>Email</span><span>Push</span></div>
        {ROWS.map((r) => (
          <div key={r.title} className="np-row">
            <div><b>{r.title}</b><small>{r.sub}</small></div>
            <Toggle label={`${r.title} by email`} on={!!r.email && !p.email_all_off && p[r.email]} disabled={!r.email || p.email_all_off} onChange={(v) => r.email && set(r.email, v)} />
            <Toggle label={`${r.title} by push`} on={!!r.push && p[r.push]} disabled={!r.push} onChange={(v) => r.push && set(r.push, v)} />
          </div>
        ))}
      </section>
      <label className="card np-all">
        <span className="grow"><b>Pause all emails</b><small className="muted">You will still get important account emails (password resets, receipts).</small></span>
        <input type="checkbox" checked={p.email_all_off} onChange={(e) => set('email_all_off', e.target.checked)} />
      </label>
    </div>
  );
}

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  if (disabled && !on) return <span className="np-na" aria-hidden="true">—</span>;
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`np-sw ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

/** /unsubscribe?t=… — one tap from any email, no sign-in needed. */
export function Unsubscribe() {
  const [params] = useSearchParams();
  const { session } = useAuth();
  const token = params.get('t') ?? '';
  const [state, setState] = useState<{ ok: boolean; category?: string; email_hint?: string; subscribed?: boolean } | null>(null);
  const run = async (resub: boolean) => {
    const { data } = await cbt().rpc('email_unsubscribe', { p_token: token, p_resubscribe: resub });
    setState((data ?? { ok: false }) as never);
  };
  useEffect(() => { if (token) run(false); else setState({ ok: false }); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const what: Record<string, string> = { recaps: 'weekly recaps and milestones', classes: 'class and offer emails', updates: 'KAIRO news',
    achievements: 'achievement emails', all: 'all TECHMED and KAIRO emails' };
  if (!state) return <Spinner label="Updating your email settings" />;
  return (
    <div className="page no-nav np-unsub">
      <div className="brand-row"><Logo height={26} /></div>
      {state.ok ? (
        <section className="card stack-sm">
          <h1>{state.subscribed ? 'You are subscribed again' : 'You are unsubscribed'}</h1>
          <p>{state.subscribed ? 'You will get' : 'We will stop sending'} <b>{what[state.category ?? ''] ?? 'these emails'}</b> to {state.email_hint}.</p>
          {!state.subscribed && <button className="btn btn-sm" onClick={() => run(true)}>Oops, keep sending them</button>}
          <p className="muted small">Choose exactly what you get, by email and push, in <Link to={session ? '/profile/notifications' : '/signin'}>KAIRO → Profile → Notifications</Link>.</p>
        </section>
      ) : (
        <section className="card stack-sm"><h1>This link has expired</h1><p className="muted">Sign in to KAIRO and open Profile → Notifications to change your emails.</p>
          <Link className="btn btn-primary" to="/signin">Sign in</Link></section>
      )}
    </div>
  );
}
