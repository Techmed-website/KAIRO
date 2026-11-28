import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { track } from '../../lib/analytics';
import { friendlyError } from '../../lib/supabase';
import { Spinner, toast } from '../../ui/components';
import { IcBack, IcNext } from '../../ui/icons';
import {
  answerEdit, deleteTestimonial, flushOutbox, myVoice, outboxSize, publicReviews, submitFeedback, submitTestimonial, withdrawTestimonial,
  type Category, type MyFeedback, type MyTestimonial, type PublicReview,
} from './api';
import { RatingFlow, ReviewCard, StarInput, Stars } from './Voice';
import './voice.css';

const KINDS: { key: string; title: string; sub: string; category?: Category; placeholder?: string }[] = [
  { key: 'rate', title: 'Rate your experience', sub: '1 to 5 stars, 10 seconds' },
  { key: 'suggest', title: 'Suggest an improvement', sub: 'What would make KAIRO better for you?', category: 'suggestion', placeholder: 'I wish KAIRO…' },
  { key: 'problem', title: 'Report a problem', sub: 'Something broken, slow or wrong', category: 'technical', placeholder: 'What happened, and on which screen?' },
  { key: 'question', title: 'Report a question or explanation', sub: 'Unclear question, wrong answer, weak explanation', category: 'question_quality', placeholder: 'Which subject and topic? What is wrong with it?' },
  { key: 'feature', title: 'Request a feature', sub: 'Subjects, topics, tools you need', category: 'general', placeholder: 'I would love KAIRO to have…' },
  { key: 'review', title: 'Write a public review', sub: 'Share your experience with other students' },
];

