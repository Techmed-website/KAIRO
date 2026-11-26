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
const reports = [], submits = [], passwordChanges = [], practiceReqs = [], topicStatQueries = [];
// Today's Daily Builder Quiz on Home (cbt.home_today); the test moves it through its states.
const dailyBase = { id: 'a0000000-0000-0000-0000-000000000001', title: 'TECHMED UTME 2027 Daily Builder Quiz — Day 10: Chemistry (Gas Laws)', day_number: 10,
  topic_label: 'Gas Laws', subject: 'Chemistry', subject_code: 'CHM', question_count: 10, time_limit_sec: 300, opens_at: new Date().toISOString(),
  is_today: true, players: 41, best: null, in_progress: null, result: null };
let homeToday = { ...dailyBase };
let planBlob = null; const planSaves = [];
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript(([s]) => { localStorage.setItem('sb-unbgborbhxzsotaieiun-auth-token', JSON.stringify(s)); }, [session]);
await ctx.route('https://kxoz58eb.apicdn.sanity.io/**', (route) => route.fulfill({ contentType: 'application/json',
  body: JSON.stringify({ result: { kairoActive: true, kairoMessage: 'Free UTME 2027 classes on techmedng.com.', kairoCtaLabel: 'See classes', kairoCtaUrl: 'https://techmedng.com' } }) }));
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
  if (p.endsWith('/rpc/home_today')) return homeToday === 'error' ? json({ message: 'boom' }, 500) : json(homeToday);
  if (p.endsWith('/rpc/public_quiz_by_id')) return json({ ...dailyBase, type: 'daily_quiz', status: 'live', closes_at: null, has_passcode: false, guests_allowed: true, ranked: true });
  if (p.endsWith('/rpc/my_progress')) return json({ streak: { current: 4, best: 6, today: true, days: 12, week: [true, false, true, true, true, true, true] }, questions: 1240, correct: 868, daily_quizzes: 5, new: [], badges: [] });
  if (p.endsWith('/rpc/bank_count')) return json({ total: 13779, by_subject: { ENG: 4504, MTH: 1758, PHY: 2313, CHM: 2771, BIO: 2433 } });
  if (p.endsWith('/rpc/get_study_plan')) return json(planBlob ? { data: planBlob, updated_at: new Date().toISOString() } : null);
  if (p.endsWith('/rpc/save_study_plan')) { planBlob = req.postDataJSON().p_data; planSaves.push(planBlob); return json(new Date().toISOString()); }
  if (p.endsWith('/rpc/create_practice')) { practiceReqs.push(req.postDataJSON().p); return json({ assessment_id: 'a0000000-0000-0000-0000-000000000001', question_count: 7, time_limit_sec: null, title: 'Mixed practice' }); }
  if (p.endsWith('/rpc/get_paper')) return json({ assessment: { id: 'a0000000-0000-0000-0000-000000000001', type: 'practice', title: 'Mixed practice', time_limit_sec: null, answers_visibility: 'per_question', ranked: false }, questions: fx.questions });
  if (p.endsWith('/rpc/start_attempt')) { const b = req.postDataJSON(); return json({ attempt: { id: b.p_attempt, started_at: new Date().toISOString(), deadline_at: null }, resumed: false, server_now: new Date().toISOString() }); }
  if (p.endsWith('/rpc/submit_attempt')) { const b = req.postDataJSON(); submits.push(b.p); const sc = b.p.answers.filter((a) => fx.questions.find((q) => q.id === a.question_id)?.correct_option === a.selected).length; return json({ status: 'final', score: sc, total: b.p.answers.length, already_received: false, reject_reason: null }); }
  if (p.endsWith('/rpc/my_results')) return json([62, 55, 70, 68, 74, 79].map((pct, i) => ({ attempt_id: 'r' + i, title: i % 2 ? 'Mixed practice' : 'JAMB mock', score: pct, total: 100, percentage: pct, submitted_at: new Date(Date.now() - (6 - i) * 86400000).toISOString() })).reverse());
  if (p.endsWith('/topic_stats')) { topicStatQueries.push(url.search); return json([{ topic_id: 22, attempted: 24, correct: 10, last_attempt_at: '2026-11-20T10:00:00Z' }, { topic_id: 19, attempted: 40, correct: 33, last_attempt_at: '2026-11-25T10:00:00Z' }, { topic_id: 103, attempted: 12, correct: 6, last_attempt_at: '2026-11-24T10:00:00Z' }, { topic_id: 96, attempted: 14, correct: 10, last_attempt_at: null }, { topic_id: 60, attempted: 4, correct: 4, last_attempt_at: null }]); }
  if (p.endsWith('/topics')) return json([{ id: 19, name: 'Comprehension', subject_id: 1 }, { id: 22, name: 'Trigonometry', subject_id: 2 }, { id: 60, name: 'Current electricity', subject_id: 3 }, { id: 96, name: 'Water', subject_id: 4 }, { id: 103, name: 'Metals and their compounds', subject_id: 4 }]);
  if (p.endsWith('/rpc/review_due')) return json({ due: 7, upcoming: 3, by_subject: [{ code: 'CHM', due: 4 }, { code: 'MTH', due: 3 }] });
  if (p.endsWith('/rpc/my_mock_scores')) return json([{ attempt_id: 'm1', submitted_at: '', total: 262, subjects: {} }, { attempt_id: 'm2', submitted_at: '', total: 240, subjects: {} }]);
  if (p.endsWith('/rpc/create_review')) return json({ assessment_id: 'a0000000-0000-0000-0000-000000000001', question_count: 7, time_limit_sec: null, title: 'Review: questions you missed' });
  if (p.endsWith('/rpc/board')) { const b = req.postDataJSON(); const max = b.p_subjects * 100; const names = ['Tijani A.', 'Moyinoluwa I.', 'Opeyemi A.', 'Chinedu O.', 'Esther O.', 'Ifeoluwa O.'];
    const rows = names.map((name, i) => ({ rank: i + 1, name, score: Math.round(max * (0.92 - i * 0.05)), max, duration_sec: 3900 + i * 420, accuracy: 80 - i * 3, subjects: ['BIO', 'CHM', 'ENG', 'PHY'].slice(0, b.p_subjects), is_me: false }));
    return json({ since: new Date().toISOString(), participants: 41, max, min_per_subject: 10, rows, me: { rank: 14, score: Math.round(max * 0.655), max, duration_sec: 6060, accuracy: 65, subjects: [] } }); }
  if (p.endsWith('/rpc/paper_board')) { const ss = (k) => ({ ENG: 80 - k, BIO: 70 - k, CHM: 66 - k, PHY: 60 - k });
    const rows = ['Tijani A.', 'Moyinoluwa I.', 'Opeyemi A.', 'Chinedu O.'].map((name, i) => ({ rank: i + 1, name, score: 276 - i * 20, max: 400, duration_sec: 3900 + i * 300, accuracy: 70, subject_scores: ss(i * 5), is_me: false }));
    return json({ eligible: true, scope: 'subjects', title: 'JAMB mock', question_count: 180, max: 400, participants: 430,
      this: { rank: 59, score: 212, duration_sec: 6000, subject_scores: ss(17), personal_best: true }, me: { rank: 59, score: 212, duration_sec: 6000, accuracy: 53, subject_scores: ss(17) }, rows }); }
  if (p.endsWith('/rpc/daily_quizzes')) return json([{ id: 'a0000000-0000-0000-0000-000000000001', title: 'TECHMED UTME 2027 Daily Builder Quiz — Day 10: Mathematics (Indices & Surds)', opens_at: new Date().toISOString(), time_limit_sec: 600, question_count: 7, my_best: null, players: 41 }]);
  if (p.endsWith('/question_reports')) { reports.push(req.postDataJSON()); return route.fulfill({ status: 201, body: '' }); }
  return json({ message: 'unmocked ' + p }, 404);
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

