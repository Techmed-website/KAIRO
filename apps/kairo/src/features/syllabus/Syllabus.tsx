import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCatalog } from '../../lib/catalog';
import { topicKey } from '../../lib/planner/engine';
import { loadPlan } from '../../lib/planner/store';
import { getSubjects, type Subject } from '../../lib/planner/syllabus';
import { kairoTopics, SLUG_CODE } from '../../lib/planner/topicMap';
import { IcArrowRight, IcBack, IcCalendar, IcCheck, IcNext } from '../../ui/icons';
import { SUBJECT_ICONS } from '../../ui/subjectIcons';
import { useStart } from '../practice/common';
import '../planner/planner.css';

const WEB = 'https://techmedng.com/jamb-syllabus';
const ORDER = ['use-of-english', 'physics', 'chemistry', 'biology', 'mathematics'];
const TIER: Record<string, string> = { high: 'High yield', medium: 'Medium yield', low: 'Low yield', foundational: 'Foundational' };

function useSyllabus() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { getSubjects().then(setSubjects).catch(() => setErr('The syllabus could not load. Check your connection.')); }, []);
  return { subjects, err };
}

function Crumbs({ here, parent }: { here: string; parent?: { to: string; label: string } }) {
  const p = parent ?? { to: '/', label: 'Home' };
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to={p.to} className="icon-btn" aria-label={`Back to ${p.label}`}><IcBack /></Link>
      <Link to={p.to} className="crumb-link">{p.label}</Link><span aria-hidden="true">/</span><span className="crumb-here">{here}</span>
    </nav>
  );
}

