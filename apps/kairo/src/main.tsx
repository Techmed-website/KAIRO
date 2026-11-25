import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './ui/base.css';
import './lib/install';
import { App } from './app/App';
import { AuthProvider } from './lib/auth';
import { startSyncLoop } from './lib/sync';

// After a new deploy, a phone still running the old version can ask for page files that no longer exist, leaving a
// blank or stuck screen until the student reopens the link. Reload once to pick up the new version instead.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  let last = 0;
  try { last = Number(sessionStorage.getItem('kairo-reloaded-at') || 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return; // already tried just now: do not loop
  try { sessionStorage.setItem('kairo-reloaded-at', String(Date.now())); } catch { /* storage blocked */ }
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
startSyncLoop();
if (import.meta.env.PROD) import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
