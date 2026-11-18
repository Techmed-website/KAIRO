import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { friendlyError, supabase } from '../../lib/supabase';
import { Logo } from '../../ui/components';
import '../onboarding/onboarding.css';

export default function SignIn() {
  const { session } = useAuth();
  const loc = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>((loc.state as { mode?: 'signup' } | null)?.mode ?? 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; info?: string }>({});

  if (session) return <Navigate to="/" replace />;

  const google = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } });
    if (error) { setMsg({ err: friendlyError(error) }); setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg({});
    if (mode === 'signup' && !strong(password)) { setMsg({ err: 'Use at least 8 characters with a capital letter, a small letter, a number and a symbol.' }); setBusy(false); return; }
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ err: /invalid/i.test(error.message) ? 'That email and password do not match. Try again or reset your password.' : friendlyError(error) });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name.trim() }, emailRedirectTo: `${location.origin}/` } });
      if (error) setMsg({ err: friendlyError(error) });
      else if (!data.session) setMsg({ info: `We sent a link to ${email}. Open it to finish creating your account.` });
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!email) { setMsg({ err: 'Type your email first, then tap “Forgot password”.' }); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
    setMsg(error ? { err: friendlyError(error) } : { info: `If ${email} has an account, a reset link is on its way.` });
  };

  return (
    <div className="page no-nav auth">
      <Link to="/welcome" className="brand-row" aria-label="KAIRO home"><Logo height={30} /></Link>
      <div className="stack">
        <div className="stack-sm">
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">Your TECHMED account works here too.</p>
        </div>
        <button className="btn btn-lg btn-block google" onClick={google} disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.4-.2-2.1H12v4h6c-.1 1-.8 2.6-2.4 3.6v3h3.9c2.2-2.1 3.1-5.1 3.1-8.5z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.9-3c-1 .7-2.3 1.2-3.4 1.2-2.6 0-4.9-1.8-5.7-4.2h-4v3.1C4.1 20.6 7.8 23 12 23z"/><path fill="#FBBC05" d="M6.3 14.3a7 7 0 0 1 0-4.6V6.6h-4a11 11 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 6.6l4 3.1C7.1 7.2 9.4 5.4 12 5.4z"/></svg>
          Continue with Google
        </button>
        <div className="or"><span>or use email</span></div>
        <form className="stack" onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field"><label htmlFor="name">Full name</label>
              <input id="name" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div className="field"><label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" minLength={mode === 'signup' ? 8 : 6} required aria-describedby={mode === 'signup' ? 'pw-hint' : undefined} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'signup' && <span id="pw-hint" className={`small ${password && !strong(password) ? 'muted' : 'muted'}`}>8+ characters with A–Z, a–z, 0–9 and a symbol {strong(password) ? '✓' : ''}</span>}</div>
          {msg.err && <p className="error" role="alert">{msg.err}</p>}
          {msg.info && <p className="info" role="status">{msg.info}</p>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div className="row-between small">
          <button className="btn-link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg({}); }}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}</button>
          {mode === 'signin' && <button className="btn-link" onClick={reset}>Forgot password</button>}
        </div>
      </div>
    </div>
  );
}

const strong = (p: string) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
