# KAIRO app (apps/kairo)

TECHMED's JAMB CBT practice PWA. React + Vite + TypeScript, Supabase (`cbt` schema), Dexie, Workbox.
The brief is `docs/rebuild/HANDOVER-APP-BUILD.md`.

```bash
npm install
npm run dev          # http://localhost:5173 (needs .env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
npm test             # unit tests: scoring /100 and /400, explanation parsing, sanitizing, calculator, outbox
npx vite --port 5199 & npm run e2e   # 360×740 Playwright run against a mocked Supabase
npm run build        # dist/ (initial JS budget: < 150 KB gzipped)
npm run deploy       # Cloudflare Workers static assets (wrangler.jsonc)
```

Layout: `src/app` (routes, shell) · `src/features/*` (screens) · `src/lib` (supabase, db, sync, sanitize, render,
scoring) · `src/ui` (tokens.css, base.css, components). `design-preview.html` is the standalone design mock.

Supabase setup the app needs: `cbt` under Settings → API → Exposed schemas; the app's URLs under
Authentication → URL Configuration → Redirect URLs (for Google sign-in and email links).
