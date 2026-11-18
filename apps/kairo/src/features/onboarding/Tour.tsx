import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IcCalc, IcFlag, IcGrid } from '../../ui/icons';
import './onboarding.css';

const STEPS = [
  { title: 'Practise your way', body: 'Pick a past year, a JAMB topic, a mix of subjects, or a full 2-hour mock. KAIRO serves questions you have not seen first.',
    art: <div className="tour-art grid4">{['By year', 'By topic', 'Mixed', 'Full mock'].map((t) => <span key={t}>{t}</span>)}</div> },
  { title: 'The real CBT controls', body: 'Flag a question to come back to it. Open the palette to jump anywhere. The calculator is the same basic one JAMB gives you.',
    art: <div className="tour-art tools"><span><IcGrid />Palette</span><span><IcCalc />Calculator</span><span className="flag"><IcFlag />Flag</span></div> },
  { title: 'Learn from every mistake', body: 'After each answer you see why the right option is right and why each wrong option is wrong, like a TECHMED tutor beside you.',
    art: <div className="tour-art why"><div className="o bad">B · 2 Ω ✗</div><p><b>Why not B:</b> resistances in series add, they never cancel.</p><div className="o ok">C · 10 Ω ✓</div></div> },
];

export default function Tour() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const go = () => nav('/starter', { replace: true });
  const s = STEPS[i];
  return (
    <div className="page no-nav tour">
      <div className="row-between">
        <div className="steps-dots" aria-label={`Tour ${i + 1} of 3`}>{STEPS.map((_, j) => <i key={j} className={j <= i ? 'on' : ''} />)}</div>
        <button className="btn btn-ghost btn-sm" onClick={go}>Skip</button>
      </div>
      <div className="tour-card">
        {s.art}
        <h1>{s.title}</h1>
        <p className="muted">{s.body}</p>
      </div>
      <div className="sticky-cta">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => (i < 2 ? setI(i + 1) : go())}>
          {i < 2 ? 'Next' : 'Try 10 quick questions'}</button>
      </div>
    </div>
  );
}
