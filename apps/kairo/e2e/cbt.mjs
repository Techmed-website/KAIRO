// Timed exam run (360×740, then 1280×800) against a mocked Supabase: honest save states through a server error and
// an offline spell, the timer surviving a reload, a four-subject mock with subject tabs, and auto-submit at zero.
// Usage: start `npx vite --port 5199` in apps/kairo, then `node e2e/cbt.mjs [outdir]`.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:5199';
const OUT = process.argv[2] || 'e2e/out';
mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const UID = '00000000-0000-0000-0000-0000000000aa';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 's@example.com', user_metadata: {}, app_metadata: { provider: 'email' } };
const session = { access_token: 't', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user };
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const AID = 'b0000000-0000-0000-0000-000000000001';
const LIMIT = 7200, DEADLINE = new Date(Date.now() + 40_000).toISOString(); // 40 s left of a 2-hour mock: red, then auto-submit
let saveMode = 'fail'; const saves = [], submits = [];
const questions = fx.questions.map(({ correct_option, explanation_html, ...q }) => q); // a mock never sends keys before submit

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
await ctx.addInitScript(([s]) => { localStorage.setItem('sb-unbgborbhxzsotaieiun-auth-token', JSON.stringify(s)); }, [session]);
await ctx.route('https://kxoz58eb.apicdn.sanity.io/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"result":null}' }));
await ctx.route('https://unbgborbhxzsotaieiun.supabase.co/**', async (route) => {
  const req = route.request(), p = new URL(req.url()).pathname;
  const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.startsWith('/auth/v1/user')) return json(user);
  if (p.endsWith('/rpc/ensure_profile')) return json({ id: UID, full_name: 'Ada Obi', email: user.email, exam_year: 2027, subjects: [1, 2, 3, 4], track: 'engineering' });
  if (p.endsWith('/subjects')) return json([{ id: 1, code: 'ENG' }, { id: 2, code: 'MTH' }, { id: 3, code: 'PHY' }, { id: 4, code: 'CHM' }, { id: 5, code: 'BIO' }]);
  if (p.endsWith('/rpc/create_practice')) return json({ assessment_id: AID, question_count: questions.length, time_limit_sec: LIMIT, title: 'JAMB mock' });
  if (p.endsWith('/rpc/get_paper')) return json({ assessment: { id: AID, type: 'mock', title: 'JAMB mock', time_limit_sec: LIMIT, answers_visibility: 'after_submit', ranked: true }, questions });
  if (p.endsWith('/rpc/start_attempt')) { const b = req.postDataJSON(); return json({ attempt: { id: b.p_attempt, started_at: new Date(Date.now() - (LIMIT * 1000 - 40_000)).toISOString(), deadline_at: DEADLINE, shuffle_seed: null }, resumed: false, server_now: new Date().toISOString() }); }
  if (p.endsWith('/rpc/save_answers')) { saves.push(req.postDataJSON()); return saveMode === 'fail' ? json({ message: 'server busy' }, 503) : json(null); }
  if (p.endsWith('/rpc/submit_attempt')) { submits.push(req.postDataJSON().p); return json({ status: 'final', score: 3, total: questions.length, already_received: false, reject_reason: null }); }
  if (p.includes('/rpc/')) return json(null);
  return json([]);
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const sync = () => page.locator('.xsync').innerText();

await page.goto(BASE + '/practice');
await page.getByRole('link', { name: /Start full mock/ }).click();
await page.getByRole('heading', { name: 'Full JAMB mock' }).waitFor();
await page.getByRole('button', { name: /^Start/ }).last().click();
await page.waitForURL(/\/cbt\//);
await page.locator('.opt').first().waitFor();
check(await page.locator('.xh-tabs [role=tab]').count() === 4, 'mock: four subject tabs, read from the paper');
check((await page.locator('.timer').getAttribute('class')).includes('t-critical'), 'timer: red in the last minute of a 2-hour paper');
check(await page.locator('.verdict, .tutor, .opt.is-correct').count() === 0, 'mock: no answer or explanation shown during the exam');

await page.locator('.opt').nth(1).click();
check((await sync()) === 'Saving…', 'save: Saving… right after an answer');
await page.waitForTimeout(2200);
check((await sync()) === 'Sync pending' && saves.length >= 1, 'save: server refused → Sync pending, never Saved');
saveMode = 'ok';
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(800);
check((await sync()) === 'Saved', 'save: retried when back online → Saved (server confirmed)');
await page.screenshot({ path: `${OUT}/c1-mobile-timed.png` });

await ctx.setOffline(true);
await page.locator('.opt').nth(2).click();
check((await sync()) === 'Offline', 'save: offline → Offline (answer kept on the phone)');
check((await page.locator('.opt[aria-checked="true"] .opt-k').innerText()) === 'C', 'changing the answer moves the selection');
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(800);
check((await sync()) === 'Saved' && saves.at(-1).p_answers.some((a) => a.selected === 'C'), 'save: offline change sent when the network returns');

const t1 = await page.locator('.timer').innerText();
await page.reload();
await page.locator('.opt').first().waitFor();
const t2 = await page.locator('.timer').innerText();
const secs = (t) => { const m = t.match(/(\d+):(\d+)(?::(\d+))?/); return m ? (m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2])) : -1; };
check(secs(t2) <= secs(t1) && secs(t2) > 0, `timer: not reset by a reload (${t1.replace(/\s+/g, ' ')} → ${t2.replace(/\s+/g, ' ')})`);
check((await page.locator('.opt[aria-checked="true"] .opt-k').innerText()) === 'C', 'reload: the chosen answer is still there');

await page.getByRole('tab', { name: /Chemistry/ }).click();
check((await page.locator('.qsrc').innerText()).toUpperCase().includes('CHEMISTRY'), 'subject tab jumps to that subject');

// Desktop: navigator beside the question
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(300);
check(await page.locator('.cbt-side').isVisible() && await page.locator('.cbt-side .pal').count() >= 1, 'desktop: navigator panel stays open beside the question');
await page.screenshot({ path: `${OUT}/c2-desktop.png` });

// Time runs out: submitted automatically, once, with the answers kept.
await page.waitForURL(/\/result\//, { timeout: 60_000 });
await page.waitForTimeout(1500);
check(submits.length === 1 && submits[0].answers.some((a) => a.selected === 'C'), 'time up: submitted automatically, once, with the answers');
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL CBT CHECKS PASSED');
process.exit(failures ? 1 : 0);
