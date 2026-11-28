import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { syncPushUser } from '../lib/push';
import { rememberReturn } from '../features/daily/returnTo';
import { trackPage } from '../lib/analytics';
import { captureReferral, claimPendingReferral } from '../lib/referral';
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
const ProfileDetails = lazy(() => import('../features/profile/Profile').then((m) => ({ default: m.ProfileDetails })));
const ProfilePrivacy = lazy(() => import('../features/profile/Profile').then((m) => ({ default: m.ProfilePrivacy })));
const Achievements = lazy(() => import('../features/progress/Achievements'));
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
const Founder = lazy(() => import('../features/founder/Founder'));
const Referrals = lazy(() => import('../features/referrals/Referrals'));
const Ambassadors = lazy(() => import('../features/referrals/Ambassadors'));
const RefLanding = lazy(() => import('../features/referrals/RefLanding'));
const NotificationPrefs = lazy(() => import('../features/notifications-prefs/Notifications').then((m) => ({ default: m.NotificationPrefs })));
const FeedbackCentre = lazy(() => import('../features/voice/Pages').then((m) => ({ default: m.FeedbackCentre })));
const TestimonialForm = lazy(() => import('../features/voice/Pages').then((m) => ({ default: m.TestimonialForm })));
const Reviews = lazy(() => import('../features/voice/Pages').then((m) => ({ default: m.Reviews })));
const FiVoice = lazy(() => import('../features/founder/StudentVoice'));
const Recap = lazy(() => import('../features/recap/Recap'));
const Unsubscribe = lazy(() => import('../features/notifications-prefs/Notifications').then((m) => ({ default: m.Unsubscribe })));
const FiReferrals = lazy(() => import('../features/founder/ReferralIntel'));
const FiOverview = lazy(() => import('../features/founder/Overview'));
const FiLive = lazy(() => import('../features/founder/Live'));
const FiEngagement = lazy(() => import('../features/founder/Engagement'));
const FiFeatures = lazy(() => import('../features/founder/Features'));
const FiFunnel = lazy(() => import('../features/founder/Funnel'));
const FiStudents = lazy(() => import('../features/founder/Students'));

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
  // Product analytics: one page view per route change (batched, never blocks; the exam runner is not tracked).
  useEffect(() => { trackPage(loc.pathname); }, [loc.pathname]);
  // PROUDLY KAIRO: any link with ?ref=CODE counts as a referral visit (first touch is kept on this phone).
  useEffect(() => { const r = new URLSearchParams(loc.search).get('ref'); if (r) captureReferral(r); }, [loc.search]);
  // Once signed in with a real account, the server records the referral (all rules applied there).
  useEffect(() => {
    if (session?.user && !session.user.is_anonymous) claimPendingReferral(session.user.id, session.user.created_at);
  }, [session?.user?.id, session?.user?.is_anonymous]); // eslint-disable-line react-hooks/exhaustive-deps
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
          <Route path="/r/:code" element={<RefLanding />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
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
            {/* Founder Intelligence: KAIRO admin only (checked again by every cbt.fi_* call on the server). */}
            <Route path="/founder" element={<Founder />}>
              <Route index element={<FiOverview />} />
              <Route path="live" element={<FiLive />} />
              <Route path="engagement" element={<FiEngagement />} />
              <Route path="features" element={<FiFeatures />} />
              <Route path="funnel" element={<FiFunnel />} />
              <Route path="students" element={<FiStudents />} />
              <Route path="referrals" element={<FiReferrals />} />
              <Route path="voice" element={<FiVoice />} />
            </Route>
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/details" element={<ProfileDetails />} />
            <Route path="/profile/privacy" element={<ProfilePrivacy />} />
            <Route path="/profile/notifications" element={<NotificationPrefs />} />
            <Route path="/recap" element={<Recap />} />
            <Route path="/feedback" element={<FeedbackCentre />} />
            <Route path="/feedback/review" element={<TestimonialForm />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/referrals" element={<Referrals />} />
            <Route path="/ambassadors" element={<Ambassadors />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  );
}
