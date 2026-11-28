import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendlyError } from '../../lib/supabase';
import { toast } from '../../ui/components';
import {
  addDetail, askPrompt, dismissPrompt, flushOutbox, publicReviews, REASONS_IMPROVE, REASONS_PRACTICE, submitFeedback,
  type Prompt, type PublicReview, type Trigger,
} from './api';
import './voice.css';

// ───────────────────────── stars ─────────────────────────
const STAR_WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

/** Accessible 1–5 star picker: a radio group (arrow keys work), big touch targets. */
export function StarInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const name = useId();
  return (
    <fieldset className="vc-stars">
      <legend className="sr-only">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={n <= value ? 'on' : ''}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
          <span aria-hidden="true">★</span><span className="sr-only">{n} star{n > 1 ? 's' : ''}: {STAR_WORDS[n]}</span>
        </label>
      ))}
      <span className="vc-star-word" aria-hidden="true">{STAR_WORDS[value]}</span>
    </fieldset>
  );
}
export const Stars = ({ n }: { n: number }) => (
  <span className="vc-stars-ro" role="img" aria-label={`${n} out of 5 stars`}>{'★★★★★'.slice(0, n)}<i>{'★★★★★'.slice(n)}</i></span>
);

function Chips({ items, value, onToggle, label }: { items: { key: string; label: string }[]; value: string[]; onToggle: (k: string) => void; label: string }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {items.map((r) => <button key={r.key} type="button" className="chip" aria-pressed={value.includes(r.key)} onClick={() => onToggle(r.key)}>{r.label}</button>)}
    </div>
  );
}
const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
const sentMsg = (s: 'sent' | 'queued') => (s === 'queued' ? 'Saved on this phone. It will send when you are back online.' : '');

