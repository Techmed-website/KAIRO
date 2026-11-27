import { useEffect, useState, type ReactNode } from 'react';
import { RefBadge } from '../referrals/RefBadge';
import { HomeRefCard as RefCardLite } from '../referrals/HomeRefCard';
import { flush, track } from '../../lib/analytics';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/db';
import { canInstallAndroid, isIOS, isStandalone, promptInstall } from '../../lib/install';
import { ELECTIVES, SUBJECT_NAMES } from '../../lib/subjects';
import { friendlyError, supabase } from '../../lib/supabase';
import { applyTheme, getTheme, type ThemePref } from '../../lib/theme';
import type { SubjectCode } from '../../lib/types';
import { Tabs, toast } from '../../ui/components';
import { IcArrowRight, IcBack, IcBell, IcBook, IcChart, IcClipboard, IcFlame, IcGear, IcHistory, IcLogout, IcNext, IcShield, IcTarget, IcTrophy, IcUser } from '../../ui/icons';
import { BadgeTile } from '../progress/Badges';
import { loadProgress, type Badge, type Progress } from '../progress/progress';
import { XpCard } from '../progress/Xp';
import { disablePush, enablePush, pushOptedIn, pushPermission } from '../../lib/push';
import { initials } from '../home/data';
import './profile.css';

/** The student's KAIRO identity: who they are, their level, four honest numbers, recent achievements, then settings. */
export default function Profile() {
  const { profile, session } = useAuth();
  const nav = useNavigate();
  const [pending, setPending] = useState(0);
  const [prog, setProg] = useState<Progress | null | undefined>(undefined);
  useEffect(() => { db.outbox.count().then(setPending); }, []);
  useEffect(() => { loadProgress().then(setProg).catch(() => setProg(null)); }, []);
  // Links like /profile#reminders (the bell on Home) land on that row once it has rendered.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
    return () => clearTimeout(t);
  }, [hash]);

  const signOut = async () => {
    if (pending > 0 && !window.confirm?.('Some results have not synced yet. Sign out anyway?')) return;
    track('user_logout');
    await flush().catch(() => {});
    await supabase.auth.signOut();
    nav('/welcome', { replace: true });
  };

  const since = session?.user.created_at ? new Date(session.user.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;
  const xp = prog?.xp;
  const recent = recentBadges((prog?.badges ?? []).filter((b) => b.category !== 'referral'));
  // Highest Proudly KAIRO badge (they live in the same achievements table, category 'referral').
  const refTop = (prog?.badges ?? []).filter((b) => b.category === 'referral' && b.earned_at).sort((a, b) => (b.goal ?? 0) - (a.goal ?? 0))[0] ?? null;
  const acc = prog && prog.questions > 0 && prog.correct != null ? Math.round((100 * prog.correct) / prog.questions) : null;
  const staff = profile?.role === 'editor' || profile?.role === 'admin';

  return (
    <div className="page prof">
      <header className="row-between">
        <h1>My profile</h1>
        <Link to="/profile/details" className="hdr-btn" aria-label="Personal information and settings"><IcGear /></Link>
      </header>

      <section className="prof-id" aria-label="You">
        <span className="prof-avatar" aria-hidden="true">{initials(profile?.full_name)}</span>
        <h2>{profile?.full_name || 'KAIRO Builder'}</h2>
        <p className="prof-meta">KAIRO Builder{since ? ` · Member since ${since}` : ''}</p>
        {xp && <span className="prof-tier">Level {xp.level} · {xp.tier} Builder</span>}
        {refTop && <Link to="/referrals" className="prof-ref" aria-label={`${refTop.title} referral badge`}><RefBadge code={refTop.code} size={20} label="" />{refTop.title.toUpperCase()}</Link>}
      </section>

      {prog === undefined ? <div className="skeleton" style={{ height: 128 }} /> : xp ? <XpCard xp={xp} /> : null}

      <section className="stack-sm" aria-labelledby="h-stats">
        <h2 id="h-stats">Your KAIRO statistics</h2>
        <div className="prof-stats">
          <Stat icon={<IcBook />} value={prog ? prog.questions.toLocaleString() : '–'} label="Questions answered" />
          <Stat icon={<IcTarget />} value={acc != null ? `${acc}%` : '–'} label="Overall accuracy" />
          <Stat icon={<IcFlame />} value={prog ? `${prog.streak.best} day${prog.streak.best === 1 ? '' : 's'}` : '–'} label="Longest streak" />
          <Stat icon={<IcClipboard />} value={prog?.quizzes != null ? prog.quizzes.toLocaleString() : '–'} label="Sessions completed" />
        </div>
      </section>

      {prog && prog.badges.length > 0 && (
        <section className="stack-sm" aria-labelledby="h-recent">
          <div className="sec-head"><h2 id="h-recent">{recent.earned ? 'Recent achievements' : 'Your first achievements'}</h2><Link to="/achievements" className="sec-link">View all <IcArrowRight /></Link></div>
          <div className="prof-badges">{recent.list.map((b) => <BadgeTile key={b.code} b={b} onOpen={() => nav('/achievements')} />)}</div>
        </section>
      )}

      {staff && (
        <section className="prof-list" aria-label="Staff">
          <Row to="/editor/quizzes" icon={<IcTrophy />} title="Quizzes and challenges" sub="Create, schedule, share, results" />
          <Row to="/editor" icon={<IcClipboard />} title="Question desk" sub="Key reviews, student reports, explanations" />
          {profile?.role === 'admin' && <Row to="/founder" icon={<IcChart />} title="Founder Intelligence" sub="Growth, engagement, retention, features, funnel" />}
        </section>
      )}

      <RefCardLite />

      <section className="prof-list" aria-label="Your activity">
        <Row to="/history" icon={<IcHistory />} title="History" sub="Every session and quiz you have finished" />
        <Row to="/progress" icon={<IcChart />} title="Your progress" sub="Accuracy by topic and your score trend" />
        <Row to="/leaderboard" icon={<IcTrophy />} title="Leaderboard" sub="Today, this week and all time" />
      </section>

      <section className="prof-list" aria-labelledby="h-acc">
        <h2 id="h-acc" className="prof-list-h">Account settings</h2>
        <Row to="/profile/details" icon={<IcUser />} title="Personal information" sub="Name, phone, UTME year, subjects, appearance" />
        <Reminders />
        <Row to="/profile/privacy" icon={<IcShield />} title="Privacy and security" sub="What others see, password" />
        <button type="button" className="prof-row" onClick={signOut}><span className="prof-ic"><IcLogout /></span><span className="grow"><b>Sign out</b></span><IcNext className="chev" /></button>
      </section>
      {pending > 0 && <p className="muted small">{pending} result{pending > 1 ? 's' : ''} waiting to sync.</p>}
      <p className="muted small" style={{ textAlign: 'center' }}>KAIRO by TECHMED · Seize the moment.</p>
    </div>
  );
}

