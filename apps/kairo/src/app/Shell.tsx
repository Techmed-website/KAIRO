import { NavLink, Outlet } from 'react-router-dom';
import { Banner } from './Banner';
import { IcBook, IcClock, IcHome, IcTrophy, IcUser } from '../ui/icons';

export function Shell() {
  return (
    <>
      <Banner />
      <main><Outlet /></main>
      <nav className="nav" aria-label="Main">
        <NavLink to="/" end><IcHome />Home</NavLink>
        <NavLink to="/practice"><IcBook />Practice</NavLink>
        <NavLink to="/leaderboard"><IcTrophy />Ranks</NavLink>
        <NavLink to="/history"><IcClock />History</NavLink>
        <NavLink to="/profile"><IcUser />Profile</NavLink>
      </nav>
    </>
  );
}
