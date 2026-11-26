import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { syncPushUser } from '../lib/push';
import { rememberReturn } from '../features/daily/returnTo';
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
const Planner = lazy(() => import('../features/planner/Planner'));
const Syllabus = lazy(() => import('../features/syllabus/Syllabus'));
const SyllabusSubject = lazy(() => import('../features/syllabus/Syllabus').then((m) => ({ default: m.SyllabusSubject })));
const Topics = lazy(() => import('../features/practice/Topics'));
const Years = lazy(() => import('../features/practice/Years'));
const Mixed = lazy(() => import('../features/practice/Mixed'));
const Mock = lazy(() => import('../features/practice/Mock'));
const Offline = lazy(() => import('../features/practice/Offline'));
const Cbt = lazy(() => import('../features/cbt/CbtScreen'));
const Result = lazy(() => import('../features/review/Result'));
const Review = lazy(() => import('../features/review/Review'));
const History = lazy(() => import('../features/history/History'));
const Profile = lazy(() => import('../features/profile/Profile'));
const PaperBoard = lazy(() => import('../features/leaderboard/PaperBoard'));
const OpenQuiz = lazy(() => import('../features/daily/OpenQuiz'));
const QuizHub = lazy(() => import('../features/quizzes/QuizHub'));
const QuizPage = lazy(() => import('../features/quizzes/QuizPage'));
const Leaderboard = lazy(() => import('../features/leaderboard/Leaderboard'));
const Performance = lazy(() => import('../features/performance/Performance'));
const Editor = lazy(() => import('../features/editor/Editor'));
const QuizList = lazy(() => import('../features/admin/QuizList'));
const QuizForm = lazy(() => import('../features/admin/QuizForm'));
const QuizManage = lazy(() => import('../features/admin/QuizManage'));

export const needsSetup = (p: ReturnType<typeof useAuth>['profile']) => !p || !p.exam_year || (p.subjects?.length ?? 0) < 4;

/** Screens a guest (anonymous session from a shared quiz link) may see: the quiz, its result and its review. */
const GUEST_PATHS = /^\/(cbt|result|review|rank|quiz)\/|^\/quizzes\/?$/;
export const isGuest = (s: ReturnType<typeof useAuth>['session']) => !!s?.user?.is_anonymous;

function Private({ children, allowSetup = false }: { children: ReactNode; allowSetup?: boolean }) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!session) { rememberReturn(loc.pathname); return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />; }
  if (isGuest(session)) {
    if (GUEST_PATHS.test(loc.pathname)) return <>{children}</>;
    return <Navigate to="/signin" replace state={{ mode: 'signup', from: loc.pathname }} />;
  }
  // Never interrupt a quiz for profile setup: a student who signs up from a quiz link and taps Start goes straight to the
  // questions (the timer is already running). Setup is asked for afterwards, from Home.
  if (!allowSetup && profile && needsSetup(profile) && !GUEST_PATHS.test(loc.pathname)) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  const { recovery, session } = useAuth();
  const loc = useLocation();
  // A student who already allowed notifications is linked to this phone again (new sign-in, new phone).
  useEffect(() => { if (session?.user.id) syncPushUser(session.user.id); }, [session?.user.id]);
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
          <Route path="/q/:id" element={<OpenQuiz />} />
          <Route element={<Private><Shell /></Private>}>
            <Route path="/" element={<Home />} />
            <Route path="/practice" element={<PracticeHub />} />
            <Route path="/practice/mixed" element={<Mixed />} />
            <Route path="/practice/mock" element={<Mock />} />
            <Route path="/practice/offline" element={<Offline />} />
            <Route path="/practice/:code" element={<SubjectPractice />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/syllabus" element={<Syllabus />} />
            <Route path="/syllabus/:slug" element={<SyllabusSubject />} />
            <Route path="/practice/:code/topics" element={<Topics />} />
            <Route path="/practice/:code/years" element={<Years />} />
            <Route path="/result/:id" element={<Result />} />
            <Route path="/rank/:id" element={<PaperBoard />} />
            <Route path="/quizzes" element={<QuizHub />} />
            <Route path="/quiz/:id" element={<QuizPage />} />
            <Route path="/daily" element={<Navigate to="/quizzes" replace />} />
            <Route path="/review/:id" element={<Review />} />
            <Route path="/history" element={<History />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/progress" element={<Performance />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/editor/quizzes" element={<QuizList />} />
            <Route path="/editor/quizzes/new" element={<QuizForm />} />
            <Route path="/editor/quizzes/:id" element={<QuizManage />} />
            <Route path="/editor/quizzes/:id/edit" element={<QuizForm />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
