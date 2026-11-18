import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Spinner, ToastHost } from '../ui/components';
import { Shell } from './Shell';

const Landing = lazy(() => import('../features/onboarding/Landing'));
const SignIn = lazy(() => import('../features/auth/SignIn'));
const ResetPassword = lazy(() => import('../features/auth/ResetPassword'));
const Setup = lazy(() => import('../features/onboarding/Setup'));
const Tour = lazy(() => import('../features/onboarding/Tour'));
const Starter = lazy(() => import('../features/onboarding/Starter'));
const Install = lazy(() => import('../features/onboarding/Install'));
const Home = lazy(() => import('../features/home/Home'));
const PracticeHub = lazy(() => import('../features/practice/PracticeHub'));
const SubjectPractice = lazy(() => import('../features/practice/SubjectPractice'));
const Mixed = lazy(() => import('../features/practice/Mixed'));
const Mock = lazy(() => import('../features/practice/Mock'));
const Offline = lazy(() => import('../features/practice/Offline'));
const Cbt = lazy(() => import('../features/cbt/CbtScreen'));
const Result = lazy(() => import('../features/review/Result'));
const Review = lazy(() => import('../features/review/Review'));
const History = lazy(() => import('../features/history/History'));
const Profile = lazy(() => import('../features/profile/Profile'));
const PaperBoard = lazy(() => import('../features/leaderboard/PaperBoard'));
const Leaderboard = lazy(() => import('../features/leaderboard/Leaderboard'));
const Performance = lazy(() => import('../features/performance/Performance'));
const Editor = lazy(() => import('../features/editor/Editor'));

export const needsSetup = (p: ReturnType<typeof useAuth>['profile']) => !p || !p.exam_year || (p.subjects?.length ?? 0) < 4;

function Private({ children, allowSetup = false }: { children: ReactNode; allowSetup?: boolean }) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (!allowSetup && profile && needsSetup(profile)) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  const { recovery } = useAuth();
  const loc = useLocation();
  if (recovery && loc.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />;
  return (
    <>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/welcome" element={<Landing />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/setup" element={<Private allowSetup><Setup /></Private>} />
          <Route path="/tour" element={<Private><Tour /></Private>} />
          <Route path="/starter" element={<Private><Starter /></Private>} />
          <Route path="/install" element={<Private><Install /></Private>} />
          <Route path="/cbt/:id" element={<Private><Cbt /></Private>} />
          <Route element={<Private><Shell /></Private>}>
            <Route path="/" element={<Home />} />
            <Route path="/practice" element={<PracticeHub />} />
            <Route path="/practice/mixed" element={<Mixed />} />
            <Route path="/practice/mock" element={<Mock />} />
            <Route path="/practice/offline" element={<Offline />} />
            <Route path="/practice/:code" element={<SubjectPractice />} />
            <Route path="/result/:id" element={<Result />} />
            <Route path="/rank/:id" element={<PaperBoard />} />
            <Route path="/review/:id" element={<Review />} />
            <Route path="/history" element={<History />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/progress" element={<Performance />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