/** The three most recently earned; with none yet, the three closest to being earned. */
function recentBadges(badges: Badge[]) {
  const got = badges.filter((b) => b.earned_at).sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? ''));
  if (got.length) return { earned: true, list: got.slice(0, 3) };
  const near = badges.filter((b) => b.goal && b.progress != null).sort((a, b) => b.progress! / b.goal! - a.progress! / a.goal!);
  return { earned: false, list: (near.length ? near : badges).slice(0, 3) };
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return <div className="prof-stat"><span className="gold-ic" aria-hidden="true">{icon}</span><b className="num">{value}</b><span className="muted small">{label}</span></div>;
}

function Row({ to, icon, title, sub }: { to: string; icon: ReactNode; title: string; sub?: string }) {
  return (
    <Link to={to} className="prof-row">
      <span className="prof-ic" aria-hidden="true">{icon}</span>
      <span className="grow"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      <IcNext className="chev" aria-hidden="true" />
    </Link>
  );
}

/** Daily reminders (Morning Charge at 6:00am, evening practice reminder): on, off, blocked, or how to get them. */
function Reminders() {
  const { session } = useAuth();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'blocked' | 'unsupported'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const perm = pushPermission();
    if (perm === 'unsupported') { setState('unsupported'); return; }
    if (perm === 'denied') { setState('blocked'); return; }
    if (perm === 'default') { setState('off'); return; }
    pushOptedIn().then((on) => setState(on ? 'on' : 'off'));
  }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      if (state === 'on') { await disablePush(); setState('off'); toast('Daily reminders are off.'); }
      else { const ok = await enablePush(session?.user.id); setState(ok ? 'on' : 'blocked'); toast(ok ? 'Daily reminders are on. See you at 6:00am.' : 'Notifications are blocked in your browser settings.'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change reminders.'); }
    setBusy(false);
  };
  const sub = state === 'blocked' ? 'Blocked. Tap the lock or ⓘ next to the web address, open Permissions, and allow Notifications.'
    : state === 'unsupported' ? (isIOS() ? 'On iPhone: tap Share, then Add to Home Screen, and open KAIRO from there to turn them on.' : 'This browser cannot show notifications. Open KAIRO in Chrome.')
    : state === 'on' ? 'On: Morning Charge at 6:00am and an evening reminder if you have not practised'
    : 'Morning Charge at 6:00am and an evening reminder if you have not practised';
  return (
    <div className="prof-row" id="reminders">
      <span className="prof-ic" aria-hidden="true"><IcBell /></span>
      <span className="grow"><b>Notifications</b><small>{state === 'loading' ? 'Checking…' : sub}</small></span>
      {(state === 'on' || state === 'off') && (
        <button type="button" className={`btn btn-sm ${state === 'on' ? '' : 'btn-accent'}`} disabled={busy} onClick={toggle}>{busy ? '…' : state === 'on' ? 'Turn off' : 'Turn on'}</button>
      )}
    </div>
  );
}

function SubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page prof">
      <div className="row"><Link to="/profile" className="icon-btn" aria-label="Back to profile"><IcBack /></Link><h1>{title}</h1></div>
      {children}
    </div>
  );
}

/** /profile/details: the same edit form as before, plus appearance and install. */
export function ProfileDetails() {
  const { profile, subjectCodes, saveProfile, session } = useAuth();
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.filter((c) => c !== 'ENG'));
  const [year, setYear] = useState(profile?.exam_year ?? 2027);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSubs(subjectCodes.filter((c) => c !== 'ENG')); }, [subjectCodes]);
  useEffect(() => { setName(profile?.full_name ?? ''); setPhone(profile?.phone ?? ''); setYear(profile?.exam_year ?? 2027); }, [profile]);
  const save = async () => {
    setBusy(true);
    try { await saveProfile({ full_name: name.trim(), phone: phone.trim() || null, exam_year: year, subjectCodes: ['ENG', ...subs] }); toast('Saved'); }
    catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  const toggle = (c: SubjectCode) => setSubs((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length >= 3 ? s : [...s, c]);
  return (
    <SubPage title="Personal information">
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
    </SubPage>
  );
}

/** /profile/privacy: what other students can see, and changing the password. */
export function ProfilePrivacy() {
  const { session, profile } = useAuth();
  const [sent, setSent] = useState(false);
  const email = session?.user.email;
  const first = (profile?.full_name || '').trim().split(/\s+/);
  const shown = first[0] ? `${first[0]}${first[1] ? ` ${first[1][0]}.` : ''}` : 'Builder';
  const reset = async () => {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
    if (error) toast(friendlyError(error)); else setSent(true);
  };
  return (
    <SubPage title="Privacy and security">
      <section className="card stack-sm">
        <h3>What other students see</h3>
        <p className="small">On leaderboards you appear as <b>{shown}</b>, with your XP and level. People who are not signed in only see initials.</p>
        <p className="muted small">Your email, phone number and answers are never shown to other students.</p>
      </section>
      {email && (
        <section className="card stack-sm">
          <h3>Password</h3>
          <p className="muted small">We will email a link to {email} to set a new password. If you sign in with Google, you do not need one.</p>
          <button className="btn" disabled={sent} onClick={reset}>{sent ? 'Link sent. Check your email.' : 'Send me a password link'}</button>
        </section>
      )}
      <a className="gold-link small" href="https://techmedng.com/legal" target="_blank" rel="noopener">TECHMED privacy and terms <IcArrowRight /></a>
    </SubPage>
  );
}
