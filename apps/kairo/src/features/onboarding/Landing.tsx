import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Logo } from '../../ui/components';
import './onboarding.css';

export default function Landing() {
  const { session } = useAuth();
  if (session) return <Navigate to="/" replace />;
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand-row"><Logo height={30} /></div>
        <Link to="/signin" className="btn btn-sm landing-signin">Sign in</Link>
      </header>
      <section className="landing-hero">
        <p className="eyebrow on-dark">JAMB UTME CBT practice · by TECHMED</p>
        <h1>Practise like the real JAMB CBT. Understand every answer.</h1>
        <p className="landing-sub">13,000+ past questions from 1978 to 2025. After every question, KAIRO shows why the right answer is right and why each wrong option is wrong.</p>
        <div className="demo-card" aria-hidden="true">
          <div className="demo-q">Two resistors of 4 Ω and 6 Ω are joined in series. Total resistance?</div>
          <div className="demo-opt bad"><span>A</span>2 Ω<em>✗ Your pick</em></div>
          <p className="demo-why"><b>Why not A:</b> you subtracted. Resistances in series add.</p>
          <div className="demo-opt ok"><span>B</span>10 Ω<em>✓ Correct</em></div>
        </div>
      </section>
      <section className="landing-cta">
        <Link to="/signin" state={{ mode: 'signup' }} className="btn btn-accent btn-lg btn-block">Start practising free</Link>
        <ul className="landing-points">
          <li><b>Real CBT feel.</b> Timer, question palette, flag, JAMB calculator, keyboard shortcuts.</li>
          <li><b>Scores in JAMB terms.</b> Each subject out of 100, full mocks out of 400.</li>
          <li><b>Works on a bad network.</b> Answers save on your phone and sync when you are back online.</li>
          <li><b>No ads, no activation codes.</b></li>
        </ul>
        <img src="/brand/techmed-lockup-white.webp" alt="TECHMED" className="landing-techmed" height={22} />
      </section>
    </div>
  );
}
