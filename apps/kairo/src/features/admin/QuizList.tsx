import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { Tabs } from '../../ui/components';
import { StaffOnly } from './StaffOnly';
import { fmt, listQuizzes, TYPE_LABEL, type AdminQuizRow } from './data';
import './admin.css';

type Filter = 'all' | 'challenge' | 'daily_quiz' | 'archived';

/** Editors: every quiz, challenge and competition, newest first. */
export default function QuizList() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminQuizRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setRows(null);
    const p = filter === 'archived' ? { status: 'archived' } : filter === 'all' ? {} : { type: filter };
    const t = setTimeout(() => listQuizzes({ ...p, q }).then(setRows).catch((e) => setErr(friendlyError(e))), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filter, q]);

  return (
    <StaffOnly>
      <div className="page stack admin">
        <div className="row-between">
          <div><p className="eyebrow">TECHMED editors</p><h1>Quizzes</h1></div>
          <Link className="btn btn-accent" to="/editor/quizzes/new">+ New quiz</Link>
        </div>
        <Tabs value={filter} onChange={setFilter} label="Filter" items={[
          { value: 'all', label: 'All' }, { value: 'challenge', label: 'Challenges' }, { value: 'daily_quiz', label: 'Daily' }, { value: 'archived', label: 'Archived' }]} />
        <input className="input" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p className="card error">{err}</p>}
        {!rows ? <div className="skeleton" style={{ height: 240 }} /> : rows.length === 0 ? (
          <p className="card muted">Nothing here yet. Tap “New quiz” to create a challenge in a few steps.</p>
        ) : rows.map((r) => (
          <Link key={r.id} to={`/editor/quizzes/${r.id}`} className="card card-link aq-row">
            <div className="grow">
              <div className="aq-tags">
                <span className={`badge st-${r.status}`}>{r.status}</span>
                <span className="badge">{TYPE_LABEL[r.type] ?? r.type}</span>
                {r.featured && <span className="badge badge-ok">featured</span>}
                {r.has_passcode && <span className="badge">🔐 private</span>}
              </div>
              <b>{r.title}</b>
              <span className="muted small block">
                {r.question_count} questions · {r.players} played · opens {fmt(r.opens_at)}{r.prize_text ? ` · 🏆 ${r.prize_text}` : ''}
              </span>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </StaffOnly>
  );
}
