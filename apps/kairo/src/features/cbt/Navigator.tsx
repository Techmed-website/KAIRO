import { useEffect, useState } from 'react';
import { subjectName } from '../../lib/subjects';
import type { LocalAttempt, Paper } from '../../lib/types';

export interface SubjectRange { code: string; start: number; end: number }

/** Every question as a numbered square: answered, unanswered, current, flagged. Per-subject tabs with progress; a Flagged filter. */
export function Navigator({ qs, att, subjects, onJump, instant }: {
  qs: Paper['questions']; att: LocalAttempt; subjects: SubjectRange[]; onJump: (i: number) => void; instant: boolean;
}) {
  const cur = subjects.find((s) => att.current >= s.start && att.current <= s.end) ?? subjects[0];
  const [code, setCode] = useState(cur.code);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  useEffect(() => { setCode(cur.code); }, [cur.code]); // follow the student into the next subject
  const s = subjects.find((x) => x.code === code) ?? cur;
  const flagged = qs.map((x, i) => ({ x, i })).filter(({ x }) => att.answers[x.id]?.flagged);
  const items = flaggedOnly ? flagged : qs.slice(s.start, s.end + 1).map((x, j) => ({ x, i: s.start + j }));
  const numberOf = (i: number) => { const r = subjects.find((t) => i >= t.start && i <= t.end); return r ? i - r.start + 1 : i + 1; };

  return (
    <div className="xnav">
      <div className="chip-scroll" role="group" aria-label="Show questions">
        {subjects.length > 1 && subjects.map((x) => {
          const n = qs.slice(x.start, x.end + 1).filter((y) => att.answers[y.id]?.selected).length;
          return <button key={x.code} type="button" className="chip num" aria-pressed={!flaggedOnly && x.code === code} onClick={() => { setCode(x.code); setFlaggedOnly(false); }}>{subjectName(x.code)} {n}/{x.end - x.start + 1}</button>;
        })}
        <button type="button" className="chip num flag-chip" aria-pressed={flaggedOnly} disabled={!flagged.length && !flaggedOnly} onClick={() => setFlaggedOnly(!flaggedOnly)}>Flagged {flagged.length}</button>
      </div>
      {items.length === 0 ? <p className="muted small">No flagged questions. Use Flag on a question to come back to it here.</p> : (
        <div className="pal-grid">
          {items.map(({ x, i }) => {
            const a = att.answers[x.id];
            const right = instant && a?.selected ? a.selected === x.correct_option : null;
            const n = numberOf(i);
            const label = `${flaggedOnly && subjects.length > 1 ? subjectName(x.subject) + ' ' : ''}Question ${n}${a?.selected ? ', answered' : ', not answered'}${a?.flagged ? ', flagged' : ''}${i === att.current ? ', current' : ''}`;
            return (
              <button key={x.id} type="button" onClick={() => onJump(i)} aria-label={label} aria-current={i === att.current ? 'true' : undefined}
                className={`pal ${a?.selected ? 'ans' : ''} ${right === true ? 'ok' : right === false ? 'bad' : ''} ${a?.flagged ? 'flg' : ''} ${i === att.current ? 'cur' : ''}`}>
                {flaggedOnly && subjects.length > 1 ? <><small>{x.subject}</small>{n}</> : n}
              </button>
            );
          })}
        </div>
      )}
      <div className="pal-legend" aria-hidden="true">
        <span><i className="sw ans" />Answered</span><span><i className="sw" />Not answered</span>
        <span><i className="sw cur" />Current</span><span><i className="sw flg" />Flagged</span>
      </div>
    </div>
  );
}
