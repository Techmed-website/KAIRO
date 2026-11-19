export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'kairo-theme';

export function getTheme(): ThemePref {
  try { return (localStorage.getItem(KEY) as ThemePref) || 'system'; } catch { return 'system'; }
}
export function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function applyTheme(t: ThemePref) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#07121d' : '#011236');
  window.dispatchEvent(new Event('kairo-theme'));
}
export const toggleTheme = () => applyTheme(isDark() ? 'light' : 'dark');
