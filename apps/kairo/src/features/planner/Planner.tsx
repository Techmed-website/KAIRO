import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays, buildPlan, diffPlans, getTasksForDate, getWeekForDate, snapshotPlan, toLocalIso, topicKey,
  type DayTask, type PlannerInput, type PlannerPlan, type SubjectPlanChange, type WeekPlan,
} from '../../lib/planner/engine';
import { apply, loadPlan, savePlan, type PlanBlob } from '../../lib/planner/store';
import { getSubjects, type Subject } from '../../lib/planner/syllabus';
import { kairoTopics, SLUG_CODE } from '../../lib/planner/topicMap';
import { getCatalog } from '../../lib/catalog';
import { Sheet } from '../../ui/components';
import { IcArrowRight, IcBack, IcBolt, IcCalendar } from '../../ui/icons';
import { myTopicStats, useStart, type TopicStat } from '../practice/common';
import { Wizard } from './Wizard';
import './planner.css';

const DASHBOARD = 'https://techmedng.com/dashboard?view=planner';
const today = () => toLocalIso(new Date());
const SESSION_NEW = { foundational: 45, low: 45, medium: 60, high: 75 } as const;
const minutes = (t: DayTask) => (t.kind === 'review' ? 30 : SESSION_NEW[t.examWeight?.tier ?? 'medium']);
const shortDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const longDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/** The study planner inside KAIRO. Same engine, syllabus and saved plan as the TECHMED dashboard planner. */
export default function Planner() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [blob, setBlob] = useState<PlanBlob | null>(null);
  const [offline, setOffline] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([getSubjects(), loadPlan()]).then(([s, p]) => { setSubjects(s); setBlob(p.blob); setOffline(p.offline); })
      .catch(() => setErr('The planner could not load. Check your connection and try again.'));
  }, []);

  // Show the change at once; the saved copy replaces it when the last save in flight returns.
  const seq = useRef(0);
  const save = async (patch: Partial<Record<keyof PlanBlob, unknown>>) => {
    const n = ++seq.current;
    setBlob((b) => apply(b ?? {}, patch));
    const saved = await savePlan(patch);
    if (n === seq.current) setBlob(saved);
  };

  const onBuild = async (input: PlannerInput, covered: Set<string>) => {
    const plan = buildPlan({ input, allSubjects: subjects!, alreadyCompletedKeys: covered });
    await save({ input, completed: [...covered], snapshot: null, current_week: getWeekForDate(plan, today()) ?? null });
  };

  return (
    <div className="page px planner">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/" className="icon-btn" aria-label="Back to Home"><IcBack /></Link>
        <Link to="/" className="crumb-link">Home</Link><span aria-hidden="true">/</span><span className="crumb-here">Study planner</span>
      </nav>
      {err ? <p className="card error">{err}</p> : !subjects || !blob ? <div className="stack-sm"><div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 240 }} /></div>
        : !blob.input ? (
          <>
            <header className="pl-intro">
              <p className="pill-gold">Study planner · Free</p>
              <h1>Know exactly what to study today.</h1>
              <p className="muted">Answer 4 quick questions. You get a plan that tells you what to study each day, in the right order, with revision time saved before your exam.</p>
              <p className="muted small">The order follows the TECHMED Blueprint of the JAMB syllabus. <Link to="/syllabus" className="gold-link">See the syllabus <IcArrowRight /></Link></p>
            </header>
            <Wizard subjects={subjects} onBuild={onBuild} />
          </>
        ) : <PlanView subjects={subjects} blob={blob} save={save} offline={offline} />}
    </div>
  );
}

