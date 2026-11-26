import { NavLink, Outlet } from 'react-router-dom';
import { Banner } from './Banner';
import { Celebrations } from '../features/progress/Xp';
import { IcBook, IcHome, IcTarget, IcTrophy, IcUser } from '../ui/icons';

export function Shell() {
  return (
    <>
      <Banner />
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
