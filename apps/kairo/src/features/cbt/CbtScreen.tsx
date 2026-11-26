import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../lib/db';
import { clock } from '../../lib/score';
import { subjectName } from '../../lib/subjects';
import { questionLabel } from '../../lib/label';
import { saveAnswersRemote } from '../../lib/session';
import { enqueueSubmit } from '../../lib/sync';
import { toggleTheme } from '../../lib/theme';
import type { Answer, LocalAttempt, OptionKey, Paper } from '../../lib/types';
import { Sheet, Spinner, toast } from '../../ui/components';
import { IcBack, IcCalc, IcFlag, IcGrid, IcMoon, IcNext } from '../../ui/icons';
import { Options, Passage, Stem, Tutor, whyNotFor } from './Question';
import { Navigator, type SubjectRange } from './Navigator';
import { syncText, timerLevel, type SyncState } from './status';
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
  const [sync, setSync] = useState<SyncState>('phone');
  const [submitBusy, setSubmitBusy] = useState(false);
  const attRef = useRef<LocalAttempt | null>(null);
  const enteredAt = useRef(Date.now());
  const warned = useRef<Set<number>>(new Set());
  const submitting = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const remoteTimer = useRef<ReturnType<typeof setTimeout>>();
  const dirty = useRef(false); // answers changed since the server last confirmed them (timed papers)

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
  const timed = !!att?.deadline_at;

  const subjects = useMemo(() => {
    const out: SubjectRange[] = [];
    qs.forEach((x, i) => {
      const last = out[out.length - 1];
      if (last && last.code === x.subject) last.end = i; else out.push({ code: x.subject, start: i, end: i });
    });
    return out;
  }, [qs]);
  const curSubj = subjects.find((s) => att && att.current >= s.start && att.current <= s.end);

  /** Send the answers to the server (timed papers only). The label says Saved only when the server confirmed it. */
  const pushRemote = useCallback(async () => {
    const a = attRef.current;
    if (!a || !a.deadline_at || a.status !== 'in_progress' || !dirty.current) return;
    if (!navigator.onLine) { setSync('offline'); return; }
    setSync('saving');
    try {
      const r = await saveAnswersRemote(a);
      if (attRef.current?.updated_at === a.updated_at) { dirty.current = r !== 'saved'; setSync(r === 'saved' ? 'saved' : navigator.onLine ? 'pending' : 'offline'); }
    } catch { setSync('pending'); }
  }, []);

  // Persist on the phone within the same tick as the tap (IndexedDB write is a few ms); the server copy follows.
  const persist = useCallback((patch: Partial<LocalAttempt>) => {
    const a = attRef.current;
    if (!a) return;
    const next = { ...a, ...patch, updated_at: Date.now() };
    attRef.current = next; setAtt(next);
    db.attempts.put(next).then(() => { if (!next.deadline_at) setSync('phone'); }).catch(() => setSync('error'));
    if (next.deadline_at && next.status === 'in_progress') {
      dirty.current = true;
      setSync(navigator.onLine ? 'saving' : 'offline');
      clearTimeout(remoteTimer.current);
      remoteTimer.current = setTimeout(() => { pushRemote(); }, 1500);
    }
  }, [pushRemote]);

  // Back online, or a failed save: try again (every 20 s while something is waiting).
  useEffect(() => {
    const retry = () => { if (dirty.current) pushRemote(); };
    const offline = () => { if (attRef.current?.deadline_at) setSync('offline'); };
    window.addEventListener('online', retry);
    window.addEventListener('offline', offline);
    const t = setInterval(retry, 20_000);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('offline', offline); clearInterval(t); };
  }, [pushRemote]);

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

  const remaining = att?.deadline_at ? (new Date(att.deadline_at).getTime() - (now + att.clock_offset_ms)) / 1000 : null;
  const expired = remaining != null && remaining <= 0;

  const select = useCallback((k: OptionKey) => {
    const a = attRef.current;
    if (!a || !q || a.status !== 'in_progress') return;
    if (a.deadline_at && new Date(a.deadline_at).getTime() <= Date.now() + a.clock_offset_ms) return; // out of time: no more answers
    if (instant && a.answers[q.id]?.selected) return; // locked after the first choice in instant mode
    const answers = withTime(a.answers, q.id);
    answers[q.id] = { ...answers[q.id], selected: k };
    persist({ answers });
  }, [q, instant, persist, withTime]);

  // Flagging keeps the chosen answer.
  const toggleFlag = useCallback(() => {
    const a = attRef.current;
    if (!a || !q) return;
    const cur = a.answers[q.id] ?? { selected: null, time_ms: 0, flagged: false };
    persist({ answers: { ...a.answers, [q.id]: { ...cur, flagged: !cur.flagged } } });
  }, [q, persist]);

  const submit = useCallback(async (auto = false) => {
    const a = attRef.current;
    if (!a || !paper || submitting.current) return;
    submitting.current = true; setSubmitBusy(true);
    clearTimeout(remoteTimer.current);
    const answers = withTime(a.answers, qs[a.current].id);
    const serverNow = Date.now() + a.clock_offset_ms;
    const duration = Math.round((serverNow - new Date(a.started_at).getTime()) / 1000);
    const done: LocalAttempt = {
      ...a, answers, status: 'submitted', submitted_at: new Date(serverNow).toISOString(),
      duration_sec: a.time_limit_sec ? Math.min(duration, a.time_limit_sec) : duration, sync: 'local', updated_at: Date.now(),
    };
    try { await db.attempts.put(done); }
    catch { submitting.current = false; setSubmitBusy(false); toast('Could not save on this phone. Free some storage and try again.'); return; }
    attRef.current = done;
    enqueueSubmit(done, paper.questions).catch(() => {});
    if (auto) toast('Time is up. Your answers were submitted.');
    nav(`/result/${a.id}`, { replace: true });
  }, [paper, qs, withTime, nav]);

  // Timer from the server deadline (corrected for the phone's clock), so a refresh never resets it.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = att ? (now + att.clock_offset_ms - new Date(att.started_at).getTime()) / 1000 : 0;
  useEffect(() => {
    if (remaining == null || !att || att.status !== 'in_progress') return;
    const limit = att.time_limit_sec ?? Infinity;
    for (const mark of [300, 60]) {
      // Only warn for marks well inside the paper's length (a 5-minute quiz does not open with "5 minutes left").
      if (mark < limit * 0.9 && remaining <= mark && remaining > 0 && !warned.current.has(mark)) {
        warned.current.add(mark);
        toast(mark === 300 ? '5 minutes left. Check your flagged questions.' : '1 minute left.');
      }
    }
    if (remaining <= 0) submit(true);
  }, [remaining, att, submit]);

  // JAMB keyboard shortcuts: A–E select, N next, P previous, S submit, R review/palette, F flag.
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
  const answeredTotal = qs.filter((x) => att.answers[x.id]?.selected).length;
  const flaggedTotal = qs.filter((x) => att.answers[x.id]?.flagged).length;
  const pct = qs.length ? Math.round((100 * answeredTotal) / qs.length) : 0;
  const posInSubj = curSubj ? att.current - curSubj.start + 1 : att.current + 1;
  const subjLen = curSubj ? curSubj.end - curSubj.start + 1 : qs.length;
  const level = timerLevel(remaining, att.time_limit_sec);
  const st = syncText(sync, timed);
  const kind = att.type === 'mock' ? 'JAMB standard mock' : att.type === 'daily_quiz' ? 'Daily Builder Quiz' : att.type === 'challenge' ? 'Challenge' : timed ? 'Timed practice' : 'Practice';
  const navigator_ = <Navigator qs={qs} att={att} subjects={subjects} instant={instant} onJump={(i) => { goTo(i); setSheet(null); }} />;
  const submitCard = (
    <div className="xsub">
      <div><b>Ready to submit?</b><span className="muted small num">{answeredTotal} of {qs.length} answered{flaggedTotal ? ` · ${flaggedTotal} flagged` : ''}</span></div>
      <button className="btn btn-accent btn-block" onClick={() => setSheet('submit')}>Review and submit</button>
    </div>
  );

  return (
    <div className="cbt">
      <header className="xh">
        <div className="xh-row">
          <button className="icon-btn" aria-label="Leave the paper" onClick={() => setSheet('leave')}><IcBack /></button>
          <div className="xh-title">
            <span className="xh-brand">KAIRO CBT <i>· Seize the moment.</i></span>
            <b>{att.title}</b>
          </div>
          <span className={`xsync s-${sync}`} role="status" aria-live="polite" title={st.long}><i aria-hidden="true" />{st.short}</span>
          <div className={`timer num t-${level}`} role="timer" aria-label={remaining != null ? `Time left ${clock(Math.max(0, remaining))}` : `Time spent ${clock(elapsed)}`}>
            <small>{remaining != null ? 'Time left' : 'Time'}</small>
            {remaining != null ? clock(Math.max(0, remaining)) : clock(elapsed)}
          </div>
        </div>
        <div className="xh-meta">
          <span className="small"><span className="xh-kind">{kind}</span>{curSubj && subjects.length > 1 ? '' : ` · ${subjectName(q.subject)}`}</span>
          <span className="small num"><b>{answeredTotal}</b> of {qs.length} answered · {pct}%</span>
        </div>
        <div className="xh-prog" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={answeredTotal}><i style={{ width: `${pct}%` }} /></div>
        {subjects.length > 1 && (
          <div className="xh-tabs" role="tablist" aria-label="Subjects">
            {subjects.map((s) => {
              const n = qs.slice(s.start, s.end + 1).filter((x) => att.answers[x.id]?.selected).length;
              return (
                <button key={s.code} role="tab" aria-selected={curSubj?.code === s.code} onClick={() => goTo(s.start)}>
                  {subjectName(s.code)}<small className="num">{n}/{s.end - s.start + 1}</small>
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="cbt-main">
        <div className="cbt-body" ref={bodyRef}>
          <div className="cbt-inner">
            {q.passage_html && <Passage html={q.passage_html} open={passageOpen} onToggle={() => setPassageOpen((o) => !o)} />}
            <article className="qcard" aria-labelledby="qhead">
              <div className="qhead">
                <h2 id="qhead" className="qnum num">Question {posInSubj} of {subjLen}</h2>
                <span className={`qstate ${selected ? 'on' : ''}`}>{selected ? 'Answered' : 'Not answered'}</span>
                <button className="flag-btn" aria-pressed={!!ans?.flagged} onClick={toggleFlag} aria-label={ans?.flagged ? 'Remove flag (F)' : 'Flag for review (F)'}>
                  <IcFlag fill={ans?.flagged ? 'currentColor' : 'none'} /><span>{ans?.flagged ? 'Flagged' : 'Flag'}</span>
                </button>
              </div>
              <p className="qsrc">{subjectName(q.subject)} · {questionLabel(q)}</p>
              <Stem q={q} />
              <Options q={q} selected={selected} reveal={reveal} onSelect={expired ? undefined : select} whyNot={reveal ? whyNotFor(q) : undefined} />
              {reveal && <Tutor q={q} selected={selected} />}
            </article>
            {(isLast || answeredTotal === qs.length) && <div className="xsub-inline">{submitCard}</div>}
          </div>
        </div>
        <aside className="cbt-side" aria-label="Question navigator">
          <h2 className="side-h">Questions</h2>
          {navigator_}
          {submitCard}
        </aside>
      </div>

      <footer className="cbt-bar">
        <button className="tool tool-nav" aria-label={`Question navigator (R): ${answeredTotal} of ${qs.length} answered`} onClick={() => setSheet('palette')}>
          <IcGrid /><span className="num">{answeredTotal}/{qs.length}</span>
        </button>
        <button className="tool" aria-label="Calculator" onClick={() => setSheet('calc')}><IcCalc /></button>
        <span />
        <button className="btn xprev" onClick={() => goTo(att.current - 1)} disabled={att.current === 0} aria-label="Previous question (P)"><IcBack /><span>Previous</span></button>
        {isLast
          ? <button className="btn btn-accent xnext" onClick={() => setSheet('submit')}>Review and submit</button>
          : <button className="btn btn-accent xnext" onClick={() => goTo(att.current + 1)} aria-label="Next question (N)"><span>Next</span><IcNext /></button>}
      </footer>

      <Sheet open={sheet === 'palette'} onClose={() => setSheet(null)} label="Question navigator">
        <div className="sheet-body stack">
          <div className="row-between">
            <h2>Questions</h2>
            <button className="icon-btn" aria-label="Switch light or dark" onClick={toggleTheme}><IcMoon /></button>
          </div>
          {navigator_}
          {submitCard}
        </div>
      </Sheet>

      <Sheet open={sheet === 'calc'} onClose={() => setSheet(null)} label="Calculator">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2>Calculator</h2>
          <button className="btn btn-sm" onClick={() => setSheet(null)}>Done</button>
        </div>
        <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}><Calculator /></Suspense>
      </Sheet>

      <Sheet open={sheet === 'submit'} onClose={() => !submitBusy && setSheet(null)} label="Submit">
        <div className="sheet-body stack">
          <div className="stack-sm"><p className="eyebrow">Submit</p><h2>Submit your answers?</h2>
            <p className="muted small">Once you submit, you cannot change your answers.</p></div>
          <dl className="sum-grid">
            <div><dt>Questions</dt><dd className="num">{qs.length}</dd></div>
            <div className="ok"><dt>Answered</dt><dd className="num">{answeredTotal}</dd></div>
            <div className={answeredTotal < qs.length ? 'warn' : ''}><dt>Unanswered</dt><dd className="num">{qs.length - answeredTotal}</dd></div>
            <div className={flaggedTotal ? 'flag' : ''}><dt>Flagged</dt><dd className="num">{flaggedTotal}</dd></div>
            <div><dt>{remaining != null ? 'Time left' : 'Time spent'}</dt><dd className="num">{remaining != null ? clock(Math.max(0, remaining)) : clock(elapsed)}</dd></div>
          </dl>
          {subjects.length > 1 && (
            <div className="submit-list">
              {subjects.map((s) => {
                const slice = qs.slice(s.start, s.end + 1);
                const un = slice.filter((x) => !att.answers[x.id]?.selected).length;
                const fl = slice.filter((x) => att.answers[x.id]?.flagged).length;
                return (
                  <div key={s.code} className="row-between">
                    <b>{subjectName(s.code)}</b>
                    <span className="small num"><span className={un ? '' : 'muted'}>{un} unanswered</span> · <span className={fl ? 'flag-t' : 'muted'}>{fl} flagged</span></span>
                  </div>
                );
              })}
            </div>
          )}
          {timed && sync !== 'saved' && navigator.onLine === false && <p className="small muted">You are offline. Your answers are safe on this phone and will be sent when you are back online.</p>}
          <div className="row">
            <button className="btn grow" disabled={submitBusy} onClick={() => setSheet(null)}>Return to exam</button>
            <button className="btn btn-accent grow" disabled={submitBusy} onClick={() => submit()}>{submitBusy ? 'Submitting…' : 'Submit now'}</button>
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
