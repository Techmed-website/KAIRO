import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { HomeRefCard } from '../referrals/HomeRefCard';
import { HomeRecapCard } from '../recap/HomeRecapCard';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { kvGet } from '../../lib/db';
import { clock } from '../../lib/score';
import { activeAttempt } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import type { LocalAttempt, SubjectCode } from '../../lib/types';
import { pushPermission } from '../../lib/push';
import { Logo } from '../../ui/components';
import { IcArrowRight, IcBell, IcChart, IcClipboard, IcFileText, IcMap, IcNext, IcTarget, IcTrophy } from '../../ui/icons';
import { PushPrompt } from '../../app/PushPrompt';
import { takeReturn } from '../daily/returnTo';
import { loadProgress, type Progress } from '../progress/progress';
import { cbt } from '../../lib/supabase';
import { DailyCard } from './DailyCard';
import { Snapshot } from './Snapshot';
import { PractiseSheet } from './PractiseSheet';
import { PlannerCard } from './PlannerCard';
import { Today } from './Today';
import { SUBJECT_ICONS } from '../../ui/subjectIcons';
import { greeting, homeToday, initials, longDate, type HomeQuiz } from './data';
import './home.css';

const ALL: SubjectCode[] = ['ENG', 'MTH', 'PHY', 'CHM', 'BIO'];
type Ic = ComponentType<SVGProps<SVGSVGElement>>;

