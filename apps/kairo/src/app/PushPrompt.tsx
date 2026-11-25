import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { enablePush, promptSnoozed, pushPermission, snoozePrompt } from '../lib/push';
import { toast } from '../ui/components';

/** A calm, optional invitation (never a browser pop-up on its own): shown after a quiz and on Home until answered. */
export function PushPrompt({ where }: { where: 'home' | 'result' }) {
  const { session } = useAuth();
  const [hidden, setHidden] = useState(() => pushPermission() !== 'default' || promptSnoozed());
  const [busy, setBusy] = useState(false);
  if (hidden) return null;
  const on = async () => {
    setBusy(true);
    try {
      const ok = await enablePush(session?.user.id);
      toast(ok ? 'Done. Your Morning Charge arrives at 6:00am.' : 'Notifications are blocked. You can allow them in your browser settings.');
      setHidden(true);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not turn on notifications.'); setBusy(false); }
  };
  return (
    <section className="card push-prompt" aria-label="Daily reminders">
      <p className="push-h">🔔 {where === 'result' ? 'Want tomorrow’s quiz at 6:00am?' : 'Your Morning Charge at 6:00am'}</p>
      <p className="muted small">A short daily quote and the new Daily Builder Quiz each morning, and a gentle reminder in the evening if you haven’t practised. Turn it off any time.</p>
      <div className="row">
        <button className="btn btn-accent grow" onClick={on} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
        <button className="btn btn-ghost" onClick={() => { snoozePrompt(7); setHidden(true); }}>Not now</button>
      </div>
    </section>
  );
}
