import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { SubjectCode } from '../../lib/types';
import { IcNext, IcSearch } from '../../ui/icons';
import { CatalogError, Skel, useCatalog, useTopicStats } from './common';
import { Progress, TopicSheet } from './StartSheets';
import { BackBar } from './SubjectPractice';

type Filter = 'all' | 'new' | 'weak' | 'strong';
const pctOf = (s?: { attempted: number; correct: number }) => (s && s.attempted ? (100 * s.correct) / s.attempted : null);

/** Every syllabus topic in a subject, with its question count and the student's own progress. Tap one to practise it. */
export default function Topics() {
  const { code = 'ENG' } = useParams();
  const subject = code as SubjectCode;
  const [params, setParams] = useSearchParams();
  const { cat, err } = useCatalog();
  const stats = useTopicStats();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const s = cat?.find((x) => x.code === subject);
  const open = Number(params.get('t')) || null;
  const practised = !!stats && (s?.topics ?? []).some((t) => stats.get(t.id)?.attempted);

  const list = useMemo(() => (s?.topics ?? []).filter((t) => {
    if (q.trim() && !t.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    const p = pctOf(stats?.get(t.id));
    if (filter === 'new') return p == null;
    if (filter === 'weak') return p != null && p < 50;
    if (filter === 'strong') return p != null && p >= 80;
    return true;
  }), [s, q, filter, stats]);

  const setOpen = (id: number | null) => { const n = new URLSearchParams(params); if (id) n.set('t', String(id)); else n.delete('t'); setParams(n, { replace: true }); };

  return (
    <div className="page px">
      <BackBar name="Topics" to={`/practice/${subject}`} parent={s?.name ?? 'Subject'} />
      <div className="stack-sm"><h1>Browse by topic</h1><p className="muted small">JAMB syllabus topics in {s?.name ?? 'this subject'}. Tap a topic to practise it.</p></div>
      <div className="search"><IcSearch aria-hidden="true" />
        <label htmlFor="tq" className="sr-only">Search topics</label>
        <input id="tq" type="search" className="input" placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
      </div>
      {practised && (
        <div className="chip-row" role="group" aria-label="Filter topics">
          {([['all', 'All'], ['new', 'Not started'], ['weak', 'Needs work'], ['strong', 'Strong']] as [Filter, string][]).map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>))}
        </div>
      )}
      {err ? <CatalogError err={err} /> : !s ? <Skel h={64} n={6} /> : list.length === 0 ? (
        <p className="card muted">{(s.topics ?? []).length === 0 ? 'Topics for this subject are being organised. Browse by year in the meantime.' : 'No topic matches. Clear the search or filter.'}</p>
      ) : (
        <div className="tp-list">
          {list.map((t) => (
            <button key={t.id} type="button" className="tp" onClick={() => setOpen(t.id)}>
              <span className="grow"><b>{t.name}</b><Progress stat={stats?.get(t.id)} /></span>
              <span className="tp-n num"><b>{t.count.toLocaleString()}</b><small>questions</small></span>
              <IcNext className="chev" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <TopicSheet subject={subject} topic={(s?.topics ?? []).find((t) => t.id === open) ?? null} stat={open ? stats?.get(open) : undefined} onClose={() => setOpen(null)} />
    </div>
  );
}