function PlanView({ subjects, blob, save, offline }: { subjects: Subject[]; blob: PlanBlob; save: (p: Partial<Record<keyof PlanBlob, unknown>>) => Promise<void>; offline: boolean }) {
  const input = blob.input!;
  const completed = useMemo(() => new Set(blob.completed ?? []), [blob.completed]);
  const notes = blob.notes ?? {};
  const [adjust, setAdjust] = useState<null | 'menu' | 'time' | 'date'>(input.targetDate <= today() ? 'date' : null);
  const [changes, setChanges] = useState<SubjectPlanChange[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [stats, setStats] = useState<Map<number, TopicStat>>(new Map());
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    myTopicStats().then((l) => setStats(new Map(l.map((t) => [t.topic_id, t])))).catch(() => {});
    getCatalog().then((c) => setCounts(new Map(c.flatMap((s) => (s.topics ?? []).map((t) => [t.id, t.count] as const))))).catch(() => {});
  }, []);

  // Build, then hold the current week steady across visits (the website's reconcileCurrentWeek).
  const { plan, freshWeek } = useMemo(() => {
    let p: PlannerPlan;
    try { p = buildPlan({ input, allSubjects: subjects, alreadyCompletedKeys: completed }); } catch { return { plan: null, freshWeek: null }; }
    const fresh = getWeekForDate(p, today());
    const frozen = blob.current_week;
    if (fresh && frozen && frozen.weekNumber === fresh.weekNumber && frozen.startDate === fresh.startDate) {
      return { plan: { ...p, weeks: p.weeks.map((w) => (w.weekNumber === fresh.weekNumber ? frozen : w)) }, freshWeek: null };
    }
    return { plan: p, freshWeek: fresh ?? null };
    // completed is left out on purpose: ticking a topic must not reshuffle this week (the frozen week covers it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, subjects, blob.current_week]);
  useEffect(() => { if (freshWeek) save({ current_week: freshWeek }); }, [freshWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) {
    return (
      <div className="card stack-sm"><h2>This plan needs setting up again</h2>
        <p className="muted small">It was made with subjects that are no longer in the Blueprint.</p>
        <button className="btn btn-primary" onClick={() => save({ input: null, current_week: null, snapshot: null })}>Set up a new plan</button></div>
    );
  }

  const setDone = (key: string, done: boolean) => {
    const n = new Set(completed); if (done) n.add(key); else n.delete(key);
    save({ completed: [...n] });
  };
  const setNote = (key: string, text: string) => {
    const n = { ...notes }; if (text.trim()) n[key] = text.trim(); else delete n[key];
    save({ notes: n });
  };
  const replan = async (over: Partial<PlannerInput>) => {
    const before = snapshotPlan(plan);
    const newInput: PlannerInput = { ...input, ...over, createdAt: today() };
    const next = buildPlan({ input: newInput, allSubjects: subjects, alreadyCompletedKeys: completed });
    await save({ input: newInput, current_week: getWeekForDate(next, today()) ?? null, snapshot: null });
    setChanges(diffPlans(before, next));
    setAdjust(null);
  };
  const reset = async () => {
    await save({ input: null, completed: null, notes: null, snapshot: null, current_week: null });
    setConfirmReset(false);
  };

  const week = getWeekForDate(plan, today());
  const tasks = getTasksForDate(plan, today());
  const nextUp = tasks.length ? null : findNext(plan);
  const weekItems = week ? [...week.topics.map((t) => ({ ...t, kind: 'first-pass' as const })), ...week.reviewTopics.map((t) => ({ ...t, kind: 'review' as const }))] : [];
  const weekDone = weekItems.filter((t) => completed.has(t.key)).length;
  const name = (slug: string) => subjects.find((s) => s.slug === slug)?.name ?? slug;

  return (
    <>
      <header className="pl-head">
        <div className="grow">
          <p className="eyebrow num">{plan.totalWeeks} weeks to your exam · about {plan.weeklyCapacityHours}h a week</p>
          <h1>Your plan</h1>
          <p className="muted small num">Exam date {longDay(input.targetDate)}{offline ? ' · offline, changes will sync' : ''}</p>
        </div>
        <span className="gold-ic big" aria-hidden="true"><IcCalendar /></span>
      </header>

      {changes && (
        <p className="pl-banner" role="status">Plan updated. It now starts from today.{' '}
          {changes.filter((c) => c.status !== 'on-track').map((c) => `${c.subjectName} moved ${c.status === 'moved-later' ? 'a little later' : 'a little earlier'} to protect your revision time.`).join(' ') || 'Everything else stayed on track.'}</p>
      )}

      {plan.warnings.length > 0 && (
        <details className="pl-warn">
          <summary><b>One thing to know</b><span className="muted small">Some coverage will be lighter unless you add study time. Your revision time is protected.</span></summary>
          <ul>{plan.warnings.map((w) => <li key={w.subjectSlug} className="small num"><b>{w.subjectName}</b>: about {w.topicsThatFit} of {w.topicCount} topics fit.</li>)}</ul>
          <div className="chip-row"><button type="button" className="chip" onClick={() => setAdjust('time')}>Add study time</button><button type="button" className="chip" onClick={() => setAdjust('date')}>Move my exam date</button></div>
        </details>
      )}

      <section className="pl-card today-card" aria-labelledby="h-today">
        <div className="row-between"><h2 id="h-today">Today</h2><span className="muted small">{longDay(today())}</span></div>
        {tasks.length === 0 ? (
          <p className="muted">{nextUp ? <>You’re done for today. Next session: <b>{longDay(nextUp.date)}</b>, {name(nextUp.task.subjectSlug)}: {nextUp.task.topicTitle}.</> : 'Nothing left before your exam date. Take the win, then keep practising.'}</p>
        ) : tasks.map((t) => (
          <TaskRow key={t.key} t={t} subject={name(t.subjectSlug)} done={completed.has(t.key)} onDone={(d) => setDone(t.key, d)}
            note={notes[t.key] ?? ''} onNote={(v) => setNote(t.key, v)} stats={stats} counts={counts} />
        ))}
      </section>

      {week && (
        <section className="pl-card" aria-labelledby="h-week">
          <div className="row-between"><h2 id="h-week">This week</h2><span className="muted small num">{weekDone} of {weekItems.length} done</span></div>
          {weekItems.length === 0 ? <p className="muted small">{week.isReviewWeek ? 'Revision week: no new topics, review only.' : 'Nothing scheduled this week.'}</p> : (
            <ul className="wk-list">
              {weekItems.map((t) => (
                <li key={t.kind + t.key}>
                  <label className="check">
                    <input type="checkbox" checked={completed.has(t.key)} onChange={(e) => setDone(t.key, e.target.checked)} />
                    <span className="grow"><b>{t.topicTitle}</b><span className="muted small">{name(t.subjectSlug)}</span></span>
                    <span className={`tag ${t.kind === 'review' ? 'tag-rev' : 'tag-new'}`}>{t.kind === 'review' ? 'Review' : 'New'}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="pl-card" aria-labelledby="h-prog">
        <h2 id="h-prog">Your progress</h2>
        <div className="pl-prog">
          {input.subjects.map(({ slug }) => {
            const s = subjects.find((x) => x.slug === slug);
            const keys = (s?.stages ?? []).flatMap((st) => st.topics.map((t) => topicKey(slug, st.order, t.title)));
            const done = keys.filter((k) => completed.has(k)).length;
            const pct = keys.length ? Math.round((100 * done) / keys.length) : 0;
            return (
              <div key={slug} className="pl-prog-row">
                <div className="row-between small"><b>{name(slug)}</b><span className="muted num">{done}/{keys.length} topics</span></div>
                <div className="bar2" role="progressbar" aria-label={`${name(slug)} topics done`} aria-valuemin={0} aria-valuemax={keys.length} aria-valuenow={done}><i style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="pl-card" aria-labelledby="h-adj">
        <div className="row-between"><h2 id="h-adj">Adjust my plan</h2>{adjust && adjust !== 'menu' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdjust('menu')}>Back</button>}</div>
        {input.targetDate <= today() && <p className="pl-banner" role="alert">Your exam date on this plan has passed. Set your new date to rebuild it.</p>}
        {(!adjust || adjust === 'menu') && (
          <div className="adj">
            <button type="button" onClick={() => replan({})}>I missed some study days</button>
            <button type="button" onClick={() => setAdjust('time')}>I have less time now</button>
            <button type="button" onClick={() => setAdjust('time')}>I have more time now</button>
            <button type="button" onClick={() => setAdjust('date')}>I want to change my exam date</button>
          </div>
        )}
        {adjust === 'time' && <TimeEdit input={input} onSave={(over) => replan(over)} />}
        {adjust === 'date' && <DateEdit input={input} onSave={(targetDate) => replan({ targetDate })} />}
      </section>

      <details className="pl-card route">
        <summary><h2>See your full route</h2></summary>
        {plan.weeks.map((w: WeekPlan) => (
          <div key={w.weekNumber} className={`route-wk ${w.startDate <= today() && today() <= w.endDate ? 'now' : ''}`}>
            <p className="small"><b className="num">Week {w.weekNumber}</b> <span className="muted num">{shortDate(w.startDate)} – {shortDate(w.endDate)}{w.isReviewWeek ? ' · Revision' : ''}</span></p>
            <p className="muted small">{[...w.topics.map((t) => t.topicTitle), ...w.reviewTopics.map((t) => `${t.topicTitle} (review)`)].join(' · ') || 'Review and practice'}</p>
          </div>
        ))}
      </details>

      <div className="pl-foot">
        <a href={DASHBOARD} target="_blank" rel="noopener" className="gold-link small">Also on your TECHMED dashboard <IcArrowRight /></a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}>Start over</button>
      </div>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} label="Start over">
        <div className="sheet-body stack">
          <div className="stack-sm"><p className="eyebrow">Start over</p><h2>This clears everything, for good.</h2>
            <p className="muted small">Your route, every topic you’ve marked complete and your notes are wiped here and on your TECHMED dashboard. There’s no undo.</p></div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setConfirmReset(false)}>Keep my current plan</button>
          <button type="button" className="btn btn-block danger" onClick={reset}>Clear everything and start over</button>
        </div>
      </Sheet>
    </>
  );
}

function findNext(plan: PlannerPlan): { date: string; task: DayTask } | null {
  let date = today();
  for (let i = 0; i < plan.totalWeeks * 7 + 7; i++) {
    date = addDays(date, 1);
    if (date > plan.input.targetDate) break;
    const t = getTasksForDate(plan, date);
    if (t.length) return { date, task: t[0] };
  }
  return null;
}

function TaskRow({ t, subject, done, onDone, note, onNote, stats, counts }: {
  t: DayTask; subject: string; done: boolean; onDone: (d: boolean) => void; note: string; onNote: (v: string) => void;
  stats: Map<number, TopicStat>; counts: Map<number, number>;
}) {
  const { busy, start } = useStart();
  const code = SLUG_CODE[t.subjectSlug];
  const ids = kairoTopics(t.subjectSlug, t.topicTitle).filter((id) => (counts.size ? (counts.get(id) ?? 0) > 0 : true));
  const n = ids.reduce((a, id) => a + (counts.get(id) ?? 0), 0);
  const mine = ids.map((id) => stats.get(id)).filter(Boolean) as TopicStat[];
  const att = mine.reduce((a, s) => a + s.attempted, 0), cor = mine.reduce((a, s) => a + s.correct, 0);
  const [text, setText] = useState(note);
  const practise = () => code && start(ids.length
    ? { mode: 'topic', subject: code, topic_ids: ids, count: Math.min(10, n || 10), feedback: 'instant' }
    : { mode: 'mixed', subjects: [{ code, count: 10 }], feedback: 'instant' });
  const why = t.kind === 'review' ? 'Coming back to this because it’s due another retrieval pass. That’s what makes it stick.'
    : t.prerequisites?.length ? `It follows ${t.prerequisites.join(' and ')} in your ${subject} Blueprint.` : `It’s one of the starting points in your ${subject} Blueprint.`;
  return (
    <div className={`task ${done ? 'is-done' : ''}`}>
      <label className="task-main">
        <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} />
        <span className="grow"><span className="task-sub">{subject}</span><b>{t.topicTitle}</b>
          <span className="muted small">{t.kind === 'review' ? 'Revisit + practice' : 'Learn + practice'} · ~{minutes(t)} min</span></span>
        <span className={`tag ${t.kind === 'review' ? 'tag-rev' : 'tag-new'}`}>{t.kind === 'review' ? 'Review' : 'New'}</span>
      </label>
      {code && (
        <div className="task-practise">
          <span className="muted small num">{ids.length ? `${n ? n.toLocaleString() + ' questions on KAIRO' : 'Questions on KAIRO'}${att ? ` · you: ${Math.round((100 * cor) / att)}% of ${att}` : ''}` : `No questions tagged to this topic yet · practise ${subject}`}</span>
          <button type="button" className="btn btn-sm btn-accent" disabled={busy} onClick={practise}>{busy ? '…' : <><IcBolt />Practise 10</>}</button>
        </div>
      )}
      <details className="why"><summary>Why this?</summary><p className="small muted">{why} <Link to={`/syllabus/${t.subjectSlug}`} className="gold-link">See the {subject} syllabus</Link></p></details>
      {done && (
        <div className="note">
          <label className="small muted" htmlFor={`n-${t.key}`}>Optional: what’s one thing you’d say about this?</label>
          <input id={`n-${t.key}`} className="input" maxLength={140} value={text} placeholder="e.g. I learned how to balance redox equations" onChange={(e) => setText(e.target.value)} onBlur={() => text !== note && onNote(text)} />
        </div>
      )}
    </div>
  );
}

function TimeEdit({ input, onSave }: { input: PlannerInput; onSave: (o: Partial<PlannerInput>) => void }) {
  const [days, setDays] = useState(input.availableDays);
  const [hours, setHours] = useState(String(input.hoursPerAvailableDay));
  const h = parseFloat(hours);
  const ok = days.length > 0 && Number.isFinite(h) && h >= 0.5 && h <= 12;
  return (
    <div className="stack-sm">
      <b className="small">Days you can usually study</b>
      <div className="day-row">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
        <button key={d} type="button" className="chip day" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>))}</div>
      <label className="small" htmlFor="adj-h"><b>Focused hours on a normal study day</b></label>
      <input id="adj-h" className="input hours" type="number" min={0.5} max={12} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      {!ok && <p className="wiz-err small">Pick at least one day and between half an hour and 12 hours.</p>}
      <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => onSave({ availableDays: days, hoursPerAvailableDay: h })}>Save and rebuild</button>
    </div>
  );
}

function DateEdit({ input, onSave }: { input: PlannerInput; onSave: (d: string) => void }) {
  const [d, setD] = useState(input.targetDate > today() ? input.targetDate : '');
  return (
    <div className="stack-sm">
      <label className="small" htmlFor="adj-d"><b>New exam date</b></label>
      <input id="adj-d" className="input" type="date" value={d} min={addDays(today(), 1)} max={addDays(today(), 730)} onChange={(e) => setD(e.target.value)} />
      <button type="button" className="btn btn-primary" disabled={!d || d <= today()} onClick={() => onSave(d)}>Save and rebuild</button>
    </div>
  );
}
