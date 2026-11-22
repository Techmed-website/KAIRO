/** A daily-quiz link (/q/<id>) opened while signed out is remembered, so sign-in or first-run setup lands on it. */
const KEY = 'kairo-return-to';
export function rememberReturn(path: string) {
  if (!path.startsWith('/q/')) return;
  try { localStorage.setItem(KEY, path); } catch { /* private mode */ }
}
export function takeReturn(): string | null {
  try { const p = localStorage.getItem(KEY); if (p) localStorage.removeItem(KEY); return p; } catch { return null; }
}
