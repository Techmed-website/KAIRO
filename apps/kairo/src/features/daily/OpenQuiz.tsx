import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/db';
import { PasscodeError, startAssessment } from '../../lib/session';
import { guestFinishedCount } from '../../lib/guest';
import { GuestSignup } from '../onboarding/GuestSignup';
import { cbt, friendlyError, supabase } from '../../lib/supabase';
import { Logo, Spinner } from '../../ui/components';
import { rememberReturn } from './returnTo';
import { shortTitle } from './data';
import './open.css';

interface Card {
  id: string; title: string; type: string; status: string; slug: string | null;
  question_count: number; time_limit_sec: number | null; opens_at: string | null; closes_at: string | null;
  guests_allowed: boolean; has_passcode: boolean; ranked: boolean; prize_text: string | null; players: number;
}

/**
 * /q/:id — the link TECHMED shares (WhatsApp, website). A short, calm instructions screen, then straight into the quiz.
 * Guests can play quizzes that allow it (a Supabase anonymous session); they are asked to save their score at the end.
 */
export default function OpenQuiz() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [passcode, setPasscode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [guestUsed, setGuestUsed] = useState(false);

  useEffect(() => {
    cbt().rpc('public_quiz_by_id', { p_id: id }).then(({ data, error }) => {
      if (error) { setErr(friendlyError(error)); setCard(null); return; }
      const c = data as Card | null;
      setCard(c);
      if (c?.has_passcode) setNeedCode(true);
    });
    db.attempts.where('assessment_id').equals(id).toArray()
      .then((list) => setResumeId(list.find((a) => a.status === 'in_progress')?.id ?? null)).catch(() => {});
  }, [id]);

  // Guests get one free quiz. Once a guest has finished one, the next quiz needs a free account (they can still resume an unfinished one).
  const isGuest = !!session?.user?.is_anonymous;
  useEffect(() => { if (isGuest) guestFinishedCount().then((n) => setGuestUsed(n >= 1)); else setGuestUsed(false); }, [isGuest]);

  const start = async () => {
    if (!card) return;
    setBusy(true); setErr('');
    try {
      if (!session) {
        if (!card.guests_allowed) { rememberReturn(`/q/${id}`); nav('/signin', { state: { from: `/q/${id}` } }); return; }
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw new Error('Guest play is not available right now. Please sign in to take the quiz.');
      }
      const attempt = await startAssessment(id, undefined, needCode ? passcode.trim() : undefined);
      nav(`/cbt/${attempt}`, { replace: true });
    } catch (e) {
      if (e instanceof PasscodeError) setNeedCode(true);
      setErr(e instanceof Error && !(e as { code?: string }).code ? e.message : friendlyError(e));
      setBusy(false);
    }
  };

  if (card === undefined || loading) return <Spinner label="Opening the quiz" />;
  if (!card) return (
    <div className="page no-nav stack">
      <h1>This quiz could not open</h1>
      <p className="card error">{err || 'The link may be wrong, or the quiz was removed.'}</p>
      <Link className="btn btn-primary btn-block" to="/quizzes">See all quizzes</Link>
    </div>
  );

  const now = Date.now();
  const scheduled = card.status === 'scheduled' || (card.opens_at && Date.parse(card.opens_at) > now);
  const closed = card.status === 'closed' || card.status === 'archived' || (card.closes_at && Date.parse(card.closes_at) <= now);
  const mins = card.time_limit_sec ? Math.round(card.time_limit_sec / 60) : null;
  const heading = card.type === 'daily_quiz' ? shortTitle(card.title) : card.title;

  return (
    <div className="page no-nav oq">
      <Link to={session ? '/' : '/welcome'} className="brand-row" aria-label="KAIRO home"><Logo height={26} /></Link>
      <div className="oq-card">
        <p className="eyebrow">{card.type === 'challenge' ? 'TECHMED CHALLENGE' : card.type === 'daily_quiz' ? 'DAILY BUILDER QUIZ' : 'TECHMED QUIZ'}</p>
        <h1>{heading}</h1>
        <div className="oq-chips">
          <span>{card.question_count} questions</span>
          {mins && <span>{mins} minutes</span>}
          <span>{card.has_passcode ? 'Private' : 'Free'}</span>
        </div>
        {card.prize_text && <p className="oq-prize">🏆 {card.prize_text}</p>}
      </div>

      {scheduled ? (
        <p className="card">Opens {card.opens_at && new Date(card.opens_at).toLocaleString('en-NG', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' })}. Come back then.</p>
      ) : closed ? (
        <p className="card">This quiz has closed. Today’s quiz is waiting for you.</p>
      ) : isGuest && guestUsed && !resumeId ? (
        <GuestSignup id="guest-gate" source="gate" returnTo={`/q/${id}`} onSaved={() => setGuestUsed(false)}
          heading="Create your free account to play on"
          lead="You have used your free guest quiz. Sign up in 20 seconds to take this quiz, get on the leaderboard, see every explanation and keep your streak." />
      ) : (
        <>
          <ul className="oq-rules">
            <li>The timer starts when you tap Start and keeps running if you leave.</li>
            <li>Your answers save as you go. Lost network? Open this link again to carry on.</li>
            <li>Tap Submit when you are done, or it submits itself when time is up.</li>
            <li>Score, correct answers and an explanation for every question right after.</li>
            {card.ranked && <li>Your first attempt goes on the leaderboard. Retakes are for practice.</li>}
          </ul>
          {needCode && !resumeId && (
            <div className="field">
              <label htmlFor="pc">Passcode</label>
              <input id="pc" className="input" autoComplete="off" autoCapitalize="characters" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="From your class or group" />
            </div>
          )}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="oq-go">
            {resumeId
              ? <button className="btn btn-accent btn-lg btn-block" onClick={() => nav(`/cbt/${resumeId}`)}>Continue where you stopped</button>
              : <button className="btn btn-accent btn-lg btn-block" onClick={start} disabled={busy || (needCode && !passcode.trim())}>
                  {busy ? 'Starting…' : session || card.guests_allowed ? 'Start quiz' : 'Sign in to start'}</button>}
            {!session && card.guests_allowed && (
              <p className="muted small oq-note">Your first quiz is free as a guest. To be ranked, see the answers and keep playing, <Link to="/signin" onClick={() => rememberReturn(`/q/${id}`)} state={{ from: `/q/${id}`, mode: 'signup' }}>create a free account first</Link>.</p>
            )}
          </div>
        </>
      )}
      <Link className="btn btn-ghost btn-block" to={session ? `/quiz/${id}` : '/welcome'}>{session ? 'Leaderboard and past quizzes' : 'What is KAIRO?'}</Link>
    </div>
  );
}