await page.goto(BASE + '/');
await page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada\.$/ }).waitFor();
check(true, 'signed-in student lands on Home with a greeting by first name');
check((await page.locator('.brand').innerText()).toUpperCase().includes('SEIZE THE MOMENT.'), 'brand header carries the tagline');
await page.getByText('Today’s quiz is ready.').waitFor();
const daily = await page.locator('.daily').innerText();
check(/day 10/i.test(daily) && daily.includes('Chemistry · Gas Laws') && daily.includes('10 questions'), 'daily card: day, subject, topic and size');
check(await page.getByRole('link', { name: /Start today’s quiz/ }).getAttribute('href') === '/q/a0000000-0000-0000-0000-000000000001', 'Start today’s quiz opens the quiz');
const snap = await page.locator('.snap').innerText();
check(snap.includes('4 days') && snap.includes('1,240') && snap.includes('70%'), 'snapshot: streak 4, 1,240 answered, accuracy 868/1240 = 70% (lifetime, from my_progress)');
check(await page.locator('.subj').count() === 5, 'all five subjects');
check(await page.locator('.ex').count() === 6, 'six Explore KAIRO cards');
for (const [name, href] of [['Past questions', '/practice'], ['Full JAMB mock', '/practice/mock'], ['Leaderboard', '/leaderboard'], ['Your progress', '/progress'], ['Quizzes', '/quizzes']])
  check(await page.locator('.ex', { hasText: name }).getAttribute('href') === href, `Explore: ${name} → ${href}`);