/** /syllabus: the five subjects of the JAMB syllabus, in the TECHMED Blueprint order. */
export default function Syllabus() {
  const { subjects, err } = useSyllabus();
  const list = subjects ? [...subjects].sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug)) : null;
  return (
    <div className="page px planner">
      <Crumbs here="JAMB syllabus" />
      <header className="stack-sm">
        <h1>JAMB syllabus</h1>
        <p className="muted">Every topic you can be tested on, in the order the TECHMED Blueprint teaches it. Tap a topic to practise it on KAIRO.</p>
      </header>
      {err ? <p className="card error">{err}</p> : !list ? <div className="skeleton" style={{ height: 320 }} /> : (
        <div className="bank">
          {list.map((s) => {
            const code = SLUG_CODE[s.slug];
            const I = code ? SUBJECT_ICONS[code] : IcCalendar;
            const n = s.stages.reduce((a, st) => a + st.topics.length, 0);
            return (
              <Link key={s.slug} to={`/syllabus/${s.slug}`} className={`bank-row s-${code}`}>
                <span className="tint-ic" aria-hidden="true"><I /></span>
                <span className="grow"><b>{s.name}</b><span className="muted small num">{s.stages.length} stages · {n} topics</span></span>
                <IcNext className="chev" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
      <Link to="/planner" className="way way-main">
        <span className="grow"><b>Turn the syllabus into a plan</b><span className="muted small">Set your exam date and get a day-by-day route through these topics.</span>
          <span className="gold-link small">Open study planner <IcArrowRight /></span></span>
        <span className="gold-ic" aria-hidden="true"><IcCalendar /></span>
      </Link>
    </div>
  );
}

/** /syllabus/:slug: one subject's stages and topics, with exam weight where documented, your plan status and a practice link. */
export function SyllabusSubject() {
  const { slug = '' } = useParams();
  const { subjects, err } = useSyllabus();
  const { busy, start } = useStart();
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [planned, setPlanned] = useState(false);
  const [going, setGoing] = useState('');
  useEffect(() => {
    getCatalog().then((c) => setCounts(new Map(c.flatMap((s) => (s.topics ?? []).map((t) => [t.id, t.count] as const))))).catch(() => {});
    loadPlan().then(({ blob }) => { setDone(new Set(blob.completed ?? [])); setPlanned(!!blob.input?.subjects.some((x) => x.slug === slug)); }).catch(() => {});
  }, [slug]);
  const s = subjects?.find((x) => x.slug === slug);
  const code = SLUG_CODE[slug];
  const stages = useMemo(() => (s ? [...s.stages].sort((a, b) => a.order - b.order) : []), [s]);

  if (subjects && !s) return <div className="page px"><Crumbs here="Not found" parent={{ to: '/syllabus', label: 'Syllabus' }} /><p className="card">This subject is not in the syllabus.</p></div>;

  return (
    <div className="page px planner">
      <Crumbs here={s?.name ?? '…'} parent={{ to: '/syllabus', label: 'Syllabus' }} />
      {err ? <p className="card error">{err}</p> : !s ? <div className="skeleton" style={{ height: 400 }} /> : (
        <>
          <header className={`subj-head s-${code}`}>
            <span className="tint-ic big" aria-hidden="true">{code ? (() => { const I = SUBJECT_ICONS[code]; return <I />; })() : <IcCalendar />}</span>
            <div className="grow"><h1>{s.name}</h1><p className="muted small num">{stages.length} stages · {stages.reduce((a, st) => a + st.topics.length, 0)} topics{s.topicCount ? ` · official JAMB count ${s.topicCount}` : ''}</p></div>
          </header>
          {s.description && <p className="muted">{s.description}</p>}
          {s.keyDependencies && <p className="pl-banner small">{s.keyDependencies}</p>}
          {s.requiredText && <p className="card small"><b>Required text:</b> {s.requiredText}</p>}
          {s.examStructure && s.examStructure.length > 0 && (
            <section className="pl-card" aria-labelledby="h-struct">
              <h2 id="h-struct">Exam structure</h2>
              <table className="struct"><thead><tr><th>Section</th><th>Area</th><th className="num">Questions</th></tr></thead>
                <tbody>{s.examStructure.map((r) => <tr key={r.section + r.area}><td>{r.section}</td><td>{r.area}</td><td className="num">{r.questions}</td></tr>)}</tbody></table>
            </section>
          )}
          {stages.map((st) => (
            <section key={st.order} className="pl-card" aria-label={st.name}>
              <h2 className="stage-h">{st.name}</h2>
              <ul className="syl-list">
                {st.topics.map((t) => {
                  const ids = kairoTopics(slug, t.title).filter((id) => (counts.size ? (counts.get(id) ?? 0) > 0 : true));
                  const n = ids.reduce((a, id) => a + (counts.get(id) ?? 0), 0);
                  const isDone = done.has(topicKey(slug, st.order, t.title));
                  return (
                    <li key={t.title} className="syl">
                      <span className="grow">
                        <b>{isDone && <IcCheck className="done-ic" aria-label="Done in your plan" />}{t.title}</b>
                        <span className="muted small">{[t.examWeight?.tier && `${TIER[t.examWeight.tier]} · ~${t.examWeight.min}–${t.examWeight.max} questions`,
                          t.prerequisites?.length ? `After ${t.prerequisites.join(', ')}` : null].filter(Boolean).join(' · ') || (ids.length && n ? `${n.toLocaleString()} questions on KAIRO` : '')}</span>
                      </span>
                      {code && ids.length > 0 && (
                        <button type="button" className="btn btn-sm" disabled={busy} aria-label={`Practise ${t.title}`}
                          onClick={() => { setGoing(t.title); start({ mode: 'topic', subject: code, topic_ids: ids, count: Math.min(10, n || 10), feedback: 'instant' }); }}>
                          {busy && going === t.title ? '…' : 'Practise'}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <Link to="/planner" className="way">
            <span className="grow"><b>{planned ? 'See where this is in your plan' : 'Plan these topics'}</b><span className="muted small">{planned ? 'Ticks here come from your study plan.' : 'Get a day-by-day route through this subject before your exam.'}</span>
              <span className="gold-link small">Open study planner <IcArrowRight /></span></span>
            <span className="gold-ic" aria-hidden="true"><IcCalendar /></span>
          </Link>
          <a className="gold-link small" href={`${WEB}/${slug}`} target="_blank" rel="noopener">Full guide on techmedng.com <IcArrowRight /></a>
        </>
      )}
    </div>
  );
}
