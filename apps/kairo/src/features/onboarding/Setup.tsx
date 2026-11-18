import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { kvSet } from '../../lib/db';
import { ELECTIVES, SUBJECT_NAMES } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import './onboarding.css';

const YEARS = [2027, 2028, 2029];
export default function Setup() {
  const { profile, subjectCodes, saveProfile } = useAuth();
  const nav = useNavigate();
  const [year, setYear] = useState<number | null>(profile?.exam_year ?? 2027);
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.filter((c) => c !== 'ENG'));
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (c: SubjectCode) => setSubs((s) => s.includes(c) ? s.filter((x) => x !== c) : s.length >= 3 ? s : [...s, c]);
  const ready = !!year && subs.length === 3;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const track = subs.includes('BIO') && subs.includes('CHM') ? 'medical' : subs.includes('MTH') && subs.includes('PHY') ? 'engineering' : 'other';
      await saveProfile({ exam_year: year, track, subjectCodes: ['ENG', ...subs] });
      if (target) await kvSet('target', Number(target));
      nav('/tour', { replace: true });
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  return (
    <div className="page no-nav stack">
      <div className="steps-dots" aria-label="Step 1 of 3"><i className="on" /><i /><i /></div>
      <div className="stack-sm"><h1>Set up your practice</h1><p className="muted">Three quick choices. You can change them later.</p></div>

      <section className="stack-sm">
        <h3>When are you writing JAMB?</h3>
        <div className="chip-row">
          {YEARS.map((y) => <button key={y} className="chip chip-lg" aria-pressed={year === y} onClick={() => setYear(y)}>UTME {y}</button>)}
        </div>
      </section>

      <section className="stack-sm">
        <h3>Your subjects</h3>
        <p className="muted small">English is compulsory. Pick 3 more ({subs.length}/3).</p>
        <div className="subj-pick">
          <button className="subj-opt" aria-pressed disabled><span>English</span><small>Compulsory</small></button>
          {ELECTIVES.map((c) => (
            <button key={c} className="subj-opt" aria-pressed={subs.includes(c)} onClick={() => toggle(c)}
              disabled={!subs.includes(c) && subs.length >= 3}><span>{SUBJECT_NAMES[c]}</span></button>
          ))}
        </div>
      </section>

      <section className="stack-sm">
        <h3>Target score <span className="muted small">(optional)</span></h3>
        <div className="chip-row">
          {['200', '250', '280', '300', '320'].map((t) => (
            <button key={t} className="chip" aria-pressed={target === t} onClick={() => setTarget(target === t ? '' : t)}>{t}+</button>
          ))}
        </div>
      </section>

      {err && <p className="error">{err}</p>}
      <div className="sticky-cta">
        <button className="btn btn-primary btn-lg btn-block" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  );
}