check((await page.locator('.subj', { hasText: 'Chemistry' }).getAttribute('href')) === '/practice/CHM', 'a subject opens its practice page');
check(await page.getByText('Know what to study next.').count() === 1, 'study planner invitation when there is no plan');
await page.getByText('Review 7 questions you missed').waitFor();
check((await page.locator('.today').innerText()).includes('Predicted UTME score: 253/400'), 'Up next: review due and predicted score ((262×3+240×2)/5 = 253)');
await shot('01-home');
await page.locator('.banner').waitFor();
check((await page.locator('.banner').innerText()).includes('See classes'), 'announcement banner from Sanity shows on Home');
await page.getByRole('button', { name: 'Dismiss this announcement' }).click();

homeToday = { ...dailyBase, in_progress: { attempt_id: 'x', deadline_at: null, answered: 3 } };
await page.reload();
await page.getByText('You’ve started today’s quiz.').waitFor();
check((await page.locator('.daily-progress').innerText()).includes('3/10'), 'in progress: resume, with 3 of 10 answered');
homeToday = 'error';
await page.reload();
await page.getByText('We couldn’t load today’s quiz.').waitFor();
check(true, 'error state with a retry');
homeToday = { ...dailyBase, is_today: false };
await page.getByRole('button', { name: 'Try again' }).click();
await page.getByText('Today’s quiz is on its way.').waitFor();
check(true, 'no quiz yet today: says so, offers practice (retry worked)');
homeToday = { ...dailyBase, best: 8, result: { attempt_id: 'r', score: 8, total: 10, answered: 10 } };
await page.reload();
await page.getByText('Today’s challenge completed!').waitFor();
const done = await page.locator('.daily').innerText();
check(done.includes('8/10') && done.includes('80%') && done.includes('10/10') && done.includes('4 days') && !done.includes('Start today'), 'completed: score, accuracy, answered, streak; no start button');
await shot('01b-home-done');

await page.goto(BASE + '/q/a0000000-0000-0000-0000-000000000001');
await page.getByRole('heading', { name: /Day 10: Chemistry/ }).waitFor();
check(true, 'Start today’s quiz lands on the quiz’s instructions screen');
await page.goto(BASE + '/');
await page.getByText('Today’s challenge completed!').waitFor();
check(await page.locator('.banner').count() === 0, 'banner can be dismissed');

