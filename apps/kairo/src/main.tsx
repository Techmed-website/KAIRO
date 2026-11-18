import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './ui/base.css';
import './lib/install';
import { App } from './app/App';
import { AuthProvider } from './lib/auth';
import { startSyncLoop } from './lib/sync';

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
