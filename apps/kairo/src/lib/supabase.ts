import { createClient } from '@supabase/supabase-js';
import { sharedSessionStorage, watchSharedSession } from './sharedSession';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(url, key, {
  // Session lives in a .techmedng.com cookie so the website and KAIRO share one login (see sharedSession.ts).
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storage: sharedSessionStorage },
});
watchSharedSession(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`);
export const cbt = () => supabase.schema('cbt');

/** Turn a Postgres/PostgREST error into a sentence a student can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const msg = err?.message ?? String(e);
  if (!navigator.onLine || /fetch|network/i.test(msg)) return 'You seem to be offline. Check your data and try again.';
  if (err?.code === '54000') return 'You have started a lot of sessions this hour. Take a short break and try again.';
  if (err?.code === 'P0002' && /no questions/.test(msg)) return 'No questions match those choices yet. Try a wider range.';
  if (err?.code === 'PGRST106') return 'KAIRO is being set up. Please try again in a few minutes.';
  if (/JWT|not signed in/i.test(msg)) return 'Please sign in again.';
  return msg;
}
