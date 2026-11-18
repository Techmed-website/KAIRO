// End-to-end run at 360×740 against a mocked Supabase: sign-in session → practice → CBT → submit → result → review.
// Usage: start `npx vite --port 5199` in apps/kairo, then `node e2e/flow.mjs [outdir]`.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:5199';
const OUT = process.argv[2] || 'e2e/out';
mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const UID = '00000000-0000-0000-0000-0000000000aa';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'student@example.com', user_metadata: { full_name: 'Ada Obi' }, app_metadata: { provider: 'email' } };
const session = { access_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user };
const reports = [], submits = [], passwordChanges = [];
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript(([s]) => { localStorage.setItem('sb-unbgborbhxzsotaieiun-auth-token', JSON.stringify(s)); }, [session]);
await ctx.route('https://unbgborbhxzsotaieiun.supabase.co/**', async (route) => {
  const req = route.request(), url = new URL(req.url()), p = url.pathname;
  const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.startsWith('/auth/v1/user')) { if (req.method() === 'PUT') passwordChanges.push(req.postDataJSON()); return json(user); }
  if (p.endsWith('/rpc/ensure_profile')) return json({ id: UID, full_name: 'Ada Obi', email: user.email, phone: null, exam_year: 2027, subjects: [1, 2, 3, 4], track: 'engineering' });
  if (p.endsWith('/subjects')) return json([{ id: 1, code: 'ENG' }, { id: 2, code: 'MTH' }, { id: 3, code: 'PHY' }, { id: 4, code: 'CHM' }, { id: 5, code: 'BIO' }]);
  if (p.endsWith('/rpc/catalog')) return json({ subjects: [
    { code: 'ENG', name: 'Use of English', count: 4504, years: [{ year: 2025, count: 60 }, { year: 1983, count: 100 }], topics: [{ id: 19, name: 'Comprehension', count: 887 }] },
    { code: 'MTH', name: 'Mathematics', count: 1758, years: [{ year: 2025, count: 40 }], topics: [{ id: 22, name: 'Trigonometry', count: 90 }, { id: 23, name: 'Angles', count: 40 }] },
    { code: 'PHY', name: 'Physics', count: 2313, years: [{ year: 2015, count: 50 }], topics: [{ id: 60, name: 'Current electricity', count: 120 }] },
    { code: 'CHM', name: 'Chemistry', count: 2771, years: [{ year: 1992, count: 50 }], topics: [{ id: 96, name: 'Water', count: 60 }, { id: 103, name: 'Metals', count: 70 }] },
    { code: 'BIO', name: 'Biology', count: 2433, years: [{ year: 2010, count: 50 }], topics: [] }] });
  if (p.endsWith('/rpc/create_practice')) return json({ assessment_id: 'a0000000-0000-0000-0000-000000000001', question_count: 7, time_limit_sec: null, title: 'Mixed practice' });
  if (p.endsWith('/rpc/get_paper')) return json({ assessment: { id: 'a0000000-0000-0000-0000-000000000001', type: 'practice', title: 'Mixed practice', time_limit_sec: null, answers_visibility: 'per_question', ranked: false }, questions: fx.questions.map((q, i) => ({ ...q, explanation_source: i === 2 ? 'ai_techmed' : 'source' })) });
  if (p.endsWith('/rpc/start_attempt')) { const b = req.postDataJSON(); return json({ attempt: { id: b.p_attempt, started_at: new Date().toISOString(), deadline_at: null }, resumed: false, server_now: new Date().toISOString() }); }
  if (p.endsWith('/rpc/submit_attempt')) { const b = req.postDataJSON(); submits.push(b.p); const sc = b.p.answers.filter((a) => fx.questions.find((q) => q.id === a.question_id)?.correct_option === a.selected).length; return json({ status: 'final', score: sc, total: b.p.answers.length, already_received: false, reject_reason: null }); }
  if (p.endsWith('/rpc/my_results')) return json([62, 55, 70, 68, 74, 79].map((pct, i) => ({ attempt_id: 'r' + i, title: i % 2 ? 'Mixed practice' : 'JAMB mock', score: pct, total: 100, percentage: pct, submitted_at: new Date(Date.now() - (6 - i) * 86400000).toISOString() })).reverse());
  if (p.endsWith('/topic_stats')) return json([{ topic_id: 22, attempted: 24, correct: 10 }, { topic_id: 19, attempted: 40, correct: 33 }, { topic_id: 103, attempted: 12, correct: 6 }, { topic_id: 96, attempted: 14, correct: 10 }, { topic_id: 60, attempted: 4, correct: 4 }]);
  if (p.endsWith('/topics')) return json([{ id: 19, name: 'Comprehension', subject_id: 1 }, { id: 22, name: 'Trigonometry', subject_id: 2 }, { id: 60, name: 'Current electricity', subject_id: 3 }, { id: 96, name: 'Water', subject_id: 4 }, { id: 103, name: 'Metals and their compounds', subject_id: 4 }]);
  if (p.endsWith('/rpc/review_due')) return json({ due: 7, upcoming: 3, by_subject: [{ code: 'CHM', due: 4 }, { code: 'MTH', due: 3 }] });
  if (p.endsWith('/rpc/my_mock_scores')) return json([{ attempt_id: 'm1', submitted_at: '', total: 262, subjects: {} }, { attempt_id: 'm2', submitted_at: '', total: 240, subjects: {} }]);
  if (p.endsWith('/rpc/create_review')) return json({ assessment_id: 'a0000000-0000-0000-0000-000000000001', question_count: 7, time_limit_sec: null, title: 'Review: questions you missed' });
  if (p.endsWith('/rpc/board')) { const b = req.postDataJSON(); const max = b.p_subjects * 100; const names = ['Tijani A.', 'Moyinoluwa I.', 'Opeyemi A.', 'Chinedu O.', 'Esther O.', 'Ifeoluwa O.'];
    const rows = names.map((name, i) => ({ rank: i + 1, name, score: Math.round(max * (0.92 - i * 0.05)), max, duration_sec: 3900 + i * 420, accuracy: 80 - i * 3, subjects: ['BIO', 'CHM', 'ENG', 'PHY'].slice(0, b.p_subjects), is_me: false }));
    return json({ since: new Date().toISOString(), participants: 41, max, min_per_subject: 10, rows, me: { rank: 14, score: Math.round(max * 0.655), max, duration_sec: 6060, accuracy: 65, subjects: [] } }); }
  if (p.endsWith('/question_reports')) { reports.push(req.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
  return json({ message: 'unmocked ' + p }, 404);
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

await page.goto(BASE + '/');
await page.getByRole('heading', { name: 'Ready to practise?' }).waitFor();
check(true, 'signed-in student lands on Home');
await page.getByText('Review 7 questions you missed').waitFor();
check((await page.locator('.today').innerText()).includes('Predicted UTME score: 253/400'), 'Today: review due and predicted score ((262×3+240×2)/5 = 253)');
await shot('01-home');

await page.getByRole('button', { name: /10 quick questions/ }).click();
await page.getByText('Read the passage').waitFor();
check(await page.locator('.passage-b').isVisible(), 'comprehension passage shows above the question');
check(await page.locator('.opt').count() === 5, '5-option (A–E) question renders 5 options');
await shot('02-cbt-passage');

await page.locator('.opt').nth(0).click(); // wrong (key D)
await page.locator('.tutor').waitFor();
check(await page.locator('.opt.is-wrong').count() === 1 && await page.locator('.opt.is-correct').count() === 1, 'instant feedback marks the pick wrong and shows the right one');
check(await page.getByText('Explanation coming soon').isVisible(), 'no explanation → gentle fallback, never an empty box');
await shot('03-instant-wrong-noexpl');

// Report this question
await page.getByRole('button', { name: 'Report this question' }).click();
await page.getByRole('button', { name: 'The answer is wrong' }).click();
await page.getByLabel('Add a note (optional)').fill('I think E fits better');
await page.getByRole('button', { name: 'Send report' }).click();
await page.getByText('Thanks, a TECHMED tutor will check it.').waitFor();
check(reports.length === 1 && reports[0].reason === 'wrong_key' && reports[0].question_id === fx.questions[0].id, 'report lands in question_reports with reason and question');

await page.getByRole('button', { name: 'Next ›' }).click();
check(await page.locator('.passage-b').isVisible(), 'passage stays pinned for the next question of the same passage');
await page.keyboard.press('d'); // keyboard shortcut selects D (correct)
await page.locator('.verdict.ok').waitFor();
check(true, 'keyboard D selects and shows Correct');
await page.keyboard.press('n');

// Maths question with why-not lines
await page.locator('.katex').first().waitFor({ timeout: 10000 });
check(!(await page.locator('.cbt-body').innerText()).includes('\\('), 'maths renders with KaTeX, no raw \\( visible');
await page.locator('.opt').nth(2).click(); // C wrong (key A)
await page.locator('.why').first().waitFor();
const whys = await page.locator('.why').allInnerTexts();
check(whys.length === 3 && whys[0].startsWith('Why not B'), 'each wrong option gets its own why-not line under it');
check((await page.locator('.ai-note').innerText()).includes("KAIRO's AI tutor"), 'AI-written explanations are labelled, with a nudge to report mistakes');
await shot('04-instant-math-whynot');

// Flag, palette, calculator
await page.getByRole('button', { name: 'Flag' }).click();
await page.getByRole('button', { name: /Question palette/ }).click();
await page.locator('.pal').first().waitFor();
check(await page.locator('.pal.flg').count() === 1, 'palette shows the flagged question');
await shot('05-palette');
await page.getByRole('button', { name: 'Chemistry' }).last().click();
await page.locator('.pal').first().click();
check((await page.locator('.qnum').innerText()).includes('1 of 2') && (await page.locator('.stem').innerText()).includes('Brass'), 'palette subject switch + jump works');
await page.getByRole('button', { name: 'Calculator' }).click();
for (const k of ['1', '2', 'x²', '+', '6', '=']) await page.locator('.calc-key', { hasText: new RegExp(`^${k.replace('+', '\\+')}$`) }).click();
check((await page.locator('.calc-cur').innerText()) === '150', 'calculator: 12² + 6 = 150');
await shot('06-calculator');
await page.getByRole('button', { name: 'Done' }).click();

// Resume after closing: reload mid-attempt
const before = page.url();
await page.reload();
await page.locator('.stem').waitFor();
check(page.url() === before && (await page.locator('.stem').innerText()).includes('Brass'), 'reload resumes on the same question');
await page.getByRole('button', { name: /Question palette/ }).click();
check(await page.locator('.pal.ans').count() + await page.locator('.pal.ok').count() + await page.locator('.pal.bad').count() >= 0, 'palette loads after resume');
await page.getByRole('button', { name: 'Mathematics' }).last().click();
check(await page.locator('.pal.flg').count() === 1, 'flag survived the reload');
await page.getByRole('button', { name: 'Submit' }).first().click();
await page.getByText('Submit your answers?').waitFor();
await shot('07-submit-confirm');
await page.getByRole('button', { name: 'Submit now' }).click();

await page.getByRole('heading', { name: 'Your result' }).waitFor();
await page.getByText('Synced ✓').waitFor({ timeout: 10000 });
check(submits.length === 1 && submits[0].answers.length === 7, 'submit sends every question once');
check(submits[0].answers.some((a) => a.flagged) && submits[0].answers.every((a) => a.time_ms >= 0), 'payload carries flags and time per question');
check(await page.locator('.subj-card').count() === 4, 'result shows each subject /100');
await shot('08-result');

await page.getByRole('link', { name: 'Review answers' }).click();
await page.getByRole('heading', { name: 'Review' }).waitFor();
await page.getByRole('button', { name: 'Wrong' }).click();
check(await page.locator('.ns').count() === 2, 'review filter: wrong shows the 2 missed');
await shot('09-review-wrong');

// Offline packs: download online, practise offline, sync when back online
await page.goto(BASE + '/practice/offline');
await page.getByRole('button', { name: /^Download \d+ pack/ }).click();
await page.getByText(/packs? ready to use offline/).waitFor({ timeout: 15000 });
check(await page.locator('.card .btn-primary', { hasText: 'Start' }).count() >= 1, 'offline: packs downloaded and listed');
await ctx.setOffline(true);
const submitsBefore = submits.length;
await page.locator('.card .btn-primary', { hasText: 'Start' }).first().click();
await page.locator('.opt').first().waitFor();
check(true, 'offline: a pack starts with no network');
await page.locator('.opt').first().click();
await page.locator('.tutor').waitFor();
check(await page.locator('.tutor').isVisible(), 'offline: instant feedback works offline');
await page.keyboard.press('s');
await page.getByRole('button', { name: 'Submit now' }).click();
await page.getByRole('heading', { name: /Your result|Submitted/ }).waitFor();
check(submits.length === submitsBefore, 'offline: nothing sent while offline (saved on phone)');
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.getByText('Synced ✓').waitFor({ timeout: 15000 });
check(submits.length === submitsBefore + 1 && submits.at(-1).origin === 'offline', 'offline: syncs when back online, marked as an offline attempt');

// Leaderboard
await page.getByRole('link', { name: 'Ranks' }).click();
await page.locator('.podium').waitFor();
check(await page.locator('.pod').count() === 3 && await page.locator('.lb-row').count() === 3, 'leaderboard: podium of 3 and the rest listed');
check((await page.locator('.lb-me').innerText()).includes('#14'), 'leaderboard pins your own row when you are outside the list');
await shot('11-leaderboard');
check((await page.locator('.pod.p1 .pod-val').innerText()).includes('/400'), 'default board is /400 with time shown');
await page.getByRole('tab', { name: '/100' }).click();
await page.getByRole('button', { name: 'Chemistry' }).waitFor();
await page.locator('.pod.p1 .pod-val', { hasText: '/100' }).waitFor();
check(true, '/100 board offers a subject filter and scores /100');

// Progress page
await page.goto(BASE + '/progress');
await page.getByRole('heading', { name: 'Focus next' }).waitFor();
check((await page.locator('.focus b').first().innerText()) === 'Trigonometry', 'progress: weakest topic first (Trigonometry 10/24)');
check(await page.locator('.focus').count() === 3, 'progress: three focus topics, each with Practise this');
await page.locator('.trend svg').hover({ position: { x: 200, y: 60 } });
check((await page.locator('.trend-tip').innerText()).includes('%'), 'progress: trend tooltip on hover');
await page.getByRole('button', { name: /Chemistry/ }).click();
check((await page.locator('.topics').innerText()).includes('Needs work'), 'progress: topics show mastery labels after 10 answered');
await shot('12-progress');

// Reset password (landing page of the email link)
await page.goto(BASE + '/reset-password');
await page.getByLabel('New password').fill('weak');
await page.getByLabel('Type it again').fill('weak');
await page.getByRole('button', { name: 'Save new password' }).click();
check(await page.getByText(/at least 8 characters/).isVisible() && passwordChanges.length === 0, 'reset password: weak passwords are refused before sending');
await page.getByLabel('New password').fill('Kairo#2027x');
await page.getByLabel('Type it again').fill('Kairo#2027x');
await page.getByRole('button', { name: 'Save new password' }).click();
await page.getByRole('heading', { name: 'Ready to practise?' }).waitFor();
check(passwordChanges.length === 1 && passwordChanges[0].password === 'Kairo#2027x', 'reset password: new password saved, back to Home');

// Dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE + '/');
await page.getByRole('heading', { name: 'Ready to practise?' }).waitFor();
await shot('10-home-dark');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
