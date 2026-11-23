import { cbt, supabase } from './supabase';

/**
 * A guest (anonymous session from a shared quiz link) keeps everything by turning the same user into a real account:
 * Supabase keeps the user id, so their finished attempts stay theirs, and claim_guest_rank puts the first one on the
 * leaderboard. Returns 'confirm' when Supabase still wants the email confirmed first.
 */
export async function saveGuestAccount(name: string, email: string, password: string): Promise<'saved' | 'confirm'> {
  const clean = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.updateUser({ email: clean, data: { full_name: name.trim() } });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw new Error('That email already has a TECHMED account. Sign in with it instead.');
    throw error;
  }
  if ((data.user?.email ?? '').toLowerCase() !== clean) return 'confirm';
  const { error: e2 } = await supabase.auth.updateUser({ password });
  if (e2) throw e2;
  await supabase.auth.refreshSession();          // new token says is_anonymous = false
  if (data.user) await cbt().from('profiles').update({ full_name: name.trim() }).eq('id', data.user.id);
  return 'saved';
}

/** Link Google to the guest session (same user id). Needs "manual linking" switched on in Supabase Auth. */
export async function linkGoogle(returnTo: string) {
  const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: `${location.origin}${returnTo}` } });
  if (error) throw error;
}

/** Put a finished guest attempt on the leaderboard once the student has an account. Safe to call any number of times. */
export async function claimRank(attemptId: string) {
  await cbt().rpc('claim_guest_rank', { p_attempt: attemptId });
}
