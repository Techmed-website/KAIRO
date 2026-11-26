/**
 * KAIRO practice notifications through OneSignal (app "Kairo"). The SDK only loads once a student opts in, so it costs
 * nothing for anyone else. Its service worker lives under /push/ so it never clashes with KAIRO's offline worker at /.
 * The OneSignal external id is the Supabase user id, so the server can remind exactly the students who haven't practised.
 *
 * serviceWorkerOverrideForTypical: the OneSignal app uses "Typical Site" setup, which otherwise ignores serviceWorkerPath and
 * registers /OneSignalSDKWorker.js at the root. That file does not exist there (the server answers with the app's HTML), so
 * every opt-in failed with "unsupported MIME type ('text/html')". Verified on kairo.techmedng.com, 26 Nov 2026.
 */
const APP_ID = '5983fe20-b980-4991-ab88-9bb3a1994bd2';

interface OneSignalT {
  init(o: Record<string, unknown>): Promise<void>;
  login(id: string): Promise<void>;
  Notifications: { permission: boolean; requestPermission(): Promise<void> };
  User: { PushSubscription: { optedIn?: boolean; optIn(): Promise<void>; optOut(): Promise<void> } };
}
declare global { interface Window { OneSignalDeferred?: ((os: OneSignalT) => void)[] } }

let ready: Promise<OneSignalT> | null = null;
function load(): Promise<OneSignalT> {
  ready ??= new Promise<OneSignalT>((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (os) => {
      try {
        await os.init({ appId: APP_ID, serviceWorkerPath: 'push/OneSignalSDKWorker.js', serviceWorkerParam: { scope: '/push/' }, serviceWorkerOverrideForTypical: true,
                        notifyButton: { enable: false }, allowLocalhostAsSecureOrigin: true });
        resolve(os);
      } catch (e) { reject(e); }
    });
    const s = document.createElement('script');
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    s.defer = true;
    s.onerror = () => { ready = null; reject(new Error('Could not load notifications. Check your connection.')); };
    document.head.appendChild(s);
  });
  return ready;
}

export const pushSupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
export const pushPermission = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported');

/** Ask the browser for permission (after the student tapped "Turn on") and link this phone to the student. */
export async function enablePush(userId?: string): Promise<boolean> {
  let os: OneSignalT;
  try { os = await load(); } catch { throw new Error('Could not reach the notification service. Check your connection and try again.'); }
  if (Notification.permission !== 'granted') await os.Notifications.requestPermission();
  if (Notification.permission !== 'granted') return false;
  try {
    await os.User.PushSubscription.optIn();
    if (userId) await os.login(userId);
    try { localStorage.removeItem(OPTED_OUT); } catch { /* ignore */ }
  } catch {
    throw new Error('Notifications could not be set up on this browser. Try again, or open KAIRO in Chrome.');
  }
  return true;
}

/** On app start: a student who already allowed notifications is linked again (new phone, new sign-in). */
export async function syncPushUser(userId: string) {
  if (pushPermission() !== 'granted') return;
  try {
    const os = await load();
    // Students who allowed notifications while opt-in was broken have permission but no subscription: finish it now.
    if (os.User.PushSubscription.optedIn === false && localStorage.getItem(OPTED_OUT) !== '1') await os.User.PushSubscription.optIn();
    await os.login(userId);
  } catch { /* offline: next time */ }
}

const OPTED_OUT = 'push-opted-out';
export async function disablePush() {
  const os = await load();
  await os.User.PushSubscription.optOut();
  try { localStorage.setItem(OPTED_OUT, '1'); } catch { /* ignore */ }
}
/** Shown the invitation? Only students who could get notifications but are not subscribed yet (and did not turn them off). */
export async function needsPushPrompt(): Promise<boolean> {
  const p = pushPermission();
  if (p === 'default') return true;
  if (p !== 'granted') return false;
  try { if (localStorage.getItem(OPTED_OUT) === '1') return false; } catch { /* ignore */ }
  return !(await pushOptedIn());
}

export async function pushOptedIn(): Promise<boolean> {
  if (pushPermission() !== 'granted') return false;
  try { const os = await load(); return os.User.PushSubscription.optedIn === true; } catch { return false; }
}

const SNOOZE = 'push-prompt-snooze';
export const promptSnoozed = () => { try { return Number(localStorage.getItem(SNOOZE) || 0) > Date.now(); } catch { return false; } };
export const snoozePrompt = (days = 7) => { try { localStorage.setItem(SNOOZE, String(Date.now() + days * 86_400_000)); } catch { /* ignore */ } };
