import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/db';
import { canInstallAndroid, isIOS, isStandalone, promptInstall } from '../../lib/install';
import { ELECTIVES, SUBJECT_NAMES } from '../../lib/subjects';
import { friendlyError, supabase } from '../../lib/supabase';
import { applyTheme, getTheme, type ThemePref } from '../../lib/theme';
import type { SubjectCode } from '../../lib/types';
import { Tabs, toast } from '../../ui/components';
import { disablePush, enablePush, pushOptedIn, pushPermission } from '../../lib/push';

export default function Profile() {
  const { profile, subjectCodes, saveProfile, session } = useAuth();
  const nav = useNavigate();
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.filter((c) => c !== 'ENG'));
  const [year, setYear] = useState(profile?.exam_year ?? 2027);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  useEffect(() => { setSubs(subjectCodes.filter((c) => c !== 'ENG')); }, [subjectCodes]);
  useEffect(() => { db.outbox.count().then(setPending); }, []);

  const save = async () => {
    setBusy(true);
    try { await saveProfile({ full_name: name.trim(), phone: phone.trim() || null, exam_year: year, subjectCodes: ['ENG', ...subs] }); toast('Saved'); }
    catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  const signOut = async () => {
    if (pending > 0 && !window.confirm?.('Some results have not synced yet. Sign out anyway?')) return;
    await supabase.auth.signOut();
    nav('/welcome', { replace: true });
  };
  const toggle = (c: SubjectCode) => setSubs((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length >= 3 ? s : [...s, c]);

  return (
    <div className="page stack">
      <h1>Profile</h1>
      {(profile?.role === 'editor' || profile?.role === 'admin') && (
<>
        <Link to="/editor/quizzes" className="card card-link row-between"><span><b>Quizzes &amp; challenges</b><br /><span className="muted small">Create, schedule, share, results</span></span><span aria-hidden="true">›</span></Link>
        <Link to="/editor" className="card card-link row-between"><span><b>Question desk</b><br /><span className="muted small">Key reviews, student reports, explanations</span></span><span aria-hidden="true">›</span></Link>
        </>
      )}
      <RemindersCard />
      <Link to="/progress" className="card card-link row-between"><span><b>Your progress</b><br /><span className="muted small">Accuracy by topic, score trend, focus topics</span></span><span aria-hidden="true">›</span></Link>
      <section className="card stack">
        <div className="field"><label htmlFor="p-name">Full name</label><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="p-phone">Phone (optional)</label><input id="p-phone" className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><span className="small"><b>Email</b></span><span className="muted">{session?.user.email}</span></div>
        <div className="stack-sm"><span className="small"><b>UTME year</b></span>
          <div className="chip-row">{[2027, 2028, 2029].map((y) => <button key={y} className="chip" aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div></div>
        <div className="stack-sm"><span className="small"><b>Subjects</b> <span className="muted">English + 3</span></span>
          <div className="chip-row">
            <button className="chip" aria-pressed disabled>English</button>
            {ELECTIVES.map((c) => <button key={c} className="chip" aria-pressed={subs.includes(c)} disabled={!subs.includes(c) && subs.length >= 3} onClick={() => toggle(c)}>{SUBJECT_NAMES[c]}</button>)}
          </div></div>
        <button className="btn btn-primary" disabled={busy || subs.length !== 3} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </section>
      <section className="card stack-sm">
        <h3>Appearance</h3>
        <Tabs value={theme} label="Theme" onChange={(t) => { setTheme(t); applyTheme(t); }}
          items={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Follow phone' }]} />
      </section>
      {!isStandalone() && (
        <section className="card stack-sm">
          <h3>Install KAIRO</h3>
          {canInstallAndroid() ? <button className="btn" onClick={() => promptInstall()}>Install on this phone</button>
            : <p className="muted small">{isIOS() ? 'In Safari, tap Share, then Add to Home Screen.' : 'Open your browser menu and tap Install app or Add to Home screen.'}</p>}
        </section>
      )}
      {pending > 0 && <p className="muted small">{pending} result{pending > 1 ? 's' : ''} waiting to sync.</p>}
      <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      <p className="muted small" style={{ textAlign: 'center' }}>KAIRO by TECHMED</p>
    </div>
  );
}

/** Daily reminders on or off (the Morning Charge at 6:00am and the evening practice reminder). */
function RemindersCard() {
  const { session } = useAuth();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'blocked' | 'unsupported'>('loading');
  useEffect(() => {
    const perm = pushPermission();
    if (perm === 'unsupported') { setState('unsupported'); return; }
    if (perm === 'denied') { setState('blocked'); return; }
    if (perm === 'default') { setState('off'); return; }
    pushOptedIn().then((on) => setState(on ? 'on' : 'off'));
  }, []);
  const toggle = async () => {
    try {
      if (state === 'on') { await disablePush(); setState('off'); toast('Daily reminders are off.'); }
      else { const ok = await enablePush(session?.user.id); setState(ok ? 'on' : 'blocked'); toast(ok ? 'Daily reminders are on.' : 'Notifications are blocked in your browser settings.'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change reminders.'); }
  };
  if (state === 'unsupported' || state === 'loading') return null;
  return (
    <section className="card row-between">
      <span><b>Daily reminders</b><br /><span className="muted small">{state === 'blocked' ? 'Blocked in your browser settings' : 'Morning Charge at 6:00am, practice reminder in the evening'}</span></span>
      {state !== 'blocked' && <button className={`btn btn-sm ${state === 'on' ? '' : 'btn-accent'}`} onClick={toggle}>{state === 'on' ? 'Turn off' : 'Turn on'}</button>}
    </section>
  );
}
