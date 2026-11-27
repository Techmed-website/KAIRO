import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { track } from '../lib/analytics';
import { Banner } from './Banner';
import { Celebrations } from '../features/progress/Xp';
import { RefPrompts } from '../features/referrals/RefPrompts';
import { IcBook, IcHome, IcTarget, IcTrophy, IcUser } from '../ui/icons';

/** Always visible to a guest (except on the result, which already shows the form). */
function GuestBar() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const guest = !!session?.user?.is_anonymous;
  useEffect(() => {
    if (!guest) return;
    try { if (sessionStorage.getItem('kairo-guest-bar')) return; sessionStorage.setItem('kairo-guest-bar', '1'); } catch { /* storage blocked */ }
    track('guest_prompt_shown', { props: { source: 'bar' } });
  }, [guest]);
  if (!session?.user?.is_anonymous || /^\/result\//.test(pathname)) return null;
  return (
    <div className="guest-bar" role="region" aria-label="Guest mode">
      <p><b>Playing as a guest.</b> Your scores are not ranked or saved.</p>
      <Link className="btn btn-accent btn-sm" to="/signin" state={{ mode: 'signup', from: pathname }}>Save free</Link>
    </div>
  );
}

export function Shell() {
  return (
    <>
      <Banner />
      <GuestBar />
      <RefPrompts />
      <main><Outlet /></main>
      <Celebrations />
      <nav className="nav" aria-label="Main">
        <NavLink to="/" end><IcHome />Home</NavLink>
        <NavLink to="/practice"><IcBook />Practice</NavLink>
        <NavLink to="/quizzes"><IcTarget />Quizzes</NavLink>
        <NavLink to="/leaderboard"><IcTrophy />Ranks</NavLink>
        <NavLink to="/profile"><IcUser />Profile</NavLink>
      </nav>
    </>
  );
}
