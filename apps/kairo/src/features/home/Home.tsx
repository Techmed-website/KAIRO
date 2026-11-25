import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db, kvGet } from '../../lib/db';
import { clock, scoreBySubject } from '../../lib/score';
import { activeAttempt, startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import type { LocalAttempt } from '../../lib/types';
import { Logo, toast } from '../../ui/components';
import { IcNext } from '../../ui/icons';
import { takeReturn } from '../daily/returnTo';
import { HeroCard } from './HeroCard';
import { loadProgress, bankCount, type Progress } from '../progress/progress';
import { PushPrompt } from '../../app/PushPrompt';
import { Today } from './Today';
import { PlannerCard } from './PlannerCard';
import './home.css';

interface Recent { a: LocalAttempt; pct: number }

export default function Home() {
  const { profile, subjectCodes } = useAuth();
  const nav = useNavigate();
  useEffect(() => { const r = takeReturn(); if (r) nav(r, { replace: true }); }, [nav]);
  const [active, setActive] = useState<LocalAttempt | undefined>();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [target, setTarget] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [streak, setStreak] = useState(0);
  const [prog, setProg] = useState<Progress | null>(null);
  const [bank, setBank] = useState<number | null>(null);

  useEffect(() => {
    loadProgress().then(setProg).catch(() => {});
    bankCount().then(setBank).catch(() => {});
    activeAttempt().then(setActive);
    kvGet<number>('target').then(setTarget);
    db.attempts.where('status').equals('submitted').toArray().then(async (list) => {
      list.sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''));
      const out: Recent[] = [];
      for (const a of list.slice(0, 3)) {
        const p = await db.papers.get(a.assessment_id);
        const c = p ? scoreBySubject(p.questions, a.answers).reduce((x, s) => x + s.correct, 0) : 0;
        out.push({ a, pct: p?.questions.length ? Math.round((c / p.questions.length) * 100) : 0 });
      }
      setRecent(out);
      // Streak: consecutive days (ending today or yesterday) with at least one finished attempt.
      const days = new Set(list.map((a) => (a.submitted_at ?? '').slice(0, 10)));
      let n = 0; const d = new Date();
      if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
      while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
      setStreak(n);
    });
  }, []);

  const quick = async () => {
    setBusy(true);
    try {
      const codes = subjectCodes.length === 4 ? subjectCodes : ['ENG', 'MTH', 'PHY', 'CHM'] as const;
      const id = await startPractice({ mode: 'mixed', feedback: 'instant', subjects: codes.map((code, i) => ({ code, count: i < 2 ? 3 : 2 })) });
      nav(`/cbt/${id}`);
    } catch (e) { toast(friendlyError(e)); setBusy(false); }
  };

  const first = (profile?.full_name || '').split(' ')[0];
  const remaining = active?.deadline_at ? (new Date(active.deadline_at).getTime() - Date.now() - active.clock_offset_ms) / 1000 : null;

  const st = prog?.streak ?? null;
  const shownStreak = st ? st.current : streak;
  const earned = prog?.badges.filter((b) => b.earned_at) ?? [];
  const nextBadges = (prog?.badges ?? []).filter((b) => !b.earned_at).sort((a, b) => progressOf(b) - progressOf(a)).slice(0, 3);

  return (
    <div className="page stack home">
      <header className="row-between">
        <div><Logo height={20} /><p className="muted small" style={{ marginTop: 8 }}>{greeting()}{first ? `, ${first}` : ''}</p><h1>Ready to practise?</h1></div>
        {shownStreak > 0 && <span className="streak" title="Days in a row with a finished practice">🔥 {shownStreak}</span>}
      </header>

      <PushPrompt where="home" />

      {!navigator.onLine && (
        <Link to="/practice/offline" className="card card-link continue"><div className="grow"><p className="eyebrow">You are offline</p><h3>Practise with your downloaded packs</h3></div><IcNext /></Link>
      )}

      {active && (remaining == null || remaining > 0) && (
        <Link to={`/cbt/${active.id}`} className="card card-link continue">
          <div className="grow">
            <p className="eyebrow">Continue where you stopped</p>
            <h3>{active.title}</h3>
            <p className="muted small num">{Object.values(active.answers).filter((x) => x.selected).length} answered{remaining != null ? ` · ${clock(remaining)} left` : ''}</p>
          </div>
          <IcNext />
        </Link>
      )}

      <HeroCard streak={st} onQuick={quick} busy={busy} />

      <p className="free-line small num">✅ {bank ? `${bank.toLocaleString()} questions` : 'Every question'}, every subject, all free. No activation code, no PIN.</p>

      <nav className="quick-tiles" aria-label="Quick links">
        <Link to="/practice" className="qt qt-blue"><span aria-hidden="true">📚</span><b>Past questions</b><small>By year or topic</small></Link>
        <Link to="/practice/mock" className="qt qt-gold"><span aria-hidden="true">📝</span><b>Full JAMB mock</b><small>{target ? `Target ${target}+ /400` : '180 questions · /400'}</small></Link>
        <Link to="/quizzes" className="qt qt-green"><span aria-hidden="true">🏁</span><b>Quizzes</b><small>Daily quiz &amp; challenges</small></Link>
        <Link to="/progress" className="qt qt-purple"><span aria-hidden="true">📈</span><b>Your progress</b><small>Strong &amp; weak topics</small></Link>
        <Link to="/leaderboard" className="qt qt-red"><span aria-hidden="true">🏆</span><b>Leaderboard</b><small>See where you rank</small></Link>
        <a href="https://techmedng.com/jamb-syllabus-2027" target="_blank" rel="noopener" className="qt qt-teal"><span aria-hidden="true">🗺️</span><b>JAMB syllabus</b><small>What to study</small></a>
      </nav>

      <Today />
      <PlannerCard />

      {prog && (
        <Link to="/profile#badges" className="card card-link stack-sm">
          <div className="row-between"><h2>Badges</h2><span className="small num">{earned.length}/{prog.badges.length} earned ›</span></div>
          <div className="mini-badges">
            {[...earned.slice(-3), ...nextBadges].slice(0, 4).map((b) => (
              <span key={b.code} className={`mini-bdg ${b.earned_at ? 'earned' : ''}`} title={b.description}>
                <i aria-hidden="true">{b.icon}</i><small>{b.earned_at ? b.title : b.goal && b.progress != null ? `${b.progress}/${b.goal}` : b.title}</small>
              </span>
            ))}
          </div>
        </Link>
      )}

      <section className="stack-sm">
        <div className="row-between"><h2>Your subjects</h2><Link to="/practice" className="small">All practice</Link></div>
        <div className="subj-tiles">
          {(subjectCodes.length ? subjectCodes : ['ENG', 'MTH', 'PHY', 'CHM', 'BIO']).map((c) => (
            <Link key={c} to={`/practice/${c}`} className="subj-tile"><b>{subjectName(c)}</b><span className="muted small">By year or topic</span></Link>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="stack-sm">
          <div className="row-between"><h2>Recent</h2><Link to="/history" className="small">History</Link></div>
          {recent.map(({ a, pct }) => (
            <Link key={a.id} to={`/result/${a.id}`} className="card card-link row-between">
              <div className="grow"><b>{a.title}</b><p className="muted small">{new Date(a.submitted_at!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p></div>
              <span className="badge num">{pct}%</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
function progressOf(b: { goal: number | null; progress: number | null }) { return b.goal && b.progress != null ? b.progress / b.goal : 0; }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
