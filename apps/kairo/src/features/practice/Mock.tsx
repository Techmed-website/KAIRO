import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ELECTIVES, SUBJECT_NAMES } from '../../lib/subjects';
import type { SubjectCode } from '../../lib/types';
import { IcBack } from '../../ui/icons';
import { useStart } from './common';

export default function Mock() {
  const { subjectCodes } = useAuth();
  const { busy, start } = useStart();
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.filter((c) => c !== 'ENG').slice(0, 3));
  const toggle = (c: SubjectCode) => setSubs((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length >= 3 ? s : [...s, c]);
  return (
    <div className="page stack">
      <div className="row"><Link to="/practice" className="icon-btn" aria-label="Back"><IcBack /></Link><h1>Full JAMB mock</h1></div>
      <div className="card mock-facts">
        <div><b className="num">180</b><span className="muted small">questions</span></div>
        <div><b className="num">2 h</b><span className="muted small">timer</span></div>
        <div><b className="num">/400</b><span className="muted small">scoring</span></div>
      </div>
      <section className="stack-sm"><h3>Your subjects</h3><p className="muted small">English (60 questions) plus 3 subjects (40 each).</p>
        <div className="chip-row">
          <button className="chip" aria-pressed disabled>English</button>
          {ELECTIVES.map((c) => <button key={c} className="chip" aria-pressed={subs.includes(c)} disabled={!subs.includes(c) && subs.length >= 3} onClick={() => toggle(c)}>{SUBJECT_NAMES[c]}</button>)}
        </div>
      </section>
      <ul className="rules">
        <li>Answers and explanations open after you submit, as in the real exam.</li>
        <li>The timer keeps running if you leave. At zero your answers are submitted automatically.</li>
        <li>Use the palette to move between subjects and the basic calculator for sums.</li>
      </ul>
      <div className="sticky-start">
        <button className="btn btn-accent btn-lg btn-block" disabled={subs.length !== 3 || busy} onClick={() => start({ mode: 'mock', subjects: subs })}>
          {busy ? 'Preparing your paper…' : 'Start mock'}</button>
      </div>
    </div>
  );
}
