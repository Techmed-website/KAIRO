import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { loadMyReferrals, type MyReferrals } from '../../lib/referral';
import { RefCard } from './RefPrompts';

/** Compact Proudly KAIRO prompt with live progress (Home and Profile). Hidden for guests, offline or while paused. */
export function HomeRefCard() {
  const { session } = useAuth();
  const [d, setD] = useState<MyReferrals | null>(null);
  const student = !!session && !session.user.is_anonymous;
  useEffect(() => { if (student) loadMyReferrals().then(setD).catch(() => setD(null)); }, [student]);
  if (!student || !d || !d.enabled) return null;
  return <RefCard level={d.level} activated={d.stats.activated} nextTitle={d.next?.title} remaining={d.next?.remaining} />;
}