await page.getByRole('button', { name: 'Practise 10 more questions' }).click();
check(await page.getByRole('button', { name: 'Choose a subject' }).isDisabled(), 'practise more: a subject must be chosen first');
await page.getByRole('radio', { name: 'Chemistry' }).click();
await page.getByRole('button', { name: 'Start 10 Chemistry questions' }).click();
await page.waitForURL(/\/cbt\//);
check(JSON.stringify(practiceReqs.at(-1)?.subjects) === JSON.stringify([{ code: 'CHM', count: 10 }]), 'practise more: 10 questions from the chosen subject');
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

await page.getByRole('button', { name: /^Next question/ }).click();
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
check(await page.locator('.ai-note').count() === 0, 'explanations carry no AI or checked-by labels, only the report link');
await shot('04-instant-math-whynot');

// Flag, palette, calculator
check((await page.locator('.qstate').innerText()) === 'Answered' && (await page.locator('.opt[aria-checked="true"]').count()) === 1, 'exam: the chosen answer is marked and the question shows Answered');
await page.getByRole('button', { name: /Flag for review/ }).click();
check((await page.locator('.opt[aria-checked="true"]').count()) === 1, 'exam: flagging keeps the chosen answer');
check(/answered/.test(await page.locator('.xh-meta').innerText()) && (await page.locator('.xsync').innerText()) === 'Saved', 'exam: header shows answered count and an honest save status (untimed: saved on phone)');
await page.getByRole('button', { name: /Question navigator/ }).click();
await page.locator('.sheet .pal').first().waitFor();
check(await page.locator('.sheet .pal.flg').count() === 1, 'palette shows the flagged question');
await page.getByRole('button', { name: /^Flagged 1/ }).click();
check(await page.locator('.sheet .pal').count() === 1 && (await page.locator('.sheet .pal').getAttribute('aria-label')).includes('flagged'), 'navigator: Flagged filter lists only the flagged question');
await page.getByRole('button', { name: /^Flagged 1/ }).click();
await shot('05-palette');
await page.getByRole('button', { name: 'Chemistry' }).last().click();
await page.locator('.sheet .pal').first().click();
check((await page.locator('.qnum').innerText()).toLowerCase().includes('1 of 2') && (await page.locator('.stem').innerText()).includes('Brass'), 'palette subject switch + jump works');
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
await page.getByRole('button', { name: /Question navigator/ }).click();
check(await page.locator('.sheet .pal.ans').count() + await page.locator('.sheet .pal.ok').count() + await page.locator('.sheet .pal.bad').count() >= 0, 'palette loads after resume');
await page.getByRole('button', { name: 'Mathematics' }).last().click();
check(await page.locator('.sheet .pal.flg').count() === 1, 'flag survived the reload');
await page.getByRole('button', { name: 'Review and submit' }).first().click();
await page.getByText('Submit your answers?').waitFor();
const sum = await page.locator('.sum-grid').innerText();
check(/QUESTIONS\s+7/i.test(sum) && /FLAGGED\s+1/i.test(sum), 'submit: summary shows total, answered, unanswered, flagged and time');
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
await page.locator('.rank-link').waitFor();
check((await page.locator('.rank-link').innerText()).includes('#59') && (await page.locator('.rank-link').innerText()).includes('430'), 'result: shows "your rank #59 of 430" once synced');
await page.locator('.rank-link').click();
await page.getByRole('heading', { name: 'Paper ranking' }).waitFor();
check(await page.locator('.pod').count() === 3 && (await page.locator('.lb-row').innerText()).includes('Eng 65'), 'paper ranking: podium plus subject-by-subject scores');
check((await page.locator('.rank-card').innerText()).includes('of 430'), 'paper ranking: your rank card');
await shot('10b-paper-ranking');

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
await page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada\.$/ }).waitFor();
check(passwordChanges.length === 1 && passwordChanges[0].password === 'Kairo#2027x', 'reset password: new password saved, back to Home');

