import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { cbt, friendlyError } from '../../lib/supabase';
import { Sheet, toast } from '../../ui/components';
import { IcFlag } from '../../ui/icons';

const REASONS = [
  { v: 'wrong_key', l: 'The answer is wrong' },
  { v: 'typo', l: 'Typo or error' },
  { v: 'unclear', l: 'Unclear question' },
  { v: 'missing_content', l: 'Missing diagram or text' },
  { v: 'other', l: 'Something else' },
] as const;

export function ReportButton({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="report-btn" onClick={() => setOpen(true)}><IcFlag />Report this question</button>
      {open && <ReportSheet questionId={questionId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportSheet({ questionId, onClose }: { questionId: string; onClose: () => void }) {
  const { session } = useAuth();
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!reason || !session) return;
    setBusy(true); setErr('');
    const { error } = await cbt().from('question_reports')
      .insert({ question_id: questionId, user_id: session.user.id, reason, note: note.trim() || null });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onClose();
    toast('Thanks, a TECHMED tutor will check it.');
  };
  return (
    <Sheet open onClose={onClose} label="Report this question">
      <div className="sheet-body stack">
        <div className="stack-sm"><h2>Report this question</h2><p className="muted small">What is wrong with it?</p></div>
        <div className="chip-row">
          {REASONS.map((r) => (
            <button key={r.v} className="chip" aria-pressed={reason === r.v} onClick={() => setReason(r.v)}>{r.l}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="report-note">Add a note (optional)</label>
          <textarea id="report-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={reason === 'wrong_key' ? 'Which option do you think is right, and why?' : 'Tell the tutor what you noticed'} />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button className="btn grow" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary grow" disabled={!reason || busy} onClick={send}>{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </div>
    </Sheet>
  );
}
