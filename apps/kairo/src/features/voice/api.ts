// KAIRO Student Voice: calls to the cbt.voice_* RPCs. Every submission carries an id made on the phone, so a retry
// after a dropped connection is recognised by the server and never saved twice. If the network fails, the submission
// waits in a small outbox (this phone only) and is sent when the connection comes back.
import { cbt } from '../../lib/supabase';
import { track } from '../../lib/analytics';

export type Category = 'overall' | 'practice' | 'question_quality' | 'explanations' | 'technical' | 'suggestion' | 'general';
export type Trigger = 'practice_prompt' | 'rating_prompt' | 'periodic_invite' | 'voluntary';
export type PromptType = 'practice_helpful' | 'experience_rating' | 'testimonial_invite';
export interface Prompt { prompt: PromptType; context: string | null; feature: string | null }

export interface FeedbackInput {
  category: Category; rating?: number; helpful?: 'very' | 'okay' | 'not'; reasons?: string[]; body?: string;
  feature?: string; attempt_id?: string; trigger: Trigger; prompt?: PromptType;
}
export interface TestimonialInput { body: string; rating?: number; display_mode: 'chosen' | 'first' | 'anon'; display_name?: string; consent: boolean }
export interface MyTestimonial {
  id: string; body: string; rating: number | null; display_mode: 'chosen' | 'first' | 'anon'; display_name: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'hidden' | 'withdrawn'; created_at: string; published_at: string | null;
  consent_withdrawn_at: string | null; edited_body: string | null; edit_status: 'none' | 'awaiting_student' | 'accepted' | 'declined';
}
export interface MyFeedback { id: string; category: Category; rating: number | null; helpful: string | null; body: string | null; created_at: string; status: string }
export interface PublicReview { id: string; body: string; rating: number | null; name: string; published_at: string; verified: boolean }
export interface PublicReviews { total: number; rated: number; avg_rating: number | null; reviews: PublicReview[] }

const OUTBOX = 'kairo-voice-outbox';
type Pending = { kind: 'feedback' | 'testimonial'; payload: Record<string, unknown>; at: number };

const uuid = () => { try { return crypto.randomUUID(); } catch { return `${Date.now().toString(16).padStart(8, '0').slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`; } };
const readBox = (): Pending[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]') as Pending[]; } catch { return []; } };
const writeBox = (b: Pending[]) => { try { localStorage.setItem(OUTBOX, JSON.stringify(b.slice(-20))); } catch { /* storage full or blocked */ } };

/** A server answer (validation, permission) vs. a dropped connection. Only the second is worth retrying. */
export function isNetworkError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code && /^([0-9A-Z]{5}|PGRST\d+)$/.test(err.code)) return false;
  return /fetch|network|timeout|load failed|offline|aborted/i.test(err.message || '') || !err.code;
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await cbt().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function send(kind: Pending['kind'], payload: Record<string, unknown>) {
  return call<{ ok: boolean; id: string; duplicate?: boolean }>(kind === 'feedback' ? 'voice_submit_feedback' : 'voice_submit_testimonial', { p: payload });
}

/** Saves feedback. Resolves 'sent' or 'queued' (no connection: it will go later). Throws only for a real server refusal. */
export async function submitFeedback(input: FeedbackInput): Promise<{ status: 'sent' | 'queued'; id: string }> {
  const payload = { id: uuid(), ...input };
  return submitPayload('feedback', payload);
}
export async function submitTestimonial(input: TestimonialInput): Promise<{ status: 'sent' | 'queued'; id: string }> {
  if (!input.consent) throw new Error('Tick the consent box to let KAIRO show your review publicly.');
  return submitPayload('testimonial', { id: uuid(), ...input });
}
async function submitPayload(kind: Pending['kind'], payload: Record<string, unknown>): Promise<{ status: 'sent' | 'queued'; id: string }> {
  for (let i = 0; i < 2; i++) {
    try { await send(kind, payload); return { status: 'sent', id: String(payload.id) }; }
    catch (e) {
      if (!isNetworkError(e)) throw e;
      if (i === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  writeBox([...readBox(), { kind, payload, at: Date.now() }]);
  return { status: 'queued', id: String(payload.id) };
}

let flushing = false;
/** Sends anything left in the outbox (on app start, and when the phone comes back online). */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const box = readBox().filter((p) => Date.now() - p.at < 7 * 864e5);
    const keep: Pending[] = [];
    for (const p of box) {
      try { await send(p.kind, p.payload); sent++; }
      catch (e) { if (isNetworkError(e)) keep.push(p); /* refused by the server: drop it */ }
    }
    writeBox(keep);
  } finally { flushing = false; }
  return sent;
}
export const outboxSize = () => readBox().length;
if (typeof window !== 'undefined') window.addEventListener('online', () => { void flushOutbox(); });

// ───────────────────────── prompts ─────────────────────────
const asked = new Set<string>();
/** Asks the server once per screen visit whether to show a prompt. The server claims it, so it is never shown twice. */
export async function askPrompt(where: 'home' | 'result', attemptId?: string): Promise<Prompt | null> {
  const key = `${where}:${attemptId ?? ''}`;
  if (asked.has(key)) return null;
  asked.add(key);
  try {
    const p = await call<Prompt | null>('voice_prompt', { p_where: where, p_attempt: attemptId ?? null });
    if (p) track('feedback_prompt_shown', { props: { source: p.prompt } });
    return p;
  } catch { return null; }
}
export function dismissPrompt(p: Prompt) {
  void cbt().rpc('voice_prompt_dismiss', { p_prompt: p.prompt, p_context: p.context });
}

export const addDetail = (id: string, reasons: string[], body: string) => call<{ ok: boolean }>('voice_add_detail', { p_id: id, p_reasons: reasons, p_body: body || null });
export const myVoice = () => call<{ testimonials: MyTestimonial[]; feedback: MyFeedback[] } | null>('my_voice', {});
export const withdrawTestimonial = (id: string) => call<{ ok: boolean }>('voice_withdraw_testimonial', { p_id: id });
export const deleteTestimonial = (id: string) => call<{ ok: boolean }>('voice_delete_testimonial', { p_id: id });
export const answerEdit = (id: string, accept: boolean) => call<{ ok: boolean }>('voice_answer_edit', { p_id: id, p_accept: accept });
export const publicReviews = (limit = 12, offset = 0, rating: number | null = null) =>
  call<PublicReviews>('public_reviews', { p_limit: limit, p_offset: offset, p_rating: rating });

export const REASONS_PRACTICE: { key: string; label: string }[] = [
  { key: 'unclear', label: 'Questions were unclear' }, { key: 'too_hard', label: 'Too difficult' }, { key: 'too_easy', label: 'Too easy' },
  { key: 'weak_explanations', label: 'Explanations were not enough' }, { key: 'technical', label: 'Technical issue' }, { key: 'other', label: 'Other' },
];
export const REASONS_IMPROVE: { key: string; label: string }[] = [
  { key: 'questions', label: 'Question quality' }, { key: 'explanations', label: 'Explanations' }, { key: 'speed', label: 'Speed / loading' },
  { key: 'design', label: 'Hard to use' }, { key: 'subjects', label: 'Missing subjects or topics' }, { key: 'other', label: 'Something else' },
];
