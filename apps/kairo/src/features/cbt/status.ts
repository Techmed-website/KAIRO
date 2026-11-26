/** Where the student's answers are. 'saved' means the server confirmed them, never just the phone. */
export type SyncState = 'phone' | 'saving' | 'saved' | 'offline' | 'pending' | 'error';

export function syncText(s: SyncState, timed: boolean): { short: string; long: string } {
  switch (s) {
    case 'saving': return { short: 'Saving…', long: 'Saving your answers.' };
    case 'saved': return { short: 'Saved', long: 'Your answers are saved on this phone and on KAIRO.' };
    case 'offline': return { short: 'Offline', long: 'You are offline. Your answers are saved on this phone and will be sent when you are back online.' };
    case 'pending': return { short: 'Sync pending', long: 'Saved on this phone. KAIRO could not be reached yet; it will keep trying.' };
    case 'error': return { short: 'Not saved', long: 'This phone could not save your last answer. Free some storage, then answer again.' };
    default: return timed
      ? { short: 'On phone', long: 'Your answers are saved on this phone.' }
      : { short: 'Saved', long: 'Your answers are saved on this phone and sent when you submit.' };
  }
}

/** Timer colour: gold near the end, red at the very end. Scaled for short quizzes (a 5-minute quiz turns gold at 1 minute). */
export function timerLevel(remaining: number | null, limitSec: number | null): 'normal' | 'warn' | 'critical' {
  if (remaining == null) return 'normal';
  const limit = limitSec ?? 7200;
  if (remaining <= Math.min(60, limit * 0.1)) return 'critical';
  if (remaining <= Math.min(300, limit * 0.2)) return 'warn';
  return 'normal';
}