const STATUS_WORD: Record<MyTestimonial['status'], string> = {
  pending: 'Waiting for review', approved: 'Published', rejected: 'Not published', hidden: 'Not shown at the moment', withdrawn: 'Withdrawn by you',
};
const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** /feedback: the voluntary feedback centre, plus the student's own reviews (withdraw, delete, approve edits). */
export function FeedbackCentre() {
  const { session } = useAuth();
  const guest = !session || !!session.user.is_anonymous;
  const [params, setParams] = useSearchParams();
  const kind = KINDS.find((k) => k.key === params.get('k'));
  const nav = useNavigate();
  const [mine, setMine] = useState<{ testimonials: MyTestimonial[]; feedback: MyFeedback[] } | null>(null);
  const load = useCallback(() => { if (!guest) myVoice().then(setMine).catch(() => setMine(null)); }, [guest]);
  useEffect(() => { void flushOutbox().then((n) => { if (n) toast(`${n} saved feedback message${n > 1 ? 's' : ''} sent`); load(); }); load(); }, [load]);

  if (guest) return (
    <div className="page vc-page">
      <nav className="crumbs-lite"><Link to="/" className="icon-btn" aria-label="Back"><IcBack /></Link></nav>
      <h1>Feedback</h1>
      <section className="card stack-sm"><p>Create your free account to send feedback and reviews. It takes 20 seconds.</p><Link to="/signin" className="btn btn-accent btn-sm">Create account</Link></section>
    </div>
  );

  const open = (k: string) => (k === 'review' ? nav('/feedback/review') : setParams({ k }));
  const back = () => { setParams({}); load(); };

  return (
    <div className="page vc-page">
      <nav className="crumbs-lite"><button className="icon-btn" aria-label="Back" onClick={() => (kind ? back() : nav(-1))}><IcBack /></button></nav>
      <header className="stack-sm"><h1>{kind ? kind.title : 'Feedback'}</h1>
        {!kind && <p className="muted">Tell us what works and what does not. Feedback is private: only the KAIRO team reads it.</p>}</header>
      {outboxSize() > 0 && <p className="vc-note">You have feedback saved on this phone. It will send when you are back online.</p>}

      {kind?.key === 'rate' && <section className="card"><RatingFlow trigger="voluntary" onDone={load} /></section>}
      {kind?.category && <TextForm category={kind.category} placeholder={kind.placeholder || ''} onDone={back} />}

      {!kind && (
        <>
          <nav className="vc-kinds" aria-label="What would you like to do?">
            {KINDS.map((k) => (
              <button key={k.key} className="vc-kind" onClick={() => open(k.key)}><span className="grow"><b>{k.title}</b><small>{k.sub}</small></span><IcNext className="chev" /></button>
            ))}
          </nav>
          <Link to="/reviews" className="vc-link">Read what other students say →</Link>
          {mine && mine.testimonials.length > 0 && <MyReviews rows={mine.testimonials} onChange={load} />}
          {mine && mine.feedback.length > 0 && (
            <section className="stack-sm" aria-labelledby="vc-mine-fb">
              <h2 id="vc-mine-fb">Your recent feedback</h2>
              <ul className="vc-mine">
                {mine.feedback.slice(0, 8).map((f) => (
                  <li key={f.id}><span className="grow">{f.rating ? <Stars n={f.rating} /> : null}{f.helpful ? <b>Practice: {f.helpful === 'very' ? 'very helpful' : f.helpful === 'okay' ? 'okay' : 'not really'}</b> : null}
                    {f.body ? <span className="vc-clamp">{f.body}</span> : null}</span>
                    <small>{dFmt.format(new Date(f.created_at))}{f.status === 'actioned' ? ' · acted on ✓' : f.status === 'reviewed' ? ' · read by the team' : ''}</small></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TextForm({ category, placeholder, onDone }: { category: Category; placeholder: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);
  const send = async () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    try { const r = await submitFeedback({ category, body: text.trim(), trigger: 'voluntary', feature: 'profile' }); setDone(r.status); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  if (done) return (
    <section className="card vc-done" role="status"><b>Thank you. The KAIRO team will read this.</b>
      {done === 'queued' && <p className="muted small">Saved on this phone. It will send when you are back online.</p>}
      <button className="btn btn-sm" onClick={onDone}>Back to feedback</button></section>
  );
  return (
    <section className="card stack-sm">
      <label htmlFor="vc-body" className="vc-q">Your message</label>
      <textarea id="vc-body" className="input vc-text" rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      <p className="muted small">Please do not include phone numbers or emails; we remove them automatically. {1000 - text.length} characters left.</p>
      <div className="row wrap"><button className="btn btn-accent" onClick={send} disabled={busy || text.trim().length < 3}>{busy ? 'Sending…' : 'Send feedback'}</button></div>
    </section>
  );
}

function MyReviews({ rows, onChange }: { rows: MyTestimonial[]; onChange: () => void }) {
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); onChange(); } catch (e) { toast(friendlyError(e)); } };
  return (
    <section className="stack-sm" aria-labelledby="vc-mine-t">
      <h2 id="vc-mine-t">Your reviews</h2>
      {rows.map((t) => (
        <article key={t.id} className="card vc-mine-t stack-sm">
          <div className="row-between wrap"><span className={`vc-status s-${t.status}`}>{STATUS_WORD[t.status]}</span><small className="muted">{dFmt.format(new Date(t.created_at))}</small></div>
          {t.rating ? <Stars n={t.rating} /> : null}
          <p className="vc-quote">{t.body}</p>
          <p className="muted small">Shown as: {t.display_mode === 'anon' ? 'KAIRO student (anonymous)' : t.display_mode === 'first' ? 'your first name' : t.display_name}</p>
          {t.edit_status === 'awaiting_student' && t.edited_body && (
            <div className="vc-edit stack-sm">
              <b>The KAIRO team suggested a tidier version. It will only be used if you agree:</b>
              <p className="vc-quote">{t.edited_body}</p>
              <div className="row wrap">
                <button className="btn btn-accent btn-sm" onClick={() => act(() => answerEdit(t.id, true), 'Thanks. The edited version will be used.')}>Use this version</button>
                <button className="btn btn-sm" onClick={() => act(() => answerEdit(t.id, false), 'Kept your original words.')}>Keep my original</button>
              </div>
            </div>
          )}
          <div className="row wrap">
            {t.status !== 'withdrawn' && <button className="btn btn-ghost btn-sm" onClick={() => confirm('Stop showing this review publicly? You can write a new one any time.') && act(() => withdrawTestimonial(t.id), 'Consent withdrawn. Your review will not be shown.')}>Withdraw consent</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => confirm('Delete this review for good?') && act(() => deleteTestimonial(t.id), 'Review deleted.')}>Delete</button>
          </div>
        </article>
      ))}
    </section>
  );
}

/** /feedback/review: separate testimonial flow with explicit, unticked consent. */
export function TestimonialForm() {
  const { session, profile } = useAuth();
  const guest = !session || !!session.user.is_anonymous;
  const nav = useNavigate();
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const [mode, setMode] = useState<'chosen' | 'first' | 'anon'>('first');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);
  const first = (profile?.full_name || '').trim().split(/\s+/)[0] || 'your first name';
  const ready = body.trim().length >= 20 && consent && (mode !== 'chosen' || name.trim().length > 0);

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const r = await submitTestimonial({ body: body.trim(), rating: rating || undefined, display_mode: mode, display_name: mode === 'chosen' ? name.trim() : undefined, consent });
      setDone(r.status);
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  if (guest) return <FeedbackCentre />;
  if (done) return (
    <div className="page vc-page">
      <section className="card vc-done stack-sm" role="status">
        <h1>Thank you!</h1>
        <p>Your review is waiting for a quick check by the KAIRO team. Once approved it will appear on the Student Reviews page. You can withdraw it at any time from Profile → Feedback.</p>
        {done === 'queued' && <p className="muted small">Saved on this phone. It will send when you are back online.</p>}
        <div className="row wrap"><Link to="/feedback" className="btn btn-sm">Done</Link><Link to="/reviews" className="btn btn-ghost btn-sm">See reviews</Link></div>
      </section>
    </div>
  );
  return (
    <div className="page vc-page">
      <nav className="crumbs-lite"><button className="icon-btn" aria-label="Back" onClick={() => nav(-1)}><IcBack /></button></nav>
      <header className="stack-sm"><h1>Share your experience</h1><p className="muted">Enjoying KAIRO? Tell other students what it has done for you. Honest reviews only, good or bad.</p></header>
      <section className="card stack">
        <div className="field">
          <label htmlFor="vc-t-body">Your review</label>
          <textarea id="vc-t-body" className="input vc-text" rows={5} minLength={20} maxLength={600} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="What has KAIRO helped you with? Which feature do you use most?" aria-describedby="vc-t-count" />
          <small id="vc-t-count" className="muted">{body.trim().length < 20 ? `${20 - body.trim().length} more characters needed` : `${600 - body.length} characters left`}</small>
        </div>
        <div className="field"><span className="vc-label">Star rating <span className="muted">(optional)</span></span><StarInput value={rating} onChange={setRating} label="Star rating (optional)" /></div>
        <fieldset className="field vc-modes">
          <legend className="vc-label">How should your name appear?</legend>
          <label><input type="radio" name="vc-mode" checked={mode === 'first'} onChange={() => setMode('first')} /> First name only <span className="muted">({first})</span></label>
          <label><input type="radio" name="vc-mode" checked={mode === 'chosen'} onChange={() => setMode('chosen')} /> A name I choose</label>
          {mode === 'chosen' && <input className="input" aria-label="Name to show" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tolu from Ibadan" />}
          <label><input type="radio" name="vc-mode" checked={mode === 'anon'} onChange={() => setMode('anon')} /> Publish anonymously <span className="muted">(“KAIRO student”)</span></label>
        </fieldset>
        <label className="vc-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree that KAIRO may display this review publicly inside KAIRO with the name option I chose. I understand reviews are checked before they appear, that KAIRO will not change my words without asking me, and that I can withdraw my consent at any time.</span>
        </label>
        <button className="btn btn-accent btn-block" onClick={send} disabled={!ready || busy}>{busy ? 'Sending…' : 'Submit review'}</button>
        {!consent && body.trim().length >= 20 && <p className="muted small">Tick the consent box to submit. If you would rather keep it private, <Link to="/feedback?k=suggest">send private feedback</Link> instead.</p>}
      </section>
    </div>
  );
}

/** /reviews: approved, consented student reviews only. */
export function Reviews() {
  const [rating, setRating] = useState<number | null>(null);
  const [rows, setRows] = useState<PublicReview[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; rated: number; avg: number | null }>({ total: 0, rated: 0, avg: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async (offset: number) => {
    setBusy(true); setErr('');
    try {
      const d = await publicReviews(12, offset, rating);
      setRows((prev) => (offset ? [...(prev ?? []), ...d.reviews] : d.reviews));
      setMeta({ total: d.total, rated: d.rated, avg: d.avg_rating });
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  }, [rating]);
  useEffect(() => { void load(0); }, [load]);
  useEffect(() => { track('public_reviews_viewed', { feature: 'home' }); }, []);

  return (
    <div className="page vc-page">
      <nav className="crumbs-lite"><Link to="/" className="icon-btn" aria-label="Back to home"><IcBack /></Link></nav>
      <header className="stack-sm">
        <h1>Student reviews</h1>
        <p className="muted">Real reviews from KAIRO students, published with their permission and checked for spam. We never write reviews ourselves.</p>
        {meta.rated > 0 && meta.avg != null && <p className="vc-avg"><Stars n={Math.round(meta.avg)} /> <b className="num">{meta.avg}</b> <span className="muted small">average from {meta.rated} review{meta.rated === 1 ? '' : 's'} with stars</span></p>}
      </header>
      <div className="chip-scroll" role="group" aria-label="Filter by rating">
        <button className="chip" aria-pressed={rating === null} onClick={() => setRating(null)}>All</button>
        {[5, 4, 3, 2, 1].map((n) => <button key={n} className="chip" aria-pressed={rating === n} onClick={() => setRating(n)}>{n} ★</button>)}
      </div>
      {err && <p className="muted">{err}</p>}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <section className="card stack-sm vc-empty">
          <b>{rating ? `No ${rating}-star reviews yet.` : 'No reviews yet.'}</b>
          <p className="muted small">Be one of the first students to share your experience.</p>
          <Link to="/feedback/review" className="btn btn-accent btn-sm">Write a review</Link>
        </section>
      ) : (
        <>
          <div className="vc-review-list">{rows.map((r) => <ReviewCard key={r.id} r={r} />)}</div>
          {rows.length < meta.total && <button className="btn btn-block" disabled={busy} onClick={() => load(rows.length)}>{busy ? 'Loading…' : 'Show more'}</button>}
          <Link to="/feedback/review" className="vc-link">Share your own experience →</Link>
        </>
      )}
    </div>
  );
}
