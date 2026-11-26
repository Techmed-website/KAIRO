import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startPractice } from '../../lib/session';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import { Sheet, toast } from '../../ui/components';
import { SUBJECT_ICONS } from './subjects';

const ALL: SubjectCode[] = ['ENG', 'MTH', 'PHY', 'CHM', 'BIO'];

/** "Practise 10 more questions": the student picks a subject, then KAIRO builds a 10-question practice with instant feedback. */
export function PractiseSheet({ open, onClose, mine }: { open: boolean; onClose: () => void; mine: SubjectCode[] }) {
  const nav = useNavigate();
  const [pick, setPick] = useState<SubjectCode | null>(null);
  const [busy, setBusy] = useState(false);
  const ordered = [...mine.filter((c) => ALL.includes(c)), ...ALL.filter((c) => !mine.includes(c))];

  const go = async () => {
    if (!pick) return;
    setBusy(true);
    try { nav(`/cbt/${await startPractice({ mode: 'mixed', subjects: [{ code: pick, count: 10 }], feedback: 'instant' })}`); }
    catch (e) { toast(friendlyError(e)); setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} label="Practise 10 questions">
      <div className="sheet-body stack">
        <div className="stack-sm"><h2>Practise 10 questions</h2><p className="muted small">Pick a subject. You’ll see the answer and explanation after each question.</p></div>
        <div className="pick-grid" role="radiogroup" aria-label="Subject">
          {ordered.map((c) => {
            const Ic = SUBJECT_ICONS[c];
            return (
              <button key={c} type="button" role="radio" aria-checked={pick === c} className="pick" onClick={() => setPick(c)}>
                <Ic aria-hidden="true" /><span>{subjectName(c)}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary btn-lg btn-block" disabled={!pick || busy} onClick={go}>
          {busy ? 'Picking questions…' : pick ? `Start 10 ${subjectName(pick)} questions` : 'Choose a subject'}
        </button>
      </div>
    </Sheet>
  );
}
