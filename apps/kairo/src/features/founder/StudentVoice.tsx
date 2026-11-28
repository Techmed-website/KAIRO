import { useState } from 'react';
import { cbt, friendlyError } from '../../lib/supabase';
import { toast } from '../../ui/components';
import { useFounder } from './Founder';
import { FEATURE_LABEL, fmtDateTime, num, pct, type Range } from './data';
import { ErrorCard, Kpi, LineChart, Loading } from './ui';
import { useLoad } from './useLoad';

// STUDENT VOICE: satisfaction, contextual feedback and testimonial moderation. Admin only (the server refuses others).
interface Overview {
  first_feedback_at: string | null;
  ratings: { count: number; avg: number | null; positive: number; neutral: number; negative: number; prompted: number; voluntary: number; dist: { stars: number; n: number }[] };
  response: { rating_shown: number; rating_answered: number; prompts: { prompt: string; shown: number; answered: number; dismissed: number }[] };
  submissions: number; written: number; helpful: { very: number; okay: number; not: number };
  reasons: { reason: string; n: number }[]; categories: { category: string; n: number }[]; features: { feature: string; n: number; not_helpful: number }[];
  themes: { theme: string; n: number; examples: string[] }[]; series: { day: string; submissions: number; ratings: number }[];
  testimonials: { pending: number; published: number; submitted_in_period: number; awaiting_student: number; public_avg_rating: number | null; public_rated: number };
}
interface FbRow {
  id: string; at: string; category: string; rating: number | null; helpful: string | null; reasons: string[]; body: string | null; feature: string | null;
  trigger: string; status: string; admin_note: string | null; has_attempt: boolean; student: string; consent: string;
}
interface TRow {
  id: string; body: string; rating: number | null; display_mode: string; display_name: string | null; public_name: string; consent: boolean; consent_at: string;
  consent_withdrawn_at: string | null; status: string; created_at: string; published_at: string | null; moderation_note: string | null;
  edited_body: string | null; edit_status: string; student: string; verified: boolean; history: { at: string; action: string; by_admin: boolean }[];
}
interface Settings { enabled: boolean; unsolicited_gap_days: number; rating_gap_days: number; practice_gap_days: number; testimonial_gap_days: number;
  practice_min_questions: number; rating_after_sessions: number; testimonial_after_days: number; updated_at: string }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await cbt().rpc(fn, args);
  if (error) throw error;
  return data as T;
}
const CAT: Record<string, string> = { overall: 'Overall rating', practice: 'Practice session', question_quality: 'Question quality', explanations: 'Explanations', technical: 'Technical issue', suggestion: 'Suggestion', general: 'Feature request / general' };
const TRIG: Record<string, string> = { practice_prompt: 'After practice', rating_prompt: 'Rating prompt', periodic_invite: 'Invitation', voluntary: 'Voluntary' };
const REASON: Record<string, string> = { unclear: 'Questions unclear', too_hard: 'Too difficult', too_easy: 'Too easy', weak_explanations: 'Explanations not enough', technical: 'Technical issue', other: 'Other',
  questions: 'Question quality', explanations: 'Explanations', speed: 'Speed / loading', design: 'Hard to use', subjects: 'Missing subjects/topics', content: 'Content' };
const PROMPT: Record<string, string> = { practice_helpful: '“Was this practice helpful?”', experience_rating: '“How is your KAIRO experience?”', testimonial_invite: 'Testimonial invitation' };
const HELP: Record<string, string> = { very: 'Very helpful', okay: 'Okay', not: 'Not really' };
const stars = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
const SMALL_SAMPLE = 20;

