import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../ui/components';
import { IcBack } from '../../ui/icons';
import { BadgeMedal, BadgeTile } from './Badges';
import { CATEGORIES, loadProgress, type Badge, type Progress } from './progress';
import { XpCard } from './Xp';
import './achievements.css';

/** Every achievement by category, earned first-class and locked ones still visible with progress; plus how XP works. */
export default function Achievements() {
  const [prog, setProg] = useState<Progress | null | undefined>(undefined);
  const [open, setOpen] = useState<Badge | null>(null);
  useEffect(() => { loadProgress().then(setProg).catch(() => setProg(null)); }, []);
  useEffect(() => { if (prog && location.hash === '#xp') setTimeout(() => document.getElementById('xp')?.scrollIntoView({ behavior: 'smooth' }), 200); }, [prog]);

  const badges = prog?.badges ?? [];
  const earned = badges.filter((b) => b.earned_at).length;
  const inProgress = badges.filter((b) => !b.earned_at && b.goal && (b.progress ?? 0) > 0).length;

  return (
    <div className="page ach">
      <nav className="crumbs-lite"><Link to="/profile" className="icon-btn" aria-label="Back to profile"><IcBack /></Link></nav>
      <header className="stack-sm"><h1>Your achievements</h1><p className="muted">Every effort counts. Keep building.</p></header>
      {prog === undefined ? <div className="stack-sm"><div className="skeleton" style={{ height: 130 }} /><div className="skeleton" style={{ height: 300 }} /></div>
        : prog === null ? <p className="card">Your achievements will show when you are back online.</p> : (
          <>
            {prog.xp && <XpCard xp={prog.xp} title="Your progression" />}
            <dl className="ach-counts">
              <div><dt>Earned</dt><dd className="num">{earned}</dd></div>
              <div><dt>In progress</dt><dd className="num">{inProgress}</dd></div>
              <div><dt>Remaining</dt><dd className="num">{badges.length - earned}</dd></div>
            </dl>
            {CATEGORIES.map((c) => {
              const list = badges.filter((b) => (b.category ?? 'practice') === c.key);
              if (!list.length) return null;
              const got = list.filter((b) => b.earned_at).length;
              return (
                <section key={c.key} className="stack-sm" aria-labelledby={`cat-${c.key}`}>
                  <div className="sec-head"><h2 id={`cat-${c.key}`}>{c.title}</h2><span className="muted small num">{got}/{list.length}</span></div>
                  <p className="muted small">{c.blurb}</p>
                  <div className="ach-grid">{list.map((b) => <BadgeTile key={b.code} b={b} onOpen={setOpen} />)}</div>
                </section>
              );
            })}
            <section id="xp" className="ach-how" aria-labelledby="h-xp">
              <h2 id="h-xp">How XP works</h2>
              <p className="muted small">XP is worked out by KAIRO from the practice you finish. Nothing you tap or open earns XP on its own.</p>
              <ul>
                <li><b>Answer questions:</b> 1 XP for each answer, 2 more when it is right. Each question counts once a day, so retrying the same questions adds nothing new. Up to 300 XP a day from answers.</li>
                <li><b>Finish a session:</b> 10 XP for 10 or more new questions (up to 5 sessions a day).</li>
                <li><b>Daily Builder Quiz:</b> 20 XP, plus 10 for 80% or better (your first attempt).</li>
                <li><b>Full JAMB mock:</b> 50 XP with at least 120 answers (once a day).</li>
                <li><b>Show up:</b> 5 XP for practising on a day.</li>
                <li><b>Achievements:</b> 25 XP each.</li>
              </ul>
              <p className="muted small">Levels: level 2 at 100 XP, 3 at 300, 4 at 600, 5 at 1,000, 10 at 4,500. Each level needs 100 XP more than the last.
                The weekly board resets every Sunday at 10 pm; the daily board at midnight.</p>
              <Link className="gold-link small" to="/leaderboard">See the leaderboard</Link>
            </section>
          </>
        )}
      <Sheet open={!!open} onClose={() => setOpen(null)} label={open?.title ?? 'Achievement'}>
        {open && (
          <div className="sheet-body ach-detail">
            <BadgeMedal b={open} size={88} />
            <h2>{open.title}</h2>
            <p className="muted">{open.description}</p>
            {open.earned_at
              ? <p className="ach-got">Earned {new Date(open.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · +25 XP</p>
              : open.goal && open.progress != null
                ? <div className="ach-prog"><div className="btile-bar"><i style={{ width: `${Math.round((100 * open.progress) / open.goal)}%` }} /></div>
                    <span className="small num">{open.progress.toLocaleString()} of {open.goal.toLocaleString()} · +25 XP when earned</span></div>
                : <p className="small muted">+25 XP when earned</p>}
            <button className="btn btn-block" onClick={() => setOpen(null)}>Close</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
