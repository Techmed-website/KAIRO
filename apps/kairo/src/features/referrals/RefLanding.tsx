import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { captureReferral } from '../../lib/referral';
import { Logo, Spinner } from '../../ui/components';
import { loadHub } from '../quizzes/data';
import { RefBadge } from './RefBadge';
import './referrals.css';

/** /r/:code — a friend's invite. Records the visit, keeps the code (first touch), then offers sign-up or a free guest quiz. */
export default function RefLanding() {
  const { code = '' } = useParams();
  const { session, loading } = useAuth();
  const [info, setInfo] = useState<{ valid: boolean; referrer_first_name?: string | null; enabled?: boolean } | null>(null);
  const [todayId, setTodayId] = useState<string | null>(null);
  useEffect(() => { captureReferral(code).then(setInfo); loadHub().then((h) => setTodayId(h.today?.id ?? null)).catch(() => {}); }, [code]);

  if (loading || !info) return <Spinner label="Opening your invite" />;
  if (session && !session.user.is_anonymous) return <Navigate to="/" replace />;   // already a student: the claim runs in the background
  const who = info.valid && info.referrer_first_name ? info.referrer_first_name : null;

  return (
    <div className="page no-nav refland">
      <div className="brand-row"><Logo height={28} /></div>
      <section className="ref-hero land">
        <RefBadge code="ref_1" size={80} label="Proudly KAIRO" />
        <p className="ref-kicker">PROUDLY KAIRO · LEARN. REFER. INSPIRE.</p>
        <h1>{who ? `${who} invited you to KAIRO 👋` : 'You’re invited to KAIRO 👋'}</h1>
        <p>Free JAMB UTME CBT practice: 13,000+ past questions, every subject, an explanation for every answer. No activation code, no PIN, no catch.</p>
      </section>
      {!info.valid && <p className="card muted small">This invite code was not recognised, but KAIRO is still all yours.</p>}
      <div className="stack-sm">
        <Link className="btn btn-accent btn-lg btn-block" to="/signin" state={{ mode: 'signup' }}>Create my free account</Link>
        {todayId && <Link className="btn btn-lg btn-block" to={`/q/${todayId}`}>Try today’s quiz first</Link>}
        <Link className="btn btn-ghost btn-block" to="/signin">I already have an account</Link>
      </div>
      {who && <p className="muted small center-text">Sign up and finish your first practice, and {who} earns a Proudly KAIRO badge. Win-win. 🛡️</p>}
    </div>
  );
}
