import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../lib/db';
import { clock } from '../../lib/score';
import { subjectName } from '../../lib/subjects';
import { enqueueSubmit } from '../../lib/sync';
import { toggleTheme } from '../../lib/theme';
import type { Answer, LocalAttempt, OptionKey, Paper } from '../../lib/types';
import { Sheet, Spinner, toast } from '../../ui/components';
import { IcBack, IcCalc, IcFlag, IcGrid, IcMoon } from '../../ui/icons';
import { Options, Passage, Stem, Tutor, whyNotFor } from './Question';
import './cbt.css';

const Calculator = lazy(() => import('./Calculator'));
type SheetName = 'palette' | 'calc' | 'submit' | 'leave' | null;

export default function CbtScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [att, setAtt] = useState<LocalAttempt | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [now, setNow] = useState(Date.now());
  const [passageOpen, setPassageOpen] = useState(true);
  const [syncLabel, setSyncLabel] = useState('Saved on phone');
  const attRef = useRef<LocalAttempt | null>(null);
  const enteredAt = useRef(Date.now());
  const warned = useRef<Set<number>>(new Set());
  const submitting = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load from the phone. Everything the screen needs is local, so it works offline once started.
  useEffect(() => {
    (async () => {
      const a = await db.attempts.get(id);
      if (!a) { nav('/', { replace: true }); return; }
      if (a.status === 'submitted') { nav(`/result/${id}`, { replace: true }); return; }
      const p = await db.papers.get(a.assessment_id);
      if (!p) { nav('/', { replace: true }); return; }
      attRef.current = a; setAtt(a); setPaper(p);
    })();
  }, [id, nav]);

  const qs = paper?.questions ?? [];
  const q = att ? qs[att.current] : undefined;
  const instant = !!att?.instant && qs.every((x) => x.correct_option);

  const subjects = useMemo(() => {
    const out: { code: string; start: number; end: number }[] = [];
    qs.forEach((x, i) => {
      const last = out[out.length - 1];
      if (last && last.code === x.subject) last.end = i; else out.push({ code: x.subject, start: i, end: i });
    });
    return out;
  }, [qs]);
  const curSubj = subjects.find((s) => att && att.current >= s.start && att.current <= s.end);

  // Persist within the same tick as the tap (IndexedDB write is a few ms).
  const persist = useCallback((patch: Partial<LocalAttempt>) => {
    const a = attRef.current;
    if (!a) return;
    const next = { ...a, ...patch, updated_at: Date.now() };
    attRef.current = next; setAtt(next);
    db.attempts.put(next).catch(() => setSyncLabel('Could not save on phone'));
  }, []);

  /** Add time spent on the current question, then return a patched answers map. */
  const withTime = useCallback((answers: Record<string, Answer>, qid: string): Record<string, Answer> => {
    const spent = Date.now() - enteredAt.current;
    enteredAt.current = Date.now();
    const cur = answers[qid] ?? { selected: null, time_ms: 0, flagged: false };
    return { ...answers, [qid]: { ...cur, time_ms: cur.time_ms + spent } };
  }, []);

  const goTo = useCallback((i: number) => {
    const a = attRef.current;
    if (!a || i < 0 || i >= qs.length || i === a.current) return;
    const cur = qs[a.current];
    const answers = withTime(a.answers, cur.id);
    if (qs[i].passage_html !== cur.passage_html) setPassageOpen(true);
    persist({ answers, current: i });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [qs, persist, withTime]);

  const select = useCallback((k: OptionKey) => {
    const a = attRef.current;
    if (!a || !q) return;
    if (instant && a.answers[q.id]?.selected) return; // locked after the first choice in instant mode
    const answers = withTime(a.answers, q.id);
    answers[q.id] = { ...answers[q.id], selected: k };
    persist({ answers });
    setSyncLabel('Saved on phone ✓');
  }, [q, instant, persist, withTime]);

  const toggleFlag = useCallback(() => {
    const a = attRef.current;
    if (!a || !q) return;
    const cur = a.answers[q.id] ?? { selected: null, time_ms: 0, flagged: false };
    persist({ answers: { ...a.answers, [q.id]: { ...cur, flagged: !cur.flagged } } });
  }, [q, persist]);

  const submit = useCallback(async (auto = false) => {
    const a = attRef.current;
    if (!a || !paper || submitting.current) return;
    submitting.current = true;
    const answers = withTime(a.answers, qs[a.current].id);
    const serverNow = Date.now() + a.clock_offset_ms;
    const duration = Math.round((serverNow - new Date(a.started_at).getTime()) / 1000);
    const done: LocalAttempt = {
      ...a, answers, status: 'submitted', submitted_at: new Date(serverNow).toISOString(),
      duration_sec: a.time_limit_sec ? Math.min(duration, a.time_limit_sec) : duration, sync: 'local', updated_at: Date.now(),
    };
    await db.attempts.put(done);
    attRef.current = done;
    enqueueSubmit(done, paper.questions).catch(() => {});
    if (auto) toast('Time is up. Your answers were submitted.');
    nav(`/result/${a.id}`, { replace: true });
  }, [paper, qs, withTime, nav]);

  // Timer from the server deadline (corrected for the phone's clock).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = att?.deadline_at ? (new Date(att.deadline_at).getTime() - (now + att.clock_offset_ms)) / 1000 : null;
  const elapsed = att ? (now + att.clock_offset_ms - new Date(att.started_at).getTime()) / 1000 : 0;
  useEffect(() => {
    if (remaining == null || !att || att.status !== 'in_progress') return;
    for (const mark of [300, 60]) {
      if (remaining <= mark && remaining > 0 && !warned.current.has(mark)) {
        warned.current.add(mark);
        toast(mark === 300 ? '5 minutes left. Check your flagged questions.' : '1 minute left.');
      }
    }
    if (remaining <= 0) submit(true);
  }, [remaining, att, submit]);


  // JAMB keyboard shortcuts: A–E select, N next, P previous, S submit, R review/palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const k = e.key.toUpperCase();
      if (q && q.options.some((o) => o.key === k)) { e.preventDefault(); select(k as OptionKey); }
      else if (k === 'N' || e.key === 'ArrowRight') goTo((att?.current ?? 0) + 1);
      else if (k === 'P' || e.key === 'ArrowLeft') goTo((att?.current ?? 0) - 1);
      else if (k === 'S') setSheet('submit');
      else if (k === 'R') setSheet('palette');
      else if (k === 'F') toggleFlag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, att, sheet, select, goTo, toggleFlag]);

  if (!att || !paper || !q) return <Spinner label="Opening your paper" />;

  const ans = att.answers[q.id];
  const selected = ans?.selected ?? null;
  const reveal = instant && !!selected;
  const isLast = att.current === qs.length - 1;
  const answeredIn = (s: { start: number; end: number }) => qs.slice(s.start, s.end + 1).filter((x) => att.answers[x.id]?.selected).length;
  const answeredTotal = qs.filter((x) => att.answers[x.id]?.selected).length;
  const posInSubj = curSubj ? att.current - curSubj.start + 1 : att.current + 1;
  const subjLen = curSubj ? curSubj.end - curSubj.start + 1 : qs.length;

  return (
    <div className="cbt">
      <header className="xh">
        <div className="xh-row">
          <button className="icon-btn" aria-label="Leave" onClick={() => setSheet('leave')}><IcBack /></button>
          <div className="xh-title">
            <b>{att.title}</b>
            <span>{syncLabel}</span>
          </div>
          <button className="icon-btn" aria-label="Switch light or dark" onClick={toggleTheme}><IcMoon /></button>
          <div className={`timer num ${remaining != null && remaining <= 300 ? 'warn' : ''}`} role="timer" aria-label="Time">
            {remaining != null ? clock(remaining) : clock(elapsed)}
          </div>
        </div>
        {subjects.length > 1 && (
          <div className="xh-tabs" role="tablist" aria-label="Subjects">
            {subjects.map((s) => (
              <button key={s.code} role="tab" aria-selected={curSubj?.code === s.code} onClick={() => goTo(s.start)}>
                {subjectName(s.code)}<small className="num">{answeredIn(s)}/{s.end - s.start + 1}</small>
              </button>
            ))}
          </div>
        )}
        <div className="xh-prog" aria-hidden="true"><i style={{ width: `${(answeredTotal / qs.length) * 100}%` }} /></div>
      </header>

      <div className="cbt-body" ref={bodyRef}>
        <div className="cbt-inner">
          {q.passage_html && <Passage html={q.passage_html} open={passageOpen} onToggle={() => setPassageOpen((o) => !o)} />}
          <div className="qmeta">
            <span className="qnum">Question <b className="num">{posInSubj}</b> of <span className="num">{subjLen}</span></span>
            {q.year && <span className="badge">{subjectName(q.subject)} · {q.year}</span>}
            <button className="flag-btn" aria-pressed={!!ans?.flagged} onClick={toggleFlag}>
              <IcFlag fill={ans?.flagged ? 'currentColor' : 'none'} />{ans?.flagged ? 'Flagged' : 'Flag'}
            </button>
          </div>
          <Stem q={q} />
          <Options q={q} selected={selected} reveal={reveal} onSelect={select} whyNot={reveal ? whyNotFor(q) : undefined} />
          {reveal && <Tutor q={q} selected={selected} />}
        </div>
      </div>

      <footer className="cbt-bar">
        <button className="tool" aria-label="Question palette (R)" onClick={() => setSheet('palette')}><IcGrid /></button>
        <button className="tool" aria-label="Calculator" onClick={() => setSheet('calc')}><IcCalc /></button>
        <span />
        <button className="btn" onClick={() => goTo(att.current - 1)} disabled={att.current === 0} aria-label="Previous (P)">‹ Prev</button>
        {isLast
          ? <button className="btn btn-accent" onClick={() => setSheet('submit')}>Submit</button>
          : <button className="btn btn-primary" onClick={() => goTo(att.current + 1)}>Next ›</button>}
      </footer>

      <Sheet open={sheet === 'palette'} onClose={() => setSheet(null)} label="Question palette">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>Questions</h2>
          <button className="btn btn-accent btn-sm" onClick={() => setSheet('submit')}>Submit</button>
        </div>
        <Palette qs={qs} att={att} subjects={subjects} onJump={(i) => { goTo(i); setSheet(null); }} instant={instant} />
      </Sheet>

      <Sheet open={sheet === 'calc'} onClose={() => setSheet(null)} label="Calculator">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>Calculator</h2>
          <button className="btn btn-sm" onClick={() => setSheet(null)}>Done</button>
        </div>
        <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}><Calculator /></Suspense>
      </Sheet>

      <Sheet open={sheet === 'submit'} onClose={() => setSheet(null)} label="Submit">
        <div className="stack">
          <h2>Submit your answers?</h2>
          <div className="submit-list">
            {subjects.map((s) => {
              const slice = qs.slice(s.start, s.end + 1);
              const un = slice.filter((x) => !att.answers[x.id]?.selected).length;
              const fl = slice.filter((x) => att.answers[x.id]?.flagged).length;
              return (
                <div key={s.code} className="row-between">
                  <b>{subjectName(s.code)}</b>
                  <span className="small">
                    <span className={un ? '' : 'muted'}>{un} unanswered</span> · <span style={{ color: fl ? 'var(--flag)' : undefined }} className={fl ? '' : 'muted'}>{fl} flagged</span>
                  </span>
                </div>
              );
            })}
          </div>
          {remaining != null && remaining > 0 && <p className="muted small">You still have {clock(remaining)} left.</p>}
          <div className="row">
            <button className="btn grow" onClick={() => setSheet(null)}>Keep going</button>
            <button className="btn btn-accent grow" onClick={() => submit()}>Submit now</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'leave'} onClose={() => setSheet(null)} label="Leave">
        <div className="stack">
          <h2>Take a break?</h2>
          <p className="muted">Your answers are saved on this phone. {att.deadline_at ? 'The timer keeps running while you are away.' : 'Come back any time to continue.'}</p>
          <div className="row">
            <button className="btn grow" onClick={() => setSheet(null)}>Stay</button>
            <button className="btn btn-primary grow" onClick={() => nav('/')}>Leave for now</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Palette({ qs, att, subjects, onJump, instant }: {
  qs: Paper['questions']; att: LocalAttempt; subjects: { code: string; start: number; end: number }[];
  onJump: (i: number) => void; instant: boolean;
}) {
  const cur = subjects.find((s) => att.current >= s.start && att.current <= s.end) ?? subjects[0];
  const [code, setCode] = useState(cur.code);
  const s = subjects.find((x) => x.code === code) ?? cur;
  return (
    <div className="sheet-body">
      {subjects.length > 1 && (
        <div className="chip-scroll" style={{ marginBottom: 12 }}>
          {subjects.map((x) => <button key={x.code} className="chip" aria-pressed={x.code === code} onClick={() => setCode(x.code)}>{subjectName(x.code)}</button>)}
        </div>
      )}
      <div className="pal-grid">
        {qs.slice(s.start, s.end + 1).map((x, j) => {
          const i = s.start + j, a = att.answers[x.id];
          const right = instant && a?.selected ? a.selected === x.correct_option : null;
          return (
            <button key={x.id} onClick={() => onJump(i)}
              className={`pal ${a?.selected ? 'ans' : ''} ${right === true ? 'ok' : right === false ? 'bad' : ''} ${a?.flagged ? 'flg' : ''} ${i === att.current ? 'cur' : ''}`}
              aria-label={`Question ${j + 1}${a?.selected ? ', answered' : ''}${a?.flagged ? ', flagged' : ''}`}>{j + 1}</button>
          );
        })}
      </div>
      <div className="pal-legend">
        <span><i className="sw ans" />Answered</span><span><i className="sw" />Not answered</span>
        <span><i className="sw flg" />Flagged</span><span><i className="sw cur" />Current</span>
      </div>
    </div>
  );
}