type Tab = 'overview' | 'feedback' | 'pending' | 'published' | 'settings';
export default function StudentVoice() {
  const [tab, setTab] = useState<Tab>('overview');
  const { range, refreshKey } = useFounder();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const openFeedback = (f: Record<string, string>) => { setFilters(f); setTab('feedback'); };
  return (
    <div className="stack">
      <div className="chip-scroll" role="tablist" aria-label="Student Voice sections">
        {([['overview', 'Overview'], ['feedback', 'All feedback'], ['pending', 'Pending testimonials'], ['published', 'Published testimonials'], ['settings', 'Prompt settings']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'chip-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <VoiceOverview range={range} refreshKey={refreshKey} onOpen={openFeedback} />}
      {tab === 'feedback' && <Explorer range={range} refreshKey={refreshKey} filters={filters} setFilters={setFilters} />}
      {tab === 'pending' && <Testimonials status="pending" refreshKey={refreshKey} />}
      {tab === 'published' && <Testimonials status="approved" refreshKey={refreshKey} />}
      {tab === 'settings' && <VoiceSettings />}
    </div>
  );
}

function VoiceOverview({ range, refreshKey, onOpen }: { range: Range; refreshKey: number; onOpen: (f: Record<string, string>) => void }) {
  const { data: d, error, reload } = useLoad(() => rpc<Overview>('fi_voice_overview', { p_from: range.from, p_to: range.to }), [range.from, range.to, refreshKey]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!d) return <div className="stack"><Loading h={160} /><Loading /></div>;
  const r = d.ratings;
  const rr = pct(d.response.rating_answered, d.response.rating_shown);
  const small = r.count > 0 && r.count < SMALL_SAMPLE;
  return (
    <div className="stack">
      {!d.first_feedback_at && <p className="fi-note">No feedback yet. Prompts started with this release; numbers appear as students respond.</p>}
      <div className="fi-kpis">
        <Kpi label="Average rating" value={r.avg != null ? `${r.avg} ★` : '—'} sub={`from ${num(r.count)} rating${r.count === 1 ? '' : 's'}`}
          def="Mean of overall-experience star ratings (1–5) submitted in the period, prompted and voluntary. Deleted records are excluded. Public-review stars are not included."
          state={small ? <p className="fi-note">Small sample: fewer than {SMALL_SAMPLE} ratings. Treat as indicative.</p> : undefined} />
        <Kpi label="Ratings received" value={num(r.count)} sub={`${num(r.prompted)} after a prompt · ${num(r.voluntary)} voluntary`} def="Overall-experience ratings in the period." />
        <Kpi label="Written feedback" value={num(d.written)} sub={`of ${num(d.submissions)} submissions`} def="Feedback records with written text (ratings, practice feedback, reports, suggestions)." />
        <Kpi label="Rating response rate" value={rr != null ? `${rr}%` : '—'} sub={`${num(d.response.rating_answered)} answered of ${num(d.response.rating_shown)} shown`}
          def="Students who answered the overall-rating prompt ÷ students the prompt was shown to, by the day it was shown. Each prompt is shown once (server-claimed), so repeats never inflate this." />
        <Kpi label="Positive (4–5★)" value={num(r.positive)} sub={pct(r.positive, r.count) != null ? `${pct(r.positive, r.count)}%` : undefined} def="Overall ratings of 4 or 5 stars." />
        <Kpi label="Neutral (3★)" value={num(r.neutral)} sub={pct(r.neutral, r.count) != null ? `${pct(r.neutral, r.count)}%` : undefined} def="Overall ratings of 3 stars." />
        <Kpi label="Negative (1–2★)" value={num(r.negative)} sub={pct(r.negative, r.count) != null ? `${pct(r.negative, r.count)}%` : undefined} def="Overall ratings of 1 or 2 stars." />
        <Kpi label="Pending testimonials" value={num(d.testimonials.pending)} sub={d.testimonials.awaiting_student ? `${d.testimonials.awaiting_student} waiting for the student to approve an edit` : 'right now'} def="Testimonials with consent waiting for moderation (all time, not filtered by date)." />
        <Kpi label="Published testimonials" value={num(d.testimonials.published)} sub={d.testimonials.public_avg_rating != null ? `public reviews average ${d.testimonials.public_avg_rating} ★ (${d.testimonials.public_rated} rated)` : 'right now'}
          def="Approved testimonials with active consent, visible on Student Reviews. Their star average is shown separately from general satisfaction because only students who chose to publish are included." />
      </div>

      <section className="card stack-sm">
        <h2>Rating distribution</h2>
        {r.count === 0 ? <p className="muted small">No ratings in this period.</p> : (
          <table className="fi-table"><thead><tr><th>Stars</th><th className="num">Ratings</th><th className="num">Share</th><th /></tr></thead>
            <tbody>{r.dist.map((x) => (
              <tr key={x.stars}><td>{stars(x.stars)}</td><td className="num"><button className="btn-link" onClick={() => onOpen({ rating: String(x.stars) })}>{num(x.n)}</button></td>
                <td className="num">{pct(x.n, r.count) ?? 0}%</td><td style={{ width: '45%' }}><span className="fi-bar" style={{ width: '100%' }}><span className="fi-bar-track"><span className="fi-bar-fill" style={{ width: `${pct(x.n, r.count) ?? 0}%` }} /></span></span></td></tr>
            ))}</tbody></table>
        )}
      </section>

      <section className="card stack-sm">
        <h2>Feedback over time</h2>
        <LineChart title="Feedback submissions and ratings per day" labels={d.series.map((s) => s.day)}
          series={[{ key: 's', label: 'All submissions', color: 'var(--primary)', values: d.series.map((s) => s.submissions) },
                   { key: 'r', label: 'Overall ratings', color: 'var(--gold-500)', values: d.series.map((s) => s.ratings) }]} />
      </section>

      <div className="fi-two">
        <section className="card stack-sm">
          <h2>After practice: “Was it helpful?”</h2>
          {d.helpful.very + d.helpful.okay + d.helpful.not === 0 ? <p className="muted small">No practice feedback in this period.</p> : (
            <ul className="fi-list">
              {(['very', 'okay', 'not'] as const).map((k) => <li key={k}><span>{HELP[k]}</span><button className="btn-link num" onClick={() => onOpen({ helpful: k })}>{num(d.helpful[k])}</button></li>)}
            </ul>
          )}
          {d.reasons.length > 0 && <><h3 className="small">Reasons given</h3><ul className="fi-list">{d.reasons.map((x) => <li key={x.reason}><span>{REASON[x.reason] ?? x.reason}</span><b className="num">{num(x.n)}</b></li>)}</ul></>}
        </section>
        <section className="card stack-sm">
          <h2>By category & feature</h2>
          <ul className="fi-list">{d.categories.map((c) => <li key={c.category}><span>{CAT[c.category] ?? c.category}</span><button className="btn-link num" onClick={() => onOpen({ category: c.category })}>{num(c.n)}</button></li>)}</ul>
          {d.features.length > 0 && <><h3 className="small">Feature</h3><ul className="fi-list">{d.features.map((f) => <li key={f.feature}><span>{FEATURE_LABEL[f.feature] ?? f.feature}</span><span className="num">{num(f.n)}{f.not_helpful ? ` · ${f.not_helpful} not helpful` : ''}</span></li>)}</ul></>}
        </section>
      </div>

      <section className="card stack-sm">
        <h2>Recurring themes in written feedback</h2>
        <p className="muted small">Transparent keyword matching on written feedback in this period (no AI, no sentiment scoring). A comment can match more than one theme. Open a theme to read the actual comments.</p>
        {d.themes.length === 0 ? <p className="muted small">No written feedback matched a theme yet.</p> : (
          <ul className="fi-list">{d.themes.map((t) => <li key={t.theme}><span>{t.theme}</span><span className="num">{num(t.n)} comment{t.n === 1 ? '' : 's'} · <button className="btn-link" onClick={() => onOpen({ written: '1', theme: t.theme, ids: t.examples.join(',') })}>read latest {t.examples.length}</button></span></li>)}</ul>
        )}
        {d.written > 0 && d.written < SMALL_SAMPLE && <p className="fi-note">Only {d.written} written comment{d.written === 1 ? '' : 's'} so far: themes are anecdotes, not trends.</p>}
      </section>

      <section className="card stack-sm">
        <h2>Prompt performance</h2>
        {d.response.prompts.length === 0 ? <p className="muted small">No prompts shown in this period.</p> : (
          <table className="fi-table"><thead><tr><th>Prompt</th><th className="num">Shown</th><th className="num">Answered</th><th className="num">Skipped</th><th className="num">Response</th></tr></thead>
            <tbody>{d.response.prompts.map((p) => <tr key={p.prompt}><td>{PROMPT[p.prompt] ?? p.prompt}</td><td className="num">{num(p.shown)}</td><td className="num">{num(p.answered)}</td><td className="num">{num(p.dismissed)}</td><td className="num">{pct(p.answered, p.shown) ?? 0}%</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}

function Explorer({ range, refreshKey, filters, setFilters }: { range: Range; refreshKey: number; filters: Record<string, string>; setFilters: (f: Record<string, string>) => void }) {
  const [limit, setLimit] = useState(50);
  const [who, setWho] = useState<Record<string, string>>({});
  const q = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && k !== 'theme'));
  const { data: d, error, reload } = useLoad(() => rpc<{ total: number; rows: FbRow[] }>('fi_voice_feedback', { p_from: range.from, p_to: range.to, p_filters: q, p_limit: limit, p_offset: 0 }),
    [range.from, range.to, refreshKey, JSON.stringify(q), limit]);
  const set = (k: string, v: string) => { const n = { ...filters, [k]: v }; if (!v) delete n[k]; delete n.ids; delete n.theme; setFilters(n); };
  const mark = async (id: string, status: string) => {
    const note = status === 'actioned' ? window.prompt('Internal note (optional): what was done?') ?? undefined : undefined;
    try { await rpc('fi_voice_set_feedback', { p_id: id, p_status: status, p_note: note ?? null }); reload(); } catch (e) { toast(friendlyError(e)); }
  };
  const identify = async (id: string) => {
    if (!window.confirm('Show this student\'s name and contact details? Only do this when you need to follow up. The lookup is logged.')) return;
    try { const r = await rpc<{ name: string; email: string; phone: string } | null>('fi_voice_identity', { p_kind: 'feedback', p_id: id });
      setWho({ ...who, [id]: r ? [r.name, r.email, r.phone].filter(Boolean).join(' · ') : 'Unknown' }); } catch (e) { toast(friendlyError(e)); }
  };
  const sel = (k: string, opts: Record<string, string>, label: string) => (
    <label className="field"><span className="small muted">{label}</span>
      <select className="input" value={filters[k] ?? ''} onChange={(e) => set(k, e.target.value)}><option value="">All</option>{Object.entries(opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  );
  return (
    <div className="stack">
      <section className="card fi-filters">
        {sel('rating', { 5: '5 ★', 4: '4 ★', 3: '3 ★', 2: '2 ★', 1: '1 ★' }, 'Rating')}
        {sel('category', CAT, 'Category')}
        {sel('feature', FEATURE_LABEL, 'Feature')}
        {sel('trigger', TRIG, 'Prompt type')}
        {sel('helpful', HELP, 'Practice answer')}
        {sel('status', { new: 'New', reviewed: 'Reviewed', actioned: 'Actioned', archived: 'Archived', deleted: 'Deleted' }, 'Review status')}
        {sel('written', { 1: 'With written text' }, 'Text')}
        {filters.theme && <p className="fi-note">Showing the latest comments for theme “{filters.theme}”. <button className="btn-link" onClick={() => setFilters({})}>Clear</button></p>}
      </section>
      {error ? <ErrorCard error={error} onRetry={reload} /> : !d ? <Loading /> : (
        <>
          <p className="muted small">{num(d.total)} record{d.total === 1 ? '' : 's'} in this period. Students are shown as a stable pseudonym (S-XXXXXX).</p>
          {d.rows.length === 0 && <p className="card muted">No feedback matches these filters.</p>}
          <div className="stack-sm">
            {d.rows.map((f) => (
              <article key={f.id} className="card stack-sm fi-voice-row">
                <div className="row-between wrap">
                  <b>{CAT[f.category] ?? f.category}{f.rating ? ` · ${stars(f.rating)}` : ''}{f.helpful ? ` · ${HELP[f.helpful]}` : ''}</b>
                  <span className="muted small">{fmtDateTime(f.at)}</span>
                </div>
                {f.reasons.length > 0 && <p className="small">{f.reasons.map((x) => REASON[x] ?? x).join(' · ')}</p>}
                {f.body ? <p className="fi-quote">{f.body}</p> : <p className="muted small">No written comment.</p>}
                <p className="muted small">{f.student} · {TRIG[f.trigger] ?? f.trigger}{f.feature ? ` · ${FEATURE_LABEL[f.feature] ?? f.feature}` : ''}{f.has_attempt ? ' · linked to a session' : ''} · publication consent: {f.consent} · status: <b>{f.status}</b>{f.admin_note ? ` · note: ${f.admin_note}` : ''}</p>
                {who[f.id] && <p className="small"><b>Contact:</b> {who[f.id]}</p>}
                <div className="row wrap">
                  {f.status !== 'reviewed' && <button className="btn btn-sm" onClick={() => mark(f.id, 'reviewed')}>Mark reviewed</button>}
                  {f.status !== 'actioned' && <button className="btn btn-sm" onClick={() => mark(f.id, 'actioned')}>Actioned…</button>}
                  {f.status !== 'archived' && <button className="btn btn-ghost btn-sm" onClick={() => mark(f.id, 'archived')}>Archive</button>}
                  {f.status !== 'deleted' && <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Delete this record from the reports? (Spam or test.)') && mark(f.id, 'deleted')}>Delete</button>}
                  {!who[f.id] && <button className="btn btn-ghost btn-sm" onClick={() => identify(f.id)}>Who is this?</button>}
                </div>
              </article>
            ))}
          </div>
          {d.rows.length < d.total && <button className="btn btn-block" onClick={() => setLimit(limit + 50)}>Show more</button>}
        </>
      )}
    </div>
  );
}

function Testimonials({ status, refreshKey }: { status: 'pending' | 'approved'; refreshKey: number }) {
  const { data: d, error, reload } = useLoad(() => rpc<{ total: number; rows: TRow[] }>('fi_voice_testimonials', { p_status: status, p_limit: 100 }), [status, refreshKey]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const act = async (id: string, action: string, opts: { note?: string | null; edited?: string } = {}) => {
    try { await rpc('fi_voice_moderate', { p_id: id, p_action: action, p_note: opts.note ?? null, p_edited: opts.edited ?? null }); toast('Saved'); setEditing(null); reload(); }
    catch (e) { toast(friendlyError(e)); }
  };
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!d) return <Loading />;
  return (
    <div className="stack">
      <p className="muted small">{status === 'pending'
        ? 'Every testimonial here was submitted with explicit publication consent. Approve only genuine, relevant reviews. Reject spam, abuse or anything off-topic. Never rewrite: suggest an edit and the student decides.'
        : 'Live on Student Reviews. Hiding takes a review down immediately; students can also withdraw at any time.'}</p>
      {d.rows.length === 0 && <p className="card muted">{status === 'pending' ? 'Nothing waiting for moderation.' : 'No published testimonials yet.'}</p>}
      {d.rows.map((t) => (
        <article key={t.id} className="card stack-sm">
          <div className="row-between wrap">
            <b>{t.public_name}{t.verified ? ' · ✓ practising student' : ''}</b>
            <span className="muted small">{t.student} · submitted {fmtDateTime(t.created_at)}{t.published_at ? ` · published ${fmtDateTime(t.published_at)}` : ''}</span>
          </div>
          {t.rating ? <span>{stars(t.rating)}</span> : <span className="muted small">No star rating</span>}
          <p className="fi-quote">{t.body}</p>
          {t.edited_body && <div className="fi-note"><b>Suggested edit ({t.edit_status.replace('_', ' ')}):</b> {t.edited_body}</div>}
          <p className="muted small">Name shown: {t.display_mode === 'anon' ? 'anonymous' : t.display_mode === 'first' ? 'first name only' : `chosen (“${t.display_name}”)`} ·
            consent: <b>{t.consent ? `given ${fmtDateTime(t.consent_at)}` : `withdrawn ${fmtDateTime(t.consent_withdrawn_at)}`}</b>{t.moderation_note ? ` · note: ${t.moderation_note}` : ''}</p>
          <details className="fi-def"><summary>Audit trail ({t.history.length})</summary>
            <ul className="small">{t.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.action.replace(/_/g, ' ')} · {h.by_admin ? 'admin' : 'student'}</li>)}</ul></details>
          {editing === t.id ? (
            <div className="stack-sm">
              <textarea className="input" rows={4} maxLength={600} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Suggested edited version" />
              <p className="muted small">The student will see this and must approve it. Until then the original wording stays, and the review cannot be published in the edited form.</p>
              <div className="row wrap"><button className="btn btn-accent btn-sm" onClick={() => act(t.id, 'suggest_edit', { edited: draft })}>Send to student</button><button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
            </div>
          ) : (
            <div className="row wrap">
              {status === 'pending' && <>
                <button className="btn btn-accent btn-sm" disabled={!t.consent || t.edit_status === 'awaiting_student'} onClick={() => act(t.id, 'approve')}>Approve & publish</button>
                <button className="btn btn-sm" onClick={() => act(t.id, 'reject', { note: window.prompt('Reason (internal, optional)') })}>Reject</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(t.id); setDraft(t.edited_body || t.body); }}>Suggest edit</button>
                {t.edit_status !== 'none' && <button className="btn btn-ghost btn-sm" onClick={() => act(t.id, 'clear_edit')}>Clear edit</button>}
              </>}
              {status === 'approved' && <button className="btn btn-sm" onClick={() => act(t.id, 'hide', { note: window.prompt('Why hide it? (internal, optional)') })}>Hide</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => { const n = window.prompt('Internal moderation note', t.moderation_note ?? ''); if (n !== null) act(t.id, 'note', { note: n }); }}>Note</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function VoiceSettings() {
  const { data: s, error, reload } = useLoad(() => rpc<Settings>('fi_voice_settings'), []);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!s) return <Loading />;
  const save = async (patch: Partial<Settings>) => {
    setBusy(true);
    try { await rpc('fi_voice_set_settings', { p: patch }); toast('Saved'); reload(); } catch (e) { toast(friendlyError(e)); }
    setBusy(false);
  };
  const field = (k: keyof Settings, label: string, min: number, max: number) => (
    <label className="field"><span className="small">{label}</span>
      <input className="input" type="number" min={min} max={max} defaultValue={Number(s[k])} disabled={busy}
        onBlur={(e) => { const v = Number(e.target.value); if (v !== s[k] && v >= min && v <= max) save({ [k]: v }); }} /></label>
  );
  return (
    <section className="card stack">
      <div className="row-between wrap"><div><h2>Prompt settings</h2><p className="muted small">Enforced by the server for every student and device. Last changed {fmtDateTime(s.updated_at)}.</p></div>
        <button className="btn btn-sm" disabled={busy} onClick={() => save({ enabled: !s.enabled })}>{s.enabled ? 'Pause all prompts' : 'Resume prompts'}</button></div>
      {!s.enabled && <p className="fi-note">Prompts are paused. The feedback centre and reviews still work.</p>}
      <div className="fi-filters">
        {field('unsolicited_gap_days', 'Max one prompt per student every (days)', 1, 90)}
        {field('rating_gap_days', 'Overall rating prompt at most every (days)', 7, 365)}
        {field('practice_gap_days', 'Practice prompt at most every (days)', 1, 365)}
        {field('testimonial_gap_days', 'Testimonial invitation at most every (days)', 7, 365)}
        {field('practice_min_questions', 'A session counts after (answered questions)', 1, 100)}
        {field('rating_after_sessions', 'Ask for a rating after (completed sessions)', 1, 50)}
        {field('testimonial_after_days', 'Invite a testimonial after (active days)', 1, 90)}
      </div>
      <p className="muted small">Prompts never appear in the exam runner or during a timed exam, never block navigation, and always have a Skip button. A prompt is shown at most once; skipping is remembered on every device.</p>
    </section>
  );
}
