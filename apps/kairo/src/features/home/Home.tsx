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
import { IcNext, IcSpark, IcTarget } from '../../ui/icons';
import './home.css';

interface Recent { a: LocalAttempt; pct: number }

export default function Home() {
  const { profile, subjectCodes } = useAuth();
  const nav = useNavigate();
  const [active, setActive] = useState<LocalAttempt | undefined>();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [target, setTarget] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
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

  return (
    <div className="page stack home">
      <header className="row-between">
        <div><Logo height={20} /><p className="muted small" style={{ marginTop: 8 }}>{greeting()}{first ? `, ${first}` : ''}</p><h1>Ready to practise?</h1></div>
        {streak > 0 && <span className="streak" title="Days in a row with a finished practice">🔥 {streak}</span>}
      </header>

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

      <button className="hero-action" onClick={quick} disabled={busy}>
        <IcSpark />
        <span className="grow"><b>{busy ? 'Picking questions…' : '10 quick questions'}</b><small>From your subjects, with explanations as you go</small></span>
        <IcNext />
      </button>

      <Link to="/practice/mock" className="card card-link mock-card">
        <div className="grow">
          <p className="eyebrow">Full JAMB mock</p>
          <h3>English + 3 subjects · 180 questions · 2 hours</h3>
          <p className="muted small">Scored out of 400, like the real exam.{target ? ` Your target: ${target}+.` : ''}</p>
        </div>
        <IcTarget />
      </Link>

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
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
