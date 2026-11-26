import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SubjectCode } from '../../lib/types';
import { IcArrowRight, IcBack, IcBolt, IcCalendar, IcLayers, IcList, IcNext, IcSearch } from '../../ui/icons';
import { SUBJECT_ICONS } from '../../ui/subjectIcons';
import { CatalogError, Skel, useCatalog, useStart, useTopicStats } from './common';
import { AllSheet, Progress, TopicSheet } from './StartSheets';

/** One subject's question bank: header, topic search, totals, and three ways in (topic, year, all). */
export default function SubjectPractice() {
  const { code = 'ENG' } = useParams();
  const subject = code as SubjectCode;
  const { cat, err } = useCatalog();
  const stats = useTopicStats();
  const { busy, start } = useStart();
  const [q, setQ] = useState('');
  const [topicId, setTopicId] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const s = cat?.find((x) => x.code === subject);
  const I = SUBJECT_ICONS[subject] ?? IcLayers;
  const topics = s?.topics ?? [];
  const years = s?.years ?? [];
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t.length < 2 ? [] : topics.filter((x) => x.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, topics]);
  const range = years.length ? `${Math.min(...years.map((y) => y.year))}–${Math.max(...years.map((y) => y.year))}` : null;

  if (cat && !s) {
    return <div className="page stack"><BackBar name="Subject" /><p className="card">This subject is not in the question bank.</p><Link className="btn btn-block" to="/practice">Back to Practice</Link></div>;
  }

  return (
    <div className="page px">
      <BackBar name={s?.name} />
      {err ? <CatalogError err={err} /> : !s ? <Skel h={80} n={4} /> : (
        <>
          <header className={`subj-head s-${subject}`}>
            <span className="tint-ic big" aria-hidden="true"><I /></span>
            <div className="grow">
              <h1>{s.name}</h1>
              <p className="muted small num">{s.count.toLocaleString()} questions · {years.length} years · {topics.length} topics</p>
            </div>
          </header>

          <section className="find">
            <label htmlFor="topic-q" className="find-l">Find a topic</label>
            <div className="search"><IcSearch aria-hidden="true" />
              <input id="topic-q" type="search" className="input" placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
            </div>
            {q.trim().length >= 2 && (
              hits.length ? (
                <div className="hits" role="list">
                  {hits.map((t) => (
                    <button key={t.id} type="button" role="listitem" className="hit" onClick={() => setTopicId(t.id)}>
                      <span className="grow"><b>{t.name}</b><Progress stat={stats?.get(t.id)} /></span>
                      <span className="muted small num">{t.count}</span><IcNext className="chev" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : <p className="muted small">No topic matches “{q.trim()}”. Try a shorter word, or browse all topics below.</p>
            )}
          </section>

          <div className="stat-duo">
            <div className="stat"><span className="eyebrow">Total questions</span><b className="num">{s.count.toLocaleString()}</b></div>
            <div className="stat"><span className="eyebrow">Topics</span><b className="num">{topics.length}</b>{range && <span className="muted small num">Years {range}</span>}</div>
          </div>

          <section className="stack-sm" aria-labelledby="h-explore-bank">
            <h2 id="h-explore-bank">Explore question bank</h2>
            <Link to={`/practice/${subject}/topics`} className="way way-main">
              <span className="grow"><b>Browse by topic</b><span className="muted small">Find questions on specific areas of {s.name}, with your progress on each.</span>
                <span className="gold-link small">Explore {topics.length} topics <IcArrowRight /></span></span>
              <span className="gold-ic" aria-hidden="true"><IcLayers /></span>
            </Link>
            <Link to={`/practice/${subject}/years`} className="way">
              <span className="grow"><b>Browse by year</b><span className="muted small">Practise real past papers from different examination years.</span>
                <span className="gold-link small">Choose a year <IcArrowRight /></span></span>
              <span className="gold-ic" aria-hidden="true"><IcCalendar /></span>
            </Link>
            <button type="button" className="way" onClick={() => setAll(true)}>
              <span className="grow"><b>All {s.name} questions</b><span className="muted small">Practise from the complete collection. Questions you haven’t seen come first.</span>
                <span className="gold-link small">Start a session <IcArrowRight /></span></span>
              <span className="gold-ic" aria-hidden="true"><IcList /></span>
            </button>
          </section>

          <button type="button" className="btn btn-block quick-10" disabled={busy} onClick={() => start({ mode: 'mixed', subjects: [{ code: subject, count: 10 }], feedback: 'instant' })}>
            <IcBolt />{busy ? 'Picking questions…' : `Quick 10 ${s.name} questions`}
          </button>

          <TopicSheet subject={subject} topic={topics.find((t) => t.id === topicId) ?? null} stat={topicId ? stats?.get(topicId) : undefined} onClose={() => setTopicId(null)} />
          <AllSheet subject={subject} name={s.name} total={s.count} open={all} onClose={() => setAll(false)} />
        </>
      )}
    </div>
  );
}

export function BackBar({ name, to = '/practice', parent = 'Practice' }: { name?: string; to?: string; parent?: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to={to} className="icon-btn" aria-label={`Back to ${parent}`}><IcBack /></Link>
      <Link to={to} className="crumb-link">{parent}</Link><span aria-hidden="true">/</span><span className="crumb-here">{name ?? '…'}</span>
    </nav>
  );
}