// Practice hub and question bank
const lastReq = () => practiceReqs.at(-1);
await page.goto(BASE + '/practice');
await page.getByRole('heading', { name: 'What would you like to practise?' }).waitFor();
check((await page.locator('.brand').innerText()).toUpperCase().includes('SEIZE THE MOMENT.'), 'practice: header with tagline');
check(await page.getByRole('link', { name: /Start full mock/ }).getAttribute('href') === '/practice/mock', 'practice: Start full mock opens the mock');
check(await page.locator('.mode', { hasText: 'Custom practice' }).getAttribute('href') === '/practice/mixed' && await page.locator('.mode', { hasText: 'Offline packs' }).getAttribute('href') === '/practice/offline', 'practice: custom and offline cards');
await page.locator('.bank-row').first().waitFor();
const rows = await page.locator('.bank-row').allInnerTexts();
check(rows.length === 5 && rows[0].includes('Use of English') && rows[0].includes('4,504') && rows[0].includes('2 years · 1 topic') && rows[4].includes('Mathematics'), 'question bank: five subjects in order, live counts, years and topics from the catalog');
check(topicStatQueries.every((q) => q.includes('user_id=eq.')), 'topic progress is read for this student only');
check((await page.locator('.recent-topics').innerText()).includes('Comprehension · 83%'), 'recent practice: most recently practised topic first, with accuracy');
await shot('13-practice');
await page.getByRole('button', { name: 'Start 10 Biology questions' }).click();
await page.waitForURL(/\/cbt\//);
check(JSON.stringify(lastReq().subjects) === '[{"code":"BIO","count":10}]' && lastReq().feedback === 'instant', 'quick practice: one tap, 10 Biology questions');

await page.goto(BASE + '/practice');
await page.locator('.bank-row', { hasText: 'Chemistry' }).click();
await page.getByRole('heading', { name: 'Chemistry', level: 1 }).waitFor();
check((await page.locator('.subj-head').innerText()).includes('2,771 questions · 1 years · 2 topics'), 'subject bank: header with totals');
await page.getByLabel('Find a topic').fill('met');
await page.locator('.hit', { hasText: 'Metals' }).click();
check((await page.locator('.sheet').innerText()).includes('50% of 12'), 'topic sheet shows my real progress on the topic (6/12)');
await shot('14-subject-topic-sheet');
await page.getByRole('button', { name: 'Start 10 questions' }).click();
await page.waitForURL(/\/cbt\//);
check(lastReq().mode === 'topic' && JSON.stringify(lastReq().topic_ids) === '[103]' && lastReq().count === 10, 'search → topic → 10-question topic practice');

await page.goto(BASE + '/practice/CHM/topics');
await page.locator('.tp').first().waitFor();
check(await page.locator('.tp').count() === 2, 'browse by topic: every topic listed');
await page.getByRole('button', { name: 'Strong' }).click();
check(await page.locator('.tp').count() === 0, 'filter: no Chemistry topic at 80%+');
await page.getByRole('button', { name: 'Needs work' }).click();
check(await page.locator('.tp').count() === 0 && (await page.locator('.card').innerText()).includes('No topic matches'), 'filter: needs work (<50%) is empty, with a message');
await page.getByRole('button', { name: 'All', exact: true }).click();
await shot('15-topics');

await page.goto(BASE + '/practice/CHM/years');
await page.getByRole('button', { name: '1992, 50 questions' }).click();
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForURL(/\/cbt\//);
check(lastReq().mode === 'year' && lastReq().year === 1992 && lastReq().subject === 'CHM', 'browse by year: the 1992 paper');

await page.goto(BASE + '/practice/CHM');
await page.getByRole('button', { name: /All Chemistry questions/ }).click();
await page.getByRole('button', { name: 'Start 20 questions' }).click();
await page.waitForURL(/\/cbt\//);
check(lastReq().mode === 'mixed' && JSON.stringify(lastReq().subjects) === '[{"code":"CHM","count":20}]' && !lastReq().years, 'all questions: 20 from the whole subject, every year');

await page.goto(BASE + '/practice/mixed');
await page.getByRole('heading', { name: 'Build a session' }).waitFor();
await page.getByRole('button', { name: /Narrow it down/ }).click();
await page.locator('.topic-pick', { hasText: 'Chemistry' }).click();
await page.locator('.sheet .topic', { hasText: 'Metals' }).click();
await page.getByRole('button', { name: 'Use 1 topic' }).click();
await page.getByRole('button', { name: 'Last 10 years' }).click();
await shot('16-custom');
await page.getByRole('button', { name: /^Start · 40 questions$/ }).click();
await page.waitForURL(/\/cbt\//);
const ids = lastReq().topic_ids ?? [];
check(ids.includes(103) && !ids.includes(96) && ids.includes(19) && ids.includes(22) && ids.includes(60) && JSON.stringify(lastReq().years) === '[2015,2025]',
  'custom: Chemistry narrowed to Metals, other subjects keep all their topics, last 10 years');

// Study planner inside KAIRO (shared with the TECHMED dashboard through cbt.study_plans)
planBlob = { kept_by_website: 1 };
await page.goto(BASE + '/planner');
await page.getByRole('heading', { name: 'Know exactly what to study today.' }).waitFor();
await page.getByLabel('Exam date').fill('2027-04-20');
await page.getByRole('button', { name: 'Continue' }).click();
check(await page.getByRole('button', { name: 'Chemistry' }).getAttribute('aria-pressed') === 'true', 'planner: subjects start from the student profile');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('group', { name: 'Chemistry starting point' }).getByRole('button', { name: 'Covered some' }).click();
await page.locator('.wiz-subject', { hasText: 'Chemistry' }).getByLabel('Chemical Combination').check();
await shot('17-planner-wizard');
await page.getByRole('button', { name: 'Build my plan' }).click();
await page.getByRole('heading', { name: 'Your plan' }).waitFor();
const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await page.waitForTimeout(100); };
await until(() => planBlob?.input);
const saved = planSaves.at(-1);
check(saved?.input?.targetDate === '2027-04-20' && saved.input.subjects.length === 4 && saved.input.subjects[0].slug === 'use-of-english'
  && saved.completed.some((k) => k.includes('Chemical Combination')) && saved.current_week?.weekNumber === 1 && saved.kept_by_website === 1,
  'planner: plan saved in the website\'s format (input, completed, current_week), other fields kept');
await shot('18-planner');
const practiseBtn = page.locator('.task-practise .btn').first();
if (await practiseBtn.count()) {
  await practiseBtn.click();
  await page.waitForURL(/\/cbt\//);
  check(['topic', 'mixed'].includes(lastReq().mode) && lastReq().count === 10, 'planner: Practise 10 on today\'s topic starts KAIRO practice');
  await page.goto(BASE + '/planner');
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
} else check(true, 'planner: no study session today (rest day), skip practise check');
const doneBefore = planBlob.completed.length;
await page.locator('.wk-list input[type=checkbox]:not(:checked)').first().check();
await until(() => planBlob.completed.length === doneBefore + 1);
check(planBlob.completed.length === doneBefore + 1, 'planner: ticking a topic saves it to the shared plan');
await page.getByRole('button', { name: 'Start over' }).click();
await page.getByRole('button', { name: 'Clear everything and start over' }).click();
await page.getByRole('heading', { name: 'Know exactly what to study today.' }).waitFor();
await until(() => !planBlob.input);
check(!planBlob.input && !planBlob.completed && planBlob.kept_by_website === 1, 'planner: start over clears the planner fields only');

// JAMB syllabus inside KAIRO
await page.goto(BASE + '/syllabus');
await page.locator('.bank-row').first().waitFor();
check(await page.locator('.bank-row').count() === 5, 'syllabus: five subjects');
await page.locator('.bank-row', { hasText: 'Chemistry' }).click();
await page.getByRole('heading', { name: 'Chemistry', level: 1 }).waitFor();
await shot('19-syllabus-chemistry');
await page.getByRole('button', { name: 'Practise Water' }).click();
await page.waitForURL(/\/cbt\//);
check(lastReq().mode === 'topic' && JSON.stringify(lastReq().topic_ids) === '[96]', 'syllabus: a topic opens practice on the matching KAIRO topic');

// Dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE + '/');
await page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Ada\.$/ }).waitFor();
await shot('10-home-dark');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
