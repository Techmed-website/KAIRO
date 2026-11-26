import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { addDays, topicKey, toLocalIso, type ConfidenceLevel, type PlannerInput } from '../../lib/planner/engine';
import type { Subject } from '../../lib/planner/syllabus';
import { SLUG_CODE } from '../../lib/planner/topicMap';

const ENGLISH = 'use-of-english';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEPS = ['Exam date', 'Subjects', 'Weekly time', 'Starting point'];
type Coarse = 'fresh' | 'some' | 'most';
interface Detail { confidence: ConfidenceLevel; coarse: Coarse; covered: Set<string> }

/** The planner's four questions, the same as on the TECHMED dashboard. Produces the same PlannerInput. */
export function Wizard({ subjects, onBuild }: { subjects: Subject[]; onBuild: (input: PlannerInput, covered: Set<string>) => void }) {
  const { subjectCodes } = useAuth();
  const today = toLocalIso(new Date());
  const electives = subjects.filter((s) => s.slug !== ENGLISH);
  const [step, setStep] = useState(0);
  const [date, setDate] = useState('');
  const [picked, setPicked] = useState<string[]>(() => electives.filter((s) => subjectCodes.includes(SLUG_CODE[s.slug])).map((s) => s.slug).slice(0, 3));
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [hours, setHours] = useState('2');
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [err, setErr] = useState('');
  const slugs = useMemo(() => [...(subjects.some((s) => s.slug === ENGLISH) ? [ENGLISH] : []), ...picked], [subjects, picked]);
  const detail = (slug: string): Detail => details[slug] ?? { confidence: 'medium', coarse: 'fresh', covered: new Set() };
  const setDetail = (slug: string, d: Partial<Detail>) => setDetails({ ...details, [slug]: { ...detail(slug), ...d } });
  const h = parseFloat(hours);
  const validHours = Number.isFinite(h) && h >= 0.5 && h <= 12;

  const check = (): string => {
    if (step === 0 && (!date || date <= today)) return 'Pick a date after today.';
    if (step === 1 && picked.length < 1) return 'Pick at least one subject besides English.';
    if (step === 2 && !days.length) return 'Pick at least one day.';
    if (step === 2 && !validHours) return 'Choose between half an hour and 12 hours.';
    return '';
  };
  const next = () => { const e = check(); setErr(e); if (!e) setStep(step + 1); };

  const build = () => {
    const covered = new Set<string>();
    const subjectsInput = slugs.map((slug) => {
      const s = subjects.find((x) => x.slug === slug)!;
      const d = detail(slug);
      const stages = [...s.stages].sort((a, b) => a.order - b.order);
      for (const st of stages) for (const t of st.topics) if (d.covered.has(t.title)) covered.add(topicKey(slug, st.order, t.title));
      let start = stages.findIndex((st) => !st.topics.every((t) => d.covered.has(t.title)));
      if (start < 0) start = Math.max(0, stages.length - 1);
      return { slug, confidence: d.confidence, startingStageIndex: start };
    });
    onBuild({ targetDate: date, availableDays: days, hoursPerAvailableDay: h, subjects: subjectsInput, createdAt: today }, covered);
  };

  return (
    <section className="wiz" aria-label="Set up your plan">
      <ol className="wiz-progress" aria-label="Setup progress">
        {STEPS.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}><span>{t}</span></li>)}
      </ol>

      {step === 0 && (
        <div className="stack-sm">
          <h2>When is your UTME?</h2>
          <p className="muted small">A good guess is fine. You can change it any time when JAMB confirms the date.</p>
          <label className="sr-only" htmlFor="pl-date">Exam date</label>
          <input id="pl-date" type="date" className="input" value={date} min={addDays(today, 1)} max={addDays(today, 730)} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}

      {step === 1 && (
        <div className="stack-sm">
          <h2>Which subjects should we plan?</h2>
          <p className="muted small">Use of English is always included. Pick up to 3 more.</p>
          <div className="chip-row">
            <button type="button" className="chip" aria-pressed disabled>Use of English</button>
            {electives.map((s) => {
              const on = picked.includes(s.slug);
              return <button key={s.slug} type="button" className="chip" aria-pressed={on} disabled={!on && picked.length >= 3}
                onClick={() => setPicked(on ? picked.filter((x) => x !== s.slug) : [...picked, s.slug])}>{s.name}</button>;
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <div className="stack-sm"><h2>When can you study?</h2><p className="muted small">Be honest: pick what you can keep up most weeks, not your best week.</p></div>
          <div className="stack-sm"><b className="small">Days you can usually study</b>
            <div className="day-row" role="group" aria-label="Available days">
              {DAYS.map((d, i) => <button key={d} type="button" className="chip day" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>)}
            </div>
          </div>
          <div className="stack-sm"><b className="small">Hours of focused study on those days</b>
            <div className="chip-row">{[1, 2, 3, 4].map((n) => <button key={n} type="button" className="chip num" aria-pressed={h === n} onClick={() => setHours(String(n))}>{n}h</button>)}</div>
            <label className="sr-only" htmlFor="pl-hours">Or type the hours</label>
            <input id="pl-hours" className="input hours" type="number" min={0.5} max={12} step={0.5} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <div className="stack-sm"><h2>Where are you starting from?</h2><p className="muted small">Rough is fine. This is not a test, and you can change it later.</p></div>
          {slugs.map((slug) => {
            const s = subjects.find((x) => x.slug === slug)!;
            const d = detail(slug);
            const all = [...s.stages].sort((a, b) => a.order - b.order).flatMap((st) => st.topics.map((t) => t.title));
            return (
              <div key={slug} className="wiz-subject">
                <b>{s.name}</b>
                <span className="muted small">How confident do you feel right now?</span>
                <div className="seg" role="group" aria-label={`${s.name} confidence`}>
                  {(['low', 'medium', 'high'] as ConfidenceLevel[]).map((c) => <button key={c} type="button" aria-pressed={d.confidence === c} onClick={() => setDetail(slug, { confidence: c })}>{c[0].toUpperCase() + c.slice(1)}</button>)}
                </div>
                <span className="muted small">Where are you starting from?</span>
                <div className="seg" role="group" aria-label={`${s.name} starting point`}>
                  {([['fresh', 'Starting fresh'], ['some', 'Covered some'], ['most', 'Mostly covered']] as [Coarse, string][]).map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={d.coarse === v} onClick={() => setDetail(slug, { coarse: v, covered: v === 'most' ? new Set(all) : new Set() })}>{l}</button>))}
                </div>
                {d.coarse !== 'fresh' && (
                  <div className="covered">
                    <p className="muted small">Tick what you have already studied, from any source. It doesn’t need to be exact.</p>
                    {all.map((t) => (
                      <label key={t} className="check"><input type="checkbox" checked={d.covered.has(t)} onChange={() => {
                        const n = new Set(d.covered); if (n.has(t)) n.delete(t); else n.add(t); setDetail(slug, { covered: n });
                      }} />{t}</label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="wiz-err" role="alert">{err}</p>}
      <div className="wiz-nav">
        {step > 0 && <button type="button" className="btn" onClick={() => { setErr(''); setStep(step - 1); }}>Back</button>}
        {step < 3 ? <button type="button" className="btn btn-primary grow" onClick={next}>Continue</button>
          : <button type="button" className="btn btn-primary grow" onClick={build}>Build my plan</button>}
      </div>
    </section>
  );
}
