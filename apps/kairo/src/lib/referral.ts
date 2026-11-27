// PROUDLY KAIRO: referral links, first-touch attribution and the student-side calls.
// The server decides everything that counts (cbt.claim_referral, activation from learning records, badges).
import { track } from './analytics';
import { deviceId } from './sync';
import { cbt } from './supabase';

const PENDING = 'kairo-ref';
const DONE = 'kairo-ref-done:';
const MAX_AGE = 30 * 864e5;

export interface RefBadgeInfo { code: string; title: string; description: string; goal: number; earned_at: string | null }
export interface MyReferrals {
  enabled: boolean; code: string | null; level: string | null; referred: boolean; can_enter_code: boolean;
  stats: { visits: number; unique_visitors: number; registrations: number; activated: number; retained: number; under_review: number };
  badges: RefBadgeInfo[];
  next: { code: string; title: string; goal: number; remaining: number } | null;
  celebrate: { code: string; title: string; goal: number }[];
  friends: { joined_at: string; activated: boolean; retained: boolean; under_review: boolean }[];
}
export interface BoardRow { rank: number; name: string; activated: number; retained: number; badge: string | null; is_me: boolean }
export interface RefBoard { period: 'all' | 'month'; participants: number; rows: BoardRow[]; me: Omit<BoardRow, 'name' | 'is_me'> | null }
export interface RefMonth { month: string; top_ambassador: { name: string; value: number } | null; most_signups: { name: string; value: number } | null;
  best_retention: { name: string; value: number; activated: number } | null }

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
const clean = (c: string | null | undefined) => (c ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** The student's own link, built from wherever KAIRO is running (never hard-coded). */
export const referralUrl = (code: string) => `${location.origin}/r/${encodeURIComponent(code)}`;

/** First touch: the first valid code seen on this phone in the last 30 days is kept; later codes do not replace it. */
export function pendingCode(): string | null {
  const p = safe(() => JSON.parse(localStorage.getItem(PENDING) || 'null') as { code: string; at: number } | null, null);
  return p && Date.now() - p.at < MAX_AGE ? p.code : null;
}
function remember(code: string) {
  if (pendingCode()) return;
  safe(() => localStorage.setItem(PENDING, JSON.stringify({ code, at: Date.now() })), undefined);
}
const forget = () => safe(() => localStorage.removeItem(PENDING), undefined);

/** A referral link was opened (/r/:code or any page with ?ref=). Records the visit on the server and keeps the code. */
export async function captureReferral(raw: string): Promise<{ valid: boolean; referrer_first_name?: string | null; enabled?: boolean }> {
  const code = clean(raw);
  if (code.length < 4) return { valid: false };
  try {
    const { data } = await cbt().rpc('referral_visit', { p_code: code, p_anon: deviceId() });
    const r = (data ?? { valid: false }) as { valid: boolean; referrer_first_name?: string | null; enabled?: boolean };
    if (r.valid) remember(code);
    return r;
  } catch {
    remember(code);            // offline: keep it, the server checks it at sign-up anyway
    return { valid: true };
  }
}

/** Sign-up metadata: carries the code so attribution survives an email confirmation opened on another device. */
export const signupMeta = (): Record<string, string> => { const c = pendingCode(); return c ? { ref_code: c } : {}; };

const TERMINAL = new Set(['recorded', 'under_review', 'already_referred', 'self_referral', 'existing_account', 'invalid_code', 'circular', 'not_eligible']);
/**
 * After a real sign-in: ask the server to record the referral (it applies every rule). Only called while it can matter:
 * a code is waiting on this phone, or the account is under 7 days old (the code may be in its sign-up metadata).
 */
export async function claimPendingReferral(userId: string, createdAt?: string, manual?: string): Promise<string | null> {
  const code = manual ? clean(manual) : pendingCode();
  const young = !!createdAt && Date.now() - Date.parse(createdAt) < 7 * 864e5;
  if (!manual && !code && !young) return null;
  if (!manual && safe(() => localStorage.getItem(DONE + userId), null)) return null;
  try {
    const { data, error } = await cbt().rpc('claim_referral', { p_code: code, p_anon: deviceId(), p_source: manual ? 'code' : 'link' });
    if (error) return null;
    const status = (data as { status: string }).status;
    if (TERMINAL.has(status)) { safe(() => localStorage.setItem(DONE + userId, status), undefined); forget(); }
    return status;
  } catch { return null; }
}

export async function loadMyReferrals(): Promise<MyReferrals | null> {
  const { data, error } = await cbt().rpc('my_referrals');
  if (error) throw error;
  return data as MyReferrals | null;
}
export async function loadRefBoard(period: 'all' | 'month', limit = 50, offset = 0): Promise<RefBoard> {
  const { data, error } = await cbt().rpc('referral_board', { p_period: period, p_limit: limit, p_offset: offset });
  if (error) throw error;
  return data as RefBoard;
}
export async function loadRefMonth(): Promise<RefMonth> {
  const { data, error } = await cbt().rpc('referral_month');
  if (error) throw error;
  return data as RefMonth;
}
export async function pendingCelebrations(): Promise<{ code: string; title: string; goal: number; activated: number }[]> {
  const { data, error } = await cbt().rpc('referral_celebrations');
  if (error) return [];
  return (data ?? []) as { code: string; title: string; goal: number; activated: number }[];
}
export const markCelebrated = (codes: string[]) => cbt().rpc('referral_celebrated', { p_codes: codes }).then(() => undefined, () => undefined);

// ───────────────────────── sharing ─────────────────────────
export const shareText = (link: string) =>
  `I'm using KAIRO to practise and improve my UTME 2027 exam preparation. You should try it too!\n\nJoin me on KAIRO: ${link}\n\nSEIZE THE MOMENT.`;

export async function copy(text: string, what: 'code' | 'link'): Promise<boolean> {
  track('share_clicked', { props: { source: `copy_${what}` } });
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = safe(() => document.execCommand('copy'), false); ta.remove(); return ok;
  }
}
export function shareWhatsApp(link: string) {
  track('share_clicked', { props: { source: 'whatsapp' } });
  window.open(`https://wa.me/?text=${encodeURIComponent(shareText(link))}`, '_blank', 'noopener');
}
export async function shareNative(link: string): Promise<boolean> {
  track('share_clicked', { props: { source: 'native' } });
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (!nav.share) return false;
  try { await nav.share({ title: 'Join me on KAIRO', text: shareText(link).replace(link, '').trim(), url: link }); return true; }
  catch { return true; }   // cancelled is fine
}
export const canNativeShare = () => typeof navigator !== 'undefined' && 'share' in navigator;