export default function Home() {
  const { profile, subjectCodes } = useAuth();
  const nav = useNavigate();
  useEffect(() => { const r = takeReturn(); if (r) nav(r, { replace: true }); }, [nav]);

  const [prog, setProg] = useState<Progress | null | undefined>(undefined);
  const [quiz, setQuiz] = useState<HomeQuiz | null | undefined>(undefined);
  const [quizFailed, setQuizFailed] = useState(false);
  const [bank, setBank] = useState<{ total?: number; by_subject?: Record<string, number> } | null>(null);
  const [active, setActive] = useState<LocalAttempt | undefined>();
  const [target, setTarget] = useState<number | undefined>();
  const [sheet, setSheet] = useState(false);

  const loadQuiz = useCallback(() => {
    setQuizFailed(false); setQuiz(undefined);
    homeToday().then(setQuiz).catch(() => setQuizFailed(true));
  }, []);

  useEffect(() => {
    loadQuiz();
    loadProgress().then(setProg).catch(() => setProg(null));
    cbt().rpc('bank_count').then(({ data }) => setBank((data as typeof bank) ?? null), () => {});
    activeAttempt().then(setActive);
    kvGet<number>('target').then(setTarget);
  }, [loadQuiz]);

  const first = (profile?.full_name || '').trim().split(/\s+/)[0];
  const st = prog?.streak;
  const sub = !st ? 'Ready to build your streak?'
    : st.today ? (st.current > 1 ? `${st.current} days in a row. Keep it going.` : 'You’ve practised today. Keep going.')
    : st.current > 0 ? `Practise today to keep your ${st.current}-day streak.` : 'Ready to build your streak?';

  // A local attempt in progress, unless it is today's daily quiz (the daily card already offers to resume it).
  const remaining = active?.deadline_at ? (new Date(active.deadline_at).getTime() - Date.now() - active.clock_offset_ms) / 1000 : null;
  const showContinue = active && (remaining == null || remaining > 0) && active.assessment_id !== quiz?.id;

  const mine = subjectCodes.filter((c) => ALL.includes(c));
  const subjects = [...mine, ...ALL.filter((c) => !mine.includes(c))];
  const pushOff = pushPermission() === 'default';

  const explore: { to: string; ext?: boolean; icon: Ic; title: string; sub: string }[] = [
    { to: '/practice', icon: IcFileText, title: 'Past questions', sub: 'By exam year or topic' },
    { to: '/practice/mock', icon: IcClipboard, title: 'Full JAMB mock', sub: target ? `180 questions · target ${target}+` : '180 questions · /400' },
    { to: '/leaderboard', icon: IcTrophy, title: 'Leaderboard', sub: 'See where you rank' },
    { to: '/progress', icon: IcChart, title: 'Your progress', sub: 'Accuracy and weak topics' },
    { to: '/quizzes', icon: IcTarget, title: 'Quizzes', sub: 'Daily quiz and challenges' },
    { to: '/syllabus', icon: IcMap, title: 'JAMB syllabus', sub: 'What to study, by subject' },
  ];

  return (
    <div className="page home2">
      <header className="brand">
        <div className="brand-mark">
          <Logo height={22} label="KAIRO" />
          <span className="tagline">Seize the moment.</span>
        </div>
        <div className="brand-actions">
          <Link to="/profile#reminders" className="hdr-btn" aria-label={pushOff ? 'Notifications (off): turn on daily reminders' : 'Notification settings'}>
            <IcBell />{pushOff && <i className="dot" aria-hidden="true" />}
          </Link>
          <Link to="/profile" className="hdr-btn avatar" aria-label="Your profile">{initials(profile?.full_name)}</Link>
        </div>
      </header>

      <section className="greet" aria-label="Greeting">
        <p className="greet-date">{longDate()}</p>
        <h1>{greeting()}{first ? `, ${first}` : ''}.</h1>
        <p className="greet-sub">{sub}</p>
      </section>

      <div className="home-grid">
        <div className="home-main">
          {!navigator.onLine && (
            <Link to="/practice/offline" className="card card-link continue"><div className="grow"><p className="eyebrow">You are offline</p><h3>Practise with your downloaded packs</h3></div><IcNext /></Link>
          )}
          {showContinue && (
            <Link to={`/cbt/${active!.id}`} className="card card-link continue">
              <div className="grow">
                <p className="eyebrow">Continue where you stopped</p>
                <h3>{active!.title}</h3>
                <p className="muted small num">{Object.values(active!.answers).filter((x) => x.selected).length} answered{remaining != null ? ` · ${clock(remaining)} left` : ''}</p>
              </div>
              <IcNext />
            </Link>
          )}

          <HomeRecapCard />

          <div className="o-daily"><DailyCard q={quiz} failed={quizFailed} onRetry={loadQuiz} streak={st?.current ?? null} onPractise={() => setSheet(true)} /></div>

          <section className="o-subjects stack-sm" aria-labelledby="h-subjects">
            <div className="sec-head"><h2 id="h-subjects">Your subjects</h2><Link to="/practice" className="sec-link">View all <IcArrowRight /></Link></div>
            <div className="subj-grid">
              {subjects.map((c) => {
                const I = SUBJECT_ICONS[c];
                const n = bank?.by_subject?.[c];
                return (
                  <Link key={c} to={`/practice/${c}`} className={`subj s-${c}`}>
                    <span className="subj-ic" aria-hidden="true"><I /></span>
                    <b>{subjectName(c)}</b>
                    <span className="subj-sub num">{n ? `${n.toLocaleString()} questions` : 'Practice questions'} <IcArrowRight aria-hidden="true" /></span>
                  </Link>
                );
              })}
            </div>
            <p className="free-line small num">{bank?.total ? `${bank.total.toLocaleString()} questions` : 'Every question'}, every subject, all free. No activation code, no PIN.</p>
          </section>

          <section className="o-explore stack-sm" aria-labelledby="h-explore">
            <div className="sec-head"><h2 id="h-explore">Explore KAIRO</h2></div>
            <nav className="explore" aria-label="Explore KAIRO">
              {explore.map(({ to, ext, icon: I, title, sub: s }) => {
                const inner = <><span className="ex-ic" aria-hidden="true"><I /></span><b>{title}</b><span className="ex-sub">{s}</span></>;
                return ext
                  ? <a key={title} href={to} target="_blank" rel="noopener" className="ex">{inner}</a>
                  : <Link key={title} to={to} className="ex">{inner}</Link>;
              })}
            </nav>
          </section>
        </div>

        <aside className="home-side" aria-label="Your day">
          <div className="o-snap"><Snapshot prog={prog} /></div>
          <div className="o-ref"><HomeRefCard /></div>
          <div className="o-push"><PushPrompt where="home" /></div>
          <div className="o-planner"><PlannerCard /></div>
          <div className="o-today"><Today /></div>
        </aside>
      </div>

      <PractiseSheet open={sheet} onClose={() => setSheet(false)} mine={mine} />
    </div>
  );
}