// ───────────────────────── overall experience rating ─────────────────────────
/** "How is your KAIRO experience so far?" Stars are required; the follow-up is optional and asked once. */
export function RatingFlow({ trigger, onDone, prompt }: { trigger: Trigger; onDone?: () => void; prompt?: Prompt }) {
  const [stars, setStars] = useState(0);
  const [step, setStep] = useState<'rate' | 'more' | 'done'>('rate');
  const [id, setId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const low = stars > 0 && stars <= 3;

  const rate = async () => {
    if (!stars || busy) return;
    setBusy(true);
    try {
      const r = await submitFeedback({ category: 'overall', rating: stars, trigger, prompt: prompt?.prompt });
      setId(r.id); setQueued(r.status === 'queued'); setStep(r.status === 'queued' ? 'done' : 'more');
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  const more = async () => {
    if (busy) return;
    if (!id || (!text.trim() && !reasons.length)) { setStep('done'); onDone?.(); return; }
    setBusy(true);
    try { await addDetail(id, reasons, text.trim()); } catch { /* the rating itself is saved; the extra note is optional */ }
    setBusy(false); setStep('done'); onDone?.();
  };

  if (step === 'done') return (
    <div className="vc-done" role="status">
      <b>Thank you. Your rating helps us make KAIRO better.</b>
      {queued && <p className="muted small">{sentMsg('queued')}</p>}
      {stars >= 4 && <Link to="/feedback/review" className="vc-link">Enjoying KAIRO? Share your experience with other students →</Link>}
    </div>
  );
  if (step === 'more') return (
    <div className="stack-sm">
      <p className="vc-q">{low ? 'What should we improve?' : 'What do you like most about KAIRO?'} <span className="muted small">(optional)</span></p>
      {low && <Chips items={REASONS_IMPROVE} value={reasons} onToggle={(k) => setReasons(toggle(reasons, k))} label="What to improve" />}
      <label className="sr-only" htmlFor="vc-more">{low ? 'What should we improve?' : 'What do you like most?'}</label>
      <textarea id="vc-more" className="input vc-text" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={low ? 'Tell us what went wrong. Please do not include phone numbers.' : 'A sentence is plenty.'} />
      <div className="row wrap"><button className="btn btn-accent btn-sm" onClick={more} disabled={busy}>{busy ? 'Sending…' : text.trim() || reasons.length ? 'Send' : 'Done'}</button></div>
    </div>
  );
  return (
    <div className="stack-sm">
      <p className="vc-q" id="vc-rate-q">How is your KAIRO experience so far?</p>
      <StarInput value={stars} onChange={setStars} label="How is your KAIRO experience so far?" />
      <div className="row wrap"><button className="btn btn-accent btn-sm" onClick={rate} disabled={!stars || busy}>{busy ? 'Sending…' : 'Submit rating'}</button></div>
    </div>
  );
}

// ───────────────────────── contextual practice feedback ─────────────────────────
function PracticeFlow({ prompt, attemptId, onDone }: { prompt: Prompt; attemptId: string; onDone: () => void }) {
  const [step, setStep] = useState<'ask' | 'why' | 'done'>('ask');
  const [reasons, setReasons] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const send = async (helpful: 'very' | 'okay' | 'not', extra?: { reasons: string[]; body: string }) => {
    setBusy(true);
    try {
      const r = await submitFeedback({ category: 'practice', helpful, trigger: 'practice_prompt', prompt: prompt.prompt, attempt_id: attemptId,
        feature: prompt.feature ?? undefined, reasons: extra?.reasons, body: extra?.body || undefined });
      setQueued(r.status === 'queued'); setStep('done'); onDone();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  if (step === 'done') return <div className="vc-done" role="status"><b>Thanks for telling us.</b>{queued && <p className="muted small">{sentMsg('queued')}</p>}</div>;
  if (step === 'why') return (
    <div className="stack-sm">
      <p className="vc-q">What went wrong? <span className="muted small">(optional)</span></p>
      <Chips items={REASONS_PRACTICE} value={reasons} onToggle={(k) => setReasons(toggle(reasons, k))} label="What went wrong" />
      <label className="sr-only" htmlFor="vc-why">Anything else?</label>
      <textarea id="vc-why" className="input vc-text" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything else? (optional)" />
      <div className="row wrap"><button className="btn btn-accent btn-sm" disabled={busy} onClick={() => send('not', { reasons, body: text.trim() })}>{busy ? 'Sending…' : 'Send'}</button></div>
    </div>
  );
  return (
    <div className="stack-sm">
      <p className="vc-q">Was this practice session helpful?</p>
      <div className="vc-opts" role="group" aria-label="Was this practice session helpful?">
        <button className="chip" disabled={busy} onClick={() => send('very')}>👍 Yes, very helpful</button>
        <button className="chip" disabled={busy} onClick={() => send('okay')}>🙂 It was okay</button>
        <button className="chip" disabled={busy} onClick={() => setStep('why')}>👎 Not really</button>
      </div>
    </div>
  );
}

// ───────────────────────── prompt cards (never modal, always skippable) ─────────────────────────
function PromptShell({ children, onSkip, done, label }: { children: React.ReactNode; onSkip: () => void; done: boolean; label: string }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} className="card vc-prompt" aria-label={label}>
      {!done && <button className="vc-skip" onClick={onSkip} aria-label="Skip this question">Skip</button>}
      {children}
    </section>
  );
}

/** Result screen: optional "Was this practice session helpful?" (or the overall rating), below the next steps. */
export function ResultVoice({ attemptId }: { attemptId: string }) {
  const [p, setP] = useState<Prompt | null>(null);
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { void flushOutbox(); askPrompt('result', attemptId).then(setP); }, [attemptId]);
  if (!p || gone) return null;
  const skip = () => { dismissPrompt(p); setGone(true); };
  return (
    <PromptShell onSkip={skip} done={done} label="Quick feedback">
      {p.prompt === 'practice_helpful'
        ? <PracticeFlow prompt={p} attemptId={attemptId} onDone={() => setDone(true)} />
        : <RatingFlow trigger="rating_prompt" prompt={p} onDone={() => setDone(true)} />}
    </PromptShell>
  );
}

/** Home: the overall rating after a few sessions, or a testimonial invitation after a week of practice. */
export function HomeVoice() {
  const [p, setP] = useState<Prompt | null>(null);
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { void flushOutbox(); askPrompt('home').then(setP); }, []);
  if (!p || gone) return null;
  const skip = () => { dismissPrompt(p); setGone(true); };
  if (p.prompt === 'testimonial_invite') return (
    <PromptShell onSkip={skip} done={false} label="Share your experience">
      <p className="vc-q">Enjoying KAIRO? Share your experience with other students.</p>
      <p className="muted small">Reviews are checked before they appear, and you choose how your name is shown.</p>
      <div className="row wrap"><Link className="btn btn-accent btn-sm" to="/feedback/review">Write a review</Link>
        <button className="btn btn-ghost btn-sm" onClick={skip}>Not now</button></div>
    </PromptShell>
  );
  return <PromptShell onSkip={skip} done={done} label="Rate KAIRO"><RatingFlow trigger="rating_prompt" prompt={p} onDone={() => setDone(true)} /></PromptShell>;
}

// ───────────────────────── public reviews ─────────────────────────
const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
export function ReviewCard({ r }: { r: PublicReview }) {
  return (
    <article className="vc-review">
      {r.rating ? <Stars n={r.rating} /> : null}
      <blockquote>{r.body}</blockquote>
      <footer><b>{r.name}</b>{r.verified && <span className="vc-verified" title="Has practised on KAIRO">✓ KAIRO student</span>}<time dateTime={r.published_at}>{dFmt.format(new Date(r.published_at))}</time></footer>
    </article>
  );
}

/** Home: up to three approved reviews. Hidden entirely until there is at least one real review. */
export function HomeReviews() {
  const [rows, setRows] = useState<PublicReview[] | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => { publicReviews(3).then((d) => { setRows(d.reviews); setTotal(d.total); }).catch(() => setRows([])); }, []);
  if (!rows || !rows.length) return null;
  return (
    <section className="stack-sm vc-home-reviews" aria-labelledby="h-reviews">
      <div className="sec-head"><h2 id="h-reviews">What students say</h2><Link to="/reviews" className="sec-link">All {total} review{total === 1 ? '' : 's'} →</Link></div>
      <div className="vc-review-row">{rows.map((r) => <ReviewCard key={r.id} r={r} />)}</div>
    </section>
  );
}
