import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { claimRank, linkGoogle, saveGuestAccount } from '../../lib/guest';
import { friendlyError } from '../../lib/supabase';
import { toast } from '../../ui/components';
import '../review/review.css';

export type GuestSource = 'result' | 'gate' | 'bar';

/**
 * The one place a guest turns into a free account (same user id, so scores and attempts are kept).
 * Used on the result screen and as the wall in front of a second guest quiz.
 */
export function GuestSignup({ heading, lead, source, attemptId, returnTo, onSaved, id }: {
  heading: string; lead: string; source: GuestSource; attemptId?: string; returnTo: string; onSaved?: () => void; id?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; info?: string }>({});
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    track(source === 'gate' ? 'guest_gate_shown' : 'guest_prompt_shown', { props: { source } });
  }, [source]);
  const strong = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!strong) { setMsg({ err: 'Use at least 8 characters with a capital letter, a small letter, a number and a symbol.' }); return; }
    setBusy(true); setMsg({});
    try {
      const r = await saveGuestAccount(name, email, password);
      if (r === 'confirm') { setMsg({ info: `We sent a link to ${email}. Open it, then come back here to continue.` }); return; }
      if (attemptId) await claimRank(attemptId).catch(() => {});
      toast('Saved. Your account is ready.');
      onSaved?.();
    } catch (e2) {
      setMsg({ err: e2 instanceof Error && !(e2 as { code?: string }).code ? e2.message : friendlyError(e2) });
    } finally { setBusy(false); }
  };

  return (
    <section id={id} className="card stack-sm guest-save" aria-labelledby={`${id ?? 'gs'}-h`}>
      <h2 id={`${id ?? 'gs'}-h`}>{heading}</h2>
      <p className="muted small">{lead}</p>
      <button className="btn btn-block google" type="button" disabled={busy}
        onClick={() => { track('guest_prompt_shown', { props: { source: 'google_tap' } }); linkGoogle(returnTo).catch(() => setMsg({ err: 'Google sign-up is not available here yet. Use your email below.' })); }}>
        Continue with Google
      </button>
      <form className="stack-sm" onSubmit={save}>
        <input className="input" placeholder="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="email" inputMode="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password (8+ with A–Z, a–z, 0–9, symbol)" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {msg.err && <p className="error" role="alert">{msg.err}</p>}
        {msg.info && <p className="info" role="status">{msg.info}</p>}
        <button className="btn btn-accent btn-block" disabled={busy}>{busy ? 'Saving…' : 'Create my free account'}</button>
      </form>
      <p className="muted small">Already have an account? <Link to="/signin">Sign in</Link></p>
    </section>
  );
}
