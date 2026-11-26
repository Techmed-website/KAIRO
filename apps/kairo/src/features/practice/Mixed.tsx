import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import type { SubjectCode } from '../../lib/types';
import { Sheet } from '../../ui/components';
import { IcChevronDown, IcSearch } from '../../ui/icons';
import { SUBJECT_ICONS } from '../../ui/subjectIcons';
import { BANK_ORDER, OptionsPicker, suggestedSec, useCatalog, useStart, type Opts } from './common';
import { BackBar } from './SubjectPractice';

const FROM = 1978, TO = 2025;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => b - i).filter((y) => y !== 1996);

/** Custom practice: pick subjects, how many, optionally years and topics, then answers and timer. */
export default function Mixed() {
  const { subjectCodes } = useAuth();
  const { cat } = useCatalog();
  const { busy, start } = useStart();
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.length ? subjectCodes : ['ENG']);
  const [per, setPer] = useState(10);
  const [years, setYears] = useState<[number, number] | null>(null);
  const [topics, setTopics] = useState<Partial<Record<SubjectCode, number[]>>>({});
  const [picker, setPicker] = useState<SubjectCode | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  const total = subs.length * per;
  const chosen = subs.reduce((n, c) => n + (topics[c]?.length ?? 0), 0);

  const go = () => {
    // The engine applies one topic filter to every subject, so a subject without picked topics keeps all of its topics.
    const topic_ids = chosen ? subs.flatMap((c) => topics[c]?.length ? topics[c]! : (cat?.find((s) => s.code === c)?.topics ?? []).map((t) => t.id)) : undefined;
    start({ mode: 'mixed', subjects: subs.map((code) => ({ code, count: per })), ...(years ? { years } : {}), ...(topic_ids ? { topic_ids } : {}),
      feedback: opts.feedback, time_limit_sec: opts.timed ? suggestedSec(total) : null });
  };
  const toggleSub = (c: SubjectCode) => setSubs(subs.includes(c) ? subs.filter((x) => x !== c) : [...subs, c]);

  return (
    <div className="page px">
      <BackBar name="Custom practice" />
      <div className="stack-sm"><h1>Build a session</h1><p className="muted small">Pick what to practise. Steps 3 and 4 are optional.</p></div>

      <section className="step" aria-labelledby="st1">
        <h3 id="st1"><span className="step-n">1</span>Subjects</h3>
        <div className="pick-grid">
          {BANK_ORDER.map((c) => {
            const I = SUBJECT_ICONS[c];
            return (
              <button key={c} type="button" className={`pick s-${c}`} aria-pressed={subs.includes(c)} onClick={() => toggleSub(c)}>
                <I aria-hidden="true" /><span className="grow">{cat?.find((s) => s.code === c)?.name ?? c}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="step" aria-labelledby="st2">
        <h3 id="st2"><span className="step-n">2</span>Questions per subject</h3>
        <div className="chip-row">{[5, 10, 20, 40].map((n) => <button key={n} type="button" className="chip num" aria-pressed={per === n} onClick={() => setPer(n)}>{n}</button>)}</div>
        <p className="muted small num">{subs.length ? `${total} questions in all` : 'Choose at least one subject.'}</p>
      </section>

      <section className="step" aria-labelledby="st3">
        <button type="button" className="step-toggle" aria-expanded={narrow} aria-controls="narrow" onClick={() => setNarrow(!narrow)}>
          <h3 id="st3"><span className="step-n">3</span>Narrow it down <span className="muted small">optional</span></h3>
          <span className="muted small">{[years ? `${years[0]}–${years[1]}` : 'All years', chosen ? `${chosen} topic${chosen === 1 ? '' : 's'}` : 'All topics'].join(' · ')}</span>
          <IcChevronDown className={narrow ? 'flip' : ''} aria-hidden="true" />
        </button>
        {narrow && (
          <div id="narrow" className="stack">
            <div className="stack-sm"><b className="small">Years</b>
              <div className="chip-row">
                <button type="button" className="chip" aria-pressed={!years} onClick={() => setYears(null)}>All years</button>
                <button type="button" className="chip" aria-pressed={years?.[0] === 2015 && years[1] === TO} onClick={() => setYears([2015, TO])}>Last 10 years</button>
                <button type="button" className="chip" aria-pressed={!!years && !(years[0] === 2015 && years[1] === TO)} onClick={() => setYears([2010, TO])}>Choose…</button>
              </div>
              {years && (
                <div className="row">
                  <label className="sr-only" htmlFor="y-from">From year</label>
                  <select id="y-from" className="input" value={years[0]} onChange={(e) => setYears([+e.target.value, Math.max(+e.target.value, years[1])])}>{range(FROM, TO).map((y) => <option key={y}>{y}</option>)}</select>
                  <span className="muted">to</span>
                  <label className="sr-only" htmlFor="y-to">To year</label>
                  <select id="y-to" className="input" value={years[1]} onChange={(e) => setYears([Math.min(years[0], +e.target.value), +e.target.value])}>{range(FROM, TO).map((y) => <option key={y}>{y}</option>)}</select>
                </div>
              )}
              {years && <p className="muted small">Only dated past questions are picked when you choose years.</p>}
            </div>
            <div className="stack-sm"><b className="small">Topics</b>
              {subs.length === 0 ? <p className="muted small">Choose a subject first.</p> : subs.map((c) => (
                <button key={c} type="button" className="topic-pick" onClick={() => setPicker(c)}>
                  <span className="grow">{cat?.find((s) => s.code === c)?.name ?? c}</span>
                  <span className="muted small">{topics[c]?.length ? `${topics[c]!.length} chosen` : 'All topics'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="step" aria-labelledby="st4">
        <h3 id="st4"><span className="step-n">4</span>Answers and timer</h3>
        <OptionsPicker value={opts} onChange={setOpts} count={total} />
      </section>

      <div className="sticky-start">
        <button className="btn btn-primary btn-lg btn-block" disabled={!subs.length || busy} onClick={go}>{busy ? 'Preparing…' : `Start · ${total} questions`}</button>
      </div>

      <TopicPicker code={picker} name={cat?.find((s) => s.code === picker)?.name ?? ''} all={cat?.find((s) => s.code === picker)?.topics ?? []}
        value={picker ? topics[picker] ?? [] : []} onClose={() => setPicker(null)}
        onChange={(ids) => picker && setTopics({ ...topics, [picker]: ids })} />
    </div>
  );
}

function TopicPicker({ code, name, all, value, onChange, onClose }: {
  code: SubjectCode | null; name: string; all: { id: number; name: string; count: number }[]; value: number[]; onChange: (ids: number[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => all.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())), [all, q]);
  return (
    <Sheet open={!!code} onClose={onClose} label={`${name} topics`}>
      <div className="sheet-body stack">
        <div className="row-between"><h2>{name} topics</h2>{value.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>Clear</button>}</div>
        <div className="search"><IcSearch aria-hidden="true" /><label htmlFor="tpq" className="sr-only">Search topics</label>
          <input id="tpq" type="search" className="input" placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div>
        <div className="topic-list sheet-scroll">
          {list.map((t) => {
            const on = value.includes(t.id);
            return (
              <button key={t.id} type="button" className="topic" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}>
                <span className="tick" aria-hidden="true">{on ? '✓' : ''}</span><span className="grow">{t.name}</span><span className="muted small num">{t.count}</span>
              </button>
            );
          })}
          {list.length === 0 && <p className="muted small">No topic matches.</p>}
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>{value.length ? `Use ${value.length} topic${value.length === 1 ? '' : 's'}` : 'Use all topics'}</button>
      </div>
    </Sheet>
  );
}
