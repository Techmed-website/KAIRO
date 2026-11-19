import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { SUBJECT_NAMES } from '../../lib/subjects';
import type { SubjectCode } from '../../lib/types';
import { IcBack } from '../../ui/icons';
import { OptionsPicker, suggestedSec, useStart, type Opts } from './common';

const ALL: SubjectCode[] = ['ENG', 'MTH', 'PHY', 'CHM', 'BIO'];
const FROM = 1978, TO = 2025;

export default function Mixed() {
  const { subjectCodes } = useAuth();
  const { busy, start } = useStart();
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.length ? subjectCodes : ['ENG']);
  const [per, setPer] = useState(10);
  const [years, setYears] = useState<[number, number]>([2010, TO]);
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  const total = subs.length * per;
  const go = () => start({ mode: 'mixed', subjects: subs.map((code) => ({ code, count: per })), years, feedback: opts.feedback,
    time_limit_sec: opts.timed ? suggestedSec(total) : null });
  return (
    <div className="page stack">
      <div className="row"><Link to="/practice" className="icon-btn" aria-label="Back"><IcBack /></Link><h1>Mixed practice</h1></div>
      <section className="stack-sm"><h3>Subjects</h3>
        <div className="chip-row">{ALL.map((c) => (
          <button key={c} className="chip" aria-pressed={subs.includes(c)} onClick={() => setSubs(subs.includes(c) ? subs.filter((x) => x !== c) : [...subs, c])}>{SUBJECT_NAMES[c]}</button>))}</div>
      </section>
      <section className="stack-sm"><h3>Questions per subject</h3>
        <div className="chip-row">{[5, 10, 20, 40].map((n) => <button key={n} className="chip" aria-pressed={per === n} onClick={() => setPer(n)}>{n}</button>)}</div>
      </section>
      <section className="stack-sm"><h3>Years</h3>
        <div className="row">
          <label className="sr-only" htmlFor="y-from">From year</label>
          <select id="y-from" className="input" value={years[0]} onChange={(e) => setYears([+e.target.value, Math.max(+e.target.value, years[1])])}>
            {range(FROM, TO).map((y) => <option key={y}>{y}</option>)}</select>
          <span className="muted">to</span>
          <label className="sr-only" htmlFor="y-to">To year</label>
          <select id="y-to" className="input" value={years[1]} onChange={(e) => setYears([Math.min(years[0], +e.target.value), +e.target.value])}>
            {range(FROM, TO).map((y) => <option key={y}>{y}</option>)}</select>
        </div>
        <div className="chip-row">
          <button className="chip" onClick={() => setYears([2015, TO])}>Last 10 years</button>
          <button className="chip" onClick={() => setYears([FROM, TO])}>All years</button>
        </div>
      </section>
      <OptionsPicker value={opts} onChange={setOpts} count={total} />
      <div className="sticky-start">
        <button className="btn btn-primary btn-lg btn-block" disabled={!subs.length || busy} onClick={go}>{busy ? 'Preparing…' : `Start · ${total} questions`}</button>
      </div>
    </div>
  );
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => b - i).filter((y) => y !== 1996);
