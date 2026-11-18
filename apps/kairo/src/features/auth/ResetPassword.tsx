import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { friendlyError, supabase } from '../../lib/supabase';
import { Logo, Spinner, toast } from '../../ui/components';
import '../onboarding/onboarding.css';

const strong = (p: string) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

/** Landing page of the "reset password" email: the link signs the student in; here they choose a new password. */
export default function ResetPassword() {
  const { session, loading, endRecovery } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/signin" replace />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (!strong(pw)) { setErr('Use at least 8 characters with a capital letter, a small letter, a number and a symbol.'); return; }
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    endRecovery(); toast('Password changed. You are signed in.'); nav('/', { replace: true });
  };
  return (
    <div className="page no-nav auth">
      <span className="brand-row"><Logo height={30} /></span>
      <form className="stack" onSubmit={save}>
        <div className="stack-sm"><h1>Choose a new password</h1><p className="muted">This also changes your TECHMED password.</p></div>
        <div className="field"><label htmlFor="pw">New password</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw2">Type it again</label>
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
        <p className="muted small">8+ characters with A–Z, a–z, 0–9 and a symbol {strong(pw) ? '✓' : ''}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
