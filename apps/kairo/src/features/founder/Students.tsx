import { useState } from 'react';
import { useFounder } from './Founder';
import { describe, FEATURE_LABEL, fmtDateTime, fmtDay, getStudent, getStudents, num, type StudentRow } from './data';
import { ErrorCard, Loading } from './ui';
import { useLoad } from './useLoad';

const SEGMENTS = [
  { value: 'all', label: 'All' }, { value: 'new', label: 'New (7 days)' }, { value: 'active', label: 'Active (7 days)' },
  { value: 'inactive', label: 'Inactive 7+ days' }, { value: 'engaged', label: 'Highly engaged' },
  { value: 'never_practised', label: 'Registered, never practised' }, { value: 'started_not_completed', label: 'Started, never completed' },
];
const PAGE = 25;

/** Usage patterns per student, by privacy-safe code only (no names, emails or phone numbers). Lifetime figures. */
export default function Students() {
  const { refreshKey } = useFounder();
  const [segment, setSegment] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<StudentRow | null>(null);
  const { data, error, loading, reload } = useLoad(() => getStudents(segment, search, PAGE, page * PAGE), [segment, search, page, refreshKey]);

  if (open) return <Detail row={open} onBack={() => setOpen(null)} />;
  return (
    <div className="stack">
      <div className="card stack-sm">
        <div className="chip-row" role="group" aria-label="Segment">
          {SEGMENTS.map((s) => <button key={s.value} type="button" className={`chip ${segment === s.value ? 'chip-on' : ''}`} aria-pressed={segment === s.value}
            onClick={() => { setSegment(s.value); setPage(0); }}>{s.label}</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(0); }}>
          <input className="input" placeholder="Student code, e.g. S-3F9A2C" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by student code" />
          <button className="btn btn-sm">Search</button>
        </form>
        <p className="muted small">Lifetime figures. "Highly engaged": active on 3+ days in the last 14 and 3+ completed sessions. Sessions are counted only since event tracking began.</p>
      </div>
      {error ? <ErrorCard error={error} onRetry={reload} /> : !data ? <Loading h={400} /> : (
        <>
          <p className="small muted" aria-live="polite">{num(data.total)} student{data.total === 1 ? '' : 's'}{loading ? ' · updating…' : ''}</p>
          {data.rows.length === 0 ? <p className="card muted">No students in this segment.</p> : (
            <div className="fi-table-wrap card"><table className="fi-table">
              <thead><tr><th>Student</th><th>Registered</th><th>Last active</th><th className="num">Active days</th><th className="num">Sessions</th>
                <th className="num">Questions</th><th className="num">Practice done</th><th className="num">Quizzes done</th><th className="num">Mocks done</th><th>Features used</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.user_id}>
                  <th scope="row"><button className="fi-link num" onClick={() => setOpen(r)}>{r.student}</button></th>
                  <td>{fmtDay(r.registered_at.slice(0, 10))}</td><td>{r.last_active ? fmtDateTime(r.last_active) : <span className="muted">never</span>}</td>
                  <td className="num">{num(r.active_days)}</td><td className="num">{r.sessions == null ? '—' : num(r.sessions)}</td>
                  <td className="num">{num(r.questions)}</td><td className="num">{num(r.practice_completed)}</td><td className="num">{num(r.quizzes_completed)}</td>
                  <td className="num">{num(r.mocks_completed)}</td><td className="small">{r.features.map((f) => FEATURE_LABEL[f] ?? f).join(', ') || '—'}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <div className="row-between">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
            <span className="small muted">Page {page + 1} of {Math.max(1, Math.ceil(data.total / PAGE))}</span>
            <button className="btn btn-sm" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        </>
      )}
    </div>
  );
}

function Detail({ row, onBack }: { row: StudentRow; onBack: () => void }) {
  const { data, error, reload } = useLoad(() => getStudent(row.user_id), [row.user_id]);
  return (
    <div className="stack">
      <button className="btn btn-sm" onClick={onBack}>‹ All students</button>
      <section className="card stack-sm">
        <h2 className="num">{row.student}</h2>
        <div className="fi-grid2">
          <Mini l="Registered" v={fmtDay(row.registered_at.slice(0, 10))} /><Mini l="Last active" v={row.last_active ? fmtDateTime(row.last_active) : 'never'} />
          <Mini l="Active days" v={num(row.active_days)} /><Mini l="Sessions" v={row.sessions == null ? '—' : num(row.sessions)} />
          <Mini l="Questions answered" v={num(row.questions)} /><Mini l="Practice completed" v={num(row.practice_completed)} />
          <Mini l="Quizzes completed" v={num(row.quizzes_completed)} /><Mini l="Mocks completed" v={num(row.mocks_completed)} />
          {data && <><Mini l="UTME year" v={data.exam_year ? String(data.exam_year) : '—'} /><Mini l="Subjects chosen" v={String(data.subject_count)} /></>}
        </div>
      </section>
      {error ? <ErrorCard error={error} onRetry={reload} /> : !data ? <Loading /> : (
        <>
          {data.by_feature.length > 0 && <section className="card stack-sm"><h3>By feature</h3>
            <div className="fi-table-wrap"><table className="fi-table"><thead><tr><th>Feature</th><th className="num">Started</th><th className="num">Completed</th><th className="num">Questions</th></tr></thead>
              <tbody>{data.by_feature.map((f) => <tr key={f.feature}><td>{FEATURE_LABEL[f.feature] ?? f.feature}</td><td className="num">{f.starts}</td><td className="num">{f.completed}</td><td className="num">{num(f.questions)}</td></tr>)}</tbody></table></div></section>}
          <section className="card stack-sm"><h3>Recent activity</h3>
            {data.timeline.length === 0 ? <p className="muted">No activity yet.</p> : <ol className="fi-feed">{data.timeline.map((t, i) => (
              <li key={i} className={`fi-feed-item fi-k-${t.kind}`}><time dateTime={t.at}>{fmtDateTime(t.at)}</time>
                <span className="grow">{describe({ ...t, name: t.name ?? '', props: {} })}</span></li>))}</ol>}
          </section>
        </>
      )}
    </div>
  );
}
const Mini = ({ l, v }: { l: string; v: string }) => <div className="fi-stat"><span className="fi-stat-v num">{v}</span><span className="small">{l}</span></div>;
