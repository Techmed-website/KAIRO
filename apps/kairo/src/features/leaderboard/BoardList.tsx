import { formatDuration } from '../../lib/score';
import { SHORT } from '../../lib/subjects';
import type { SubjectCode } from '../../lib/types';

export interface BoardRow {
  rank: number; name: string; score: number; max: number; duration_sec: number | null; accuracy: number;
  subjects?: SubjectCode[]; subject_scores?: Partial<Record<SubjectCode, number>>; is_me: boolean;
}

/** Podium for the top three, then the rest as a list. `breakdown` shows each row's subject-by-subject scores. */
export function BoardList({ rows, max, breakdown }: { rows: BoardRow[]; max: number; breakdown: boolean }) {
  const top3 = rows.slice(0, 3);
  return (
    <>
      <div className="podium" aria-label="Top three">
        {[1, 0, 2].map((i) => top3[i] && (
          <div key={i} className={`pod p${i + 1} ${top3[i].is_me ? 'me' : ''}`}>
            <span className="pod-avatar" aria-hidden="true">{initials(top3[i].name)}</span>
            <b className="pod-name">{top3[i].is_me ? 'You' : top3[i].name}</b>
            <span className="pod-val num">{top3[i].score}<small>/{max}</small></span>
            <span className="pod-acc num">{time(top3[i].duration_sec)}</span>
            {breakdown && <span className="pod-acc num">{subjectLine(top3[i])}</span>}
            <div className="pod-step"><span>{i + 1}</span></div>
          </div>
        ))}
      </div>
      {rows.length > 3 && (
        <ol className="lb-list" aria-label="Rankings">
          {rows.slice(3).map((r) => (
            <li key={r.rank + r.name} className={`lb-row ${r.is_me ? 'me' : ''}`}>
              <span className="lb-rank num">{r.rank}</span>
              <span className="pod-avatar sm" aria-hidden="true">{initials(r.name)}</span>
              <div className="grow"><b>{r.is_me ? 'You' : r.name}</b>
                <p className="muted small num">{[time(r.duration_sec), breakdown ? subjectLine(r) : ''].filter(Boolean).join(' · ')}</p></div>
              <b className="num lb-score">{r.score}<small className="muted">/{max}</small></b>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** "Eng 72 · Bio 64" (or just the subject names when scores are missing). */
export function subjectLine(r: Pick<BoardRow, 'subjects' | 'subject_scores'>) {
  const s = r.subject_scores;
  if (s) return (Object.keys(s) as SubjectCode[]).sort(engFirst).map((c) => `${SHORT[c]} ${s[c]}`).join(' · ');
  return (r.subjects ?? []).map((c) => SHORT[c]).join(', ');
}
const engFirst = (a: string, b: string) => (a === 'ENG' ? -1 : b === 'ENG' ? 1 : a.localeCompare(b));
export const time = (s: number | null) => (s == null ? '' : formatDuration(s));
export const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
