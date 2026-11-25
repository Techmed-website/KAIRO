import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCatalog } from '../../lib/catalog';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import type { CatalogSubject, SubjectCode } from '../../lib/types';
import { toast } from '../../ui/components';
import { StaffOnly } from './StaffOnly';
import { fromLocalInput, quizDetail, saveQuiz, searchQuestions, toLocalInput, TYPE_LABEL, type QuizType, type SearchQuestion } from './data';
import './admin.css';

type Picked = Pick<SearchQuestion, 'id' | 'subject' | 'topic' | 'year' | 'stem'>;
const SUBJECTS: SubjectCode[] = ['BIO', 'CHM', 'PHY', 'ENG', 'MTH'];

/**
 * Create or edit a quiz in one screen: what it is, which questions, the rules, the result screen. Save as a draft,
 * publish now, or schedule by setting an opening time. A prize challenge takes about two minutes.
 */
export default function QuizForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [cat, setCat] = useState<CatalogSubject[]>([]);
  const [locked, setLocked] = useState(false);       // students have played: questions, time and ranking are fixed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // What
  const [type, setType] = useState<QuizType>('challenge');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Questions
  const [subject, setSubject] = useState<SubjectCode>('BIO');
  const [topicId, setTopicId] = useState<string>('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [text, setText] = useState('');
  const [freshDays, setFreshDays] = useState('60');
  const [count, setCount] = useState('10');
  const [found, setFound] = useState<SearchQuestion[] | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  // Rules
  const [minutes, setMinutes] = useState('10');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [ranked, setRanked] = useState(true);
  const [attempts, setAttempts] = useState('');
  const [guests, setGuests] = useState(true);
  const [passcode, setPasscode] = useState('');
  const [hadPasscode, setHadPasscode] = useState(false);
  const [passTouched, setPassTouched] = useState(false);
  const [prize, setPrize] = useState('');
  const [winners, setWinners] = useState('');
  // Result screen
  const [passMark, setPassMark] = useState('60');
  const [band, setBand] = useState({ passImg: '', passQuote: '', neutralImg: '', neutralQuote: '', failImg: '', failQuote: '' });

  useEffect(() => { getCatalog().then(setCat).catch(() => {}); }, []);
  useEffect(() => {
    if (!id) return;
    quizDetail(id).then(({ quiz: z, questions }) => {
      setType(z.type); setTitle(z.title); setDescription(z.description ?? '');
      if (z.subject) setSubject(z.subject);
      setPicked(questions.map((q) => ({ id: q.id, subject: q.subject, topic: q.topic, year: q.year, stem: q.stem })));
      setMinutes(z.time_limit_sec ? String(Math.round(z.time_limit_sec / 60)) : '');
      setOpensAt(toLocalInput(z.opens_at)); setClosesAt(toLocalInput(z.closes_at));
      setRanked(z.ranked); setAttempts(z.attempts_allowed ? String(z.attempts_allowed) : ''); setGuests(z.guests_allowed);
      setHadPasscode(z.has_passcode); setPrize(z.prize_text ?? ''); setWinners(z.max_winners ? String(z.max_winners) : '');
      const rc = z.result_config ?? {};
      setPassMark(String(rc.pass_mark ?? 60));
      setBand({ passImg: rc.pass?.image ?? '', passQuote: rc.pass?.quote ?? '', neutralImg: rc.neutral?.image ?? '', neutralQuote: rc.neutral?.quote ?? '',
                failImg: rc.fail?.image ?? '', failQuote: rc.fail?.quote ?? '' });
      setLocked(z.has_attempts);
    }).catch((e) => setErr(friendlyError(e)));
  }, [id]);

  const topics = useMemo(() => cat.find((s) => s.code === subject)?.topics ?? [], [cat, subject]);
  const filters = () => ({
    subject, topic_id: topicId ? Number(topicId) : undefined, year_from: yearFrom ? Number(yearFrom) : undefined,
    year_to: yearTo ? Number(yearTo) : undefined, q: text || undefined, exclude_recent_days: freshDays ? Number(freshDays) : 0,
  });
  const pickedIds = new Set(picked.map((p) => p.id));

  const search = async () => {
    setErr(''); setFound(null);
    try { setFound(await searchQuestions({ ...filters(), limit: 50 })); } catch (e) { setErr(friendlyError(e)); }
  };
  const autoPick = async () => {
    setErr('');
    const n = Math.max(1, Math.min(100, Number(count) || 10));
    try {
      const got = await searchQuestions({ ...filters(), random: true, limit: n + picked.length });
      const add = got.filter((q) => !pickedIds.has(q.id)).slice(0, n);
      setPicked((p) => [...p, ...add]);
      toast(`${add.length} questions added`);
    } catch (e) { setErr(friendlyError(e)); }
  };

  const save = async (publish: boolean) => {
    setErr('');
    if (!title.trim()) { setErr('Give the quiz a title.'); return; }
    if (!picked.length) { setErr('Add some questions first.'); return; }
    setBusy(true);
    const rc = {
      pass_mark: Number(passMark) || 60,
      ...(band.passImg || band.passQuote ? { pass: { image: band.passImg || undefined, quote: band.passQuote || undefined } } : {}),
      ...(band.neutralImg || band.neutralQuote ? { neutral: { image: band.neutralImg || undefined, quote: band.neutralQuote || undefined } } : {}),
      ...(band.failImg || band.failQuote ? { fail: { image: band.failImg || undefined, quote: band.failQuote || undefined } } : {}),
    };
    const p: Record<string, unknown> = {
      id: id ?? undefined, type, title: title.trim(), description, subject: picked.every((q) => q.subject === picked[0].subject) ? picked[0].subject : null,
      opens_at: fromLocalInput(opensAt), closes_at: fromLocalInput(closesAt), attempts_allowed: attempts ? Number(attempts) : null,
      guests_allowed: guests, prize_text: prize, max_winners: winners ? Number(winners) : null, result_config: rc, publish,
    };
    if (!locked) Object.assign(p, { question_ids: picked.map((q) => q.id), time_limit_sec: minutes ? Number(minutes) * 60 : null, ranked, shuffle: true });
    if (passTouched) p.passcode = passcode;
    try {
      const r = await saveQuiz(p);
      toast(r.status === 'draft' ? 'Draft saved' : r.status === 'scheduled' ? 'Scheduled' : 'Published');
      nav(`/editor/quizzes/${r.id}`, { replace: true });
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  const willSchedule = opensAt && new Date(opensAt).getTime() > Date.now();

  return (
    <StaffOnly>
      <div className="page stack admin">
        <div><Link to="/editor/quizzes" className="small">‹ Quizzes</Link><h1>{id ? 'Edit quiz' : 'New quiz'}</h1></div>
        {locked && <p className="card info">Students have already taken this quiz, so its questions, time and ranking are fixed. Duplicate it to change those.</p>}

        <section className="card stack-sm">
          <h2>1 · What is it?</h2>
          <div className="chip-scroll">
            {(['challenge', 'topic_test', 'weekly_drill', 'mock'] as QuizType[]).map((t) => (
              <button key={t} className="chip" aria-pressed={type === t} disabled={locked} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
            ))}
          </div>
          <input className="input" placeholder="Title, e.g. Biology Champions Challenge" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          <textarea className="input" rows={2} placeholder="One or two lines for the website and WhatsApp (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
        </section>

        <section className="card stack-sm">
          <div className="row-between"><h2>2 · Questions</h2><span className="badge num">{picked.length} chosen</span></div>
          {!locked && <>
            <div className="chip-scroll">
              {SUBJECTS.map((s) => <button key={s} className="chip" aria-pressed={subject === s} onClick={() => { setSubject(s); setTopicId(''); }}>{subjectName(s)}</button>)}
            </div>
            <select className="input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">All topics</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.count})</option>)}
            </select>
            <div className="row">
              <input className="input" inputMode="numeric" placeholder="From year" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} />
              <input className="input" inputMode="numeric" placeholder="To year" value={yearTo} onChange={(e) => setYearTo(e.target.value)} />
            </div>
            <input className="input" placeholder="Words in the question (optional)" value={text} onChange={(e) => setText(e.target.value)} />
            <label className="small row"><span className="grow">Skip questions used in the last</span>
              <input className="input mini" inputMode="numeric" value={freshDays} onChange={(e) => setFreshDays(e.target.value)} /> days</label>
            <div className="row">
              <input className="input mini" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-label="How many" />
              <button className="btn btn-primary grow" onClick={autoPick}>Auto-pick these</button>
              <button className="btn grow" onClick={search}>Search</button>
            </div>
            {found && (
              <div className="aq-found">
                {found.length === 0 && <p className="muted small">No questions match. Widen the filters.</p>}
                {found.map((q) => (
                  <label key={q.id} className="aq-q">
                    <input type="checkbox" checked={pickedIds.has(q.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, q] : p.filter((x) => x.id !== q.id))} />
                    <span><span className="muted small">{q.topic ?? subjectName(q.subject)} · {q.year ?? '—'}{q.diagram ? ' · diagram' : ''}{q.flagged ? ' · ⚠ flagged' : ''}{q.last_used ? ' · used before' : ''}</span>
                      <span className="block">{q.stem}</span></span>
                  </label>
                ))}
              </div>
            )}
          </>}
          {picked.length > 0 && (
            <ol className="aq-picked">
              {picked.map((q, i) => (
                <li key={q.id}>
                  <span className="grow"><span className="muted small">{subjectName(q.subject)}{q.topic ? ` · ${q.topic}` : ''} · {q.year ?? '—'}</span>
                    <span className="block">{q.stem}</span></span>
                  {!locked && <span className="aq-ord">
                    <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => setPicked((p) => { const n = p.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>↑</button>
                    <button className="icon-btn" aria-label="Remove" onClick={() => setPicked((p) => p.filter((x) => x.id !== q.id))}>✕</button>
                  </span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card stack-sm">
          <h2>3 · Rules</h2>
          <label className="field"><span>Time limit (minutes)</span><input className="input" inputMode="numeric" disabled={locked} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="No limit" /></label>
          <label className="field"><span>Opens (leave empty to open when you publish)</span><input className="input" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></label>
          <label className="field"><span>Closes (optional)</span><input className="input" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
          <label className="toggle"><input type="checkbox" checked={ranked} disabled={locked} onChange={(e) => setRanked(e.target.checked)} /> Leaderboard (first attempt counts)</label>
          <label className="toggle"><input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} /> Guests can play without an account</label>
          <label className="field"><span>Attempts allowed (empty = unlimited)</span><input className="input" inputMode="numeric" value={attempts} onChange={(e) => setAttempts(e.target.value)} /></label>
          <label className="field"><span>Passcode {hadPasscode && !passTouched ? '(set; type a new one to change, or clear it)' : '(optional, makes it private)'}</span>
            <input className="input" value={passcode} placeholder={hadPasscode && !passTouched ? '••••••' : ''} onChange={(e) => { setPasscode(e.target.value); setPassTouched(true); }} /></label>
          <label className="field"><span>Prize (optional)</span><input className="input" value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g. ₦5,000 airtime" /></label>
          {prize && <label className="field"><span>Number of winners</span><input className="input" inputMode="numeric" value={winners} onChange={(e) => setWinners(e.target.value)} /></label>}
        </section>

        <details className="card stack-sm">
          <summary><b>4 · Result screen (optional)</b></summary>
          <label className="field"><span>Pass mark (%)</span><input className="input" inputMode="numeric" value={passMark} onChange={(e) => setPassMark(e.target.value)} /></label>
          {(['pass', 'neutral', 'fail'] as const).map((b) => (
            <div key={b} className="stack-sm">
              <b className="small">{b === 'pass' ? 'Passed' : b === 'neutral' ? 'Close' : 'Needs support'}</b>
              <input className="input" placeholder="Image link (https://…)" value={band[`${b}Img`]} onChange={(e) => setBand({ ...band, [`${b}Img`]: e.target.value })} />
              <input className="input" placeholder="Quote (leave empty for TECHMED's own)" value={band[`${b}Quote`]} onChange={(e) => setBand({ ...band, [`${b}Quote`]: e.target.value })} />
            </div>
          ))}
        </details>

        {err && <p className="error" role="alert">{err}</p>}
        <div className="stack-sm aq-save">
          <button className="btn btn-accent btn-lg btn-block" disabled={busy} onClick={() => save(true)}>
            {busy ? 'Saving…' : willSchedule ? 'Schedule' : 'Publish now'}</button>
          <button className="btn btn-block" disabled={busy} onClick={() => save(false)}>Save as draft</button>
        </div>
      </div>
    </StaffOnly>
  );
}
