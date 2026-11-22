import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropic, gemini, geminiBody, geminiModels, parseGeminiResponse, RateLimited, ProviderError } from './providers.ts';
import { buildPrompt, METHOD, type QueueItem } from './core.ts';
import { handle, newStats, Throttle, QuotaReached, ModelUnavailable } from './explain.ts';

const q: QueueItem = { question_id: '7d4ccb14-f139-4422-a5cf-44c75ba36656', subject: 'PHY', year: 2025, stem_html: 'Which colour has the <em>longest</em> wavelength?<br>H<sub>2</sub>O',
  passage_html: null, media_url: null, topic: 'Light', correct_option: 'A', existing_explanation: null,
  options: [{ key: 'A', html: 'Red' }, { key: 'B', html: 'Blue' }, { key: 'C', html: 'Yellow' }, { key: 'D', html: 'Violet' }] };
const good = { verdict: 'agree', correct_option: 'A', reasoning_for_editor: 'Key confirmed.', concept: 'Red has the longest wavelength in the visible spectrum.',
  steps: ['Order: red to violet', 'Red is at the long end'], tip: 'ROYGBIV.',
  why_not: [{ option: 'B', explanation: 'Blue is near the short end of the spectrum.' }, { option: 'C', explanation: 'Yellow sits in the middle, so its wavelength is shorter than red.' }, { option: 'D', explanation: 'Violet has the shortest wavelength, the opposite end from red.' }] };
const reply = (r: unknown) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(r) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300, thoughtsTokenCount: 50 } });
const fastThrottle = new Throttle(100000);

test('prompt turns the question into plain text and carries the TECHMED method as the system prompt', () => {
  const p = buildPrompt(q);
  assert.equal(p.system, METHOD);
  assert.match(p.text, /Subject: Physics \(UTME 2025\) · Topic: Light/);
  assert.match(p.text, /longest\* ?wavelength|longest wavelength/);
  assert.match(p.text, /H_\(2\)O/);
  assert.match(p.text, /Supplied answer key: A/);
});
test('Gemini request: key in a header, JSON schema in upper-case dialect, system prompt separate', () => {
  const b = geminiBody(buildPrompt(q)) as any;
  assert.equal(b.generationConfig.responseMimeType, 'application/json');
  assert.equal(b.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(b.generationConfig.responseSchema.properties.steps.items.type, 'STRING');
  assert.equal('additionalProperties' in b.generationConfig.responseSchema, false);
  assert.equal(b.systemInstruction.parts[0].text, METHOD);
});
test('Gemini response parsing: success, rate limit with its own delay, early stop, bad JSON', () => {
  const ok = parseGeminiResponse(200, reply(good));
  assert.equal(ok.result.verdict, 'agree'); assert.deepEqual(ok.usage, { input: 900, output: 350 });
  assert.throws(() => parseGeminiResponse(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ retryDelay: '34s' }] } }), (e: any) => e instanceof RateLimited && e.waitSec === 34);
  assert.throws(() => parseGeminiResponse(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] }), ProviderError);
  assert.throws(() => parseGeminiResponse(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }), ProviderError);
});
test('Gemini calls the right URL with the key in a header, never in the URL', async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const f = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string> }; return new Response(JSON.stringify(reply(good))); }) as unknown as typeof fetch;
  await gemini('some-model', 'SECRET', f).generate(buildPrompt(q));
  assert.match(seen!.url, /\/v1beta\/models\/some-model:generateContent$/);
  assert.equal(seen!.headers['x-goog-api-key'], 'SECRET'); assert.doesNotMatch(seen!.url, /SECRET/);
});
test('model list keeps only models that can generate text', async () => {
  const f = (async () => new Response(JSON.stringify({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-b', supportedGenerationMethods: ['embedContent'] }] }))) as unknown as typeof fetch;
  assert.deepEqual(await geminiModels('k', f), ['gemini-a']);
});
test('the paid provider refuses to start without ALLOW_PAID_API=yes', async () => {
  await assert.rejects(anthropic('claude-opus-5-5', {} as NodeJS.ProcessEnv), /paid and is switched off/);
});

/** A fake model: `replies` answer the tutor prompts in order; the strict-editor checks answer from `checks` (default: approve). */
const stub = (...replies: unknown[]) => { let i = 0, c = 0; const checks: unknown[] = [];
  return { id: 'gemini' as const, model: 'stub', paid: false, calls: () => i, checks, checkCalls: () => c,
    async generate(_p: unknown, schema?: Record<string, any>) {
      if (schema?.properties?.ok) { const r = checks[Math.min(c++, Math.max(checks.length - 1, 0))] ?? { ok: true, problems: [] }; return { result: r as any, usage: { input: 5, output: 2 } }; }
      const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r; return { result: r as any, usage: { input: 10, output: 5 } }; } }; };

test('handle: a valid agreeing answer is saved in the TECHMED format', async () => {
  const o = await handle(q, stub(good), null, fastThrottle, newStats());
  assert.equal(o.kind, 'save'); if (o.kind === 'save') assert.match(o.explanation, /^Concept: .*\nSteps:\n1\. /);
});
test('handle: weak output is retried once with the reason, then saved', async () => {
  const weak = { ...good, why_not: good.why_not.slice(0, 1) };
  const p = stub(weak, good); const st = newStats();
  const o = await handle(q, p, null, fastThrottle, st);
  assert.equal(o.kind, 'save'); assert.equal(p.calls(), 2); assert.equal(st.retried, 1);
});
test('handle: weak output twice is a failure to retry later, not a save', async () => {
  const weak = { ...good, why_not: [] };
  assert.equal((await handle(q, stub(weak), null, fastThrottle, newStats())).kind, 'fail');
});
test('handle: a disagreement is flagged, unless the stronger second opinion confirms the key', async () => {
  const dis = { ...good, verdict: 'disagree', correct_option: 'B', reasoning_for_editor: 'I get B.' };
  assert.equal((await handle(q, stub(dis), null, fastThrottle, newStats())).kind, 'flag');
  const o = await handle(q, stub(dis), stub(good), fastThrottle, newStats());
  assert.equal(o.kind, 'save'); if (o.kind === 'save') assert.match(o.note ?? '', /confirmed the key/);
  const both = await handle(q, stub(dis), stub(dis), fastThrottle, newStats());
  assert.equal(both.kind, 'flag'); if (both.kind === 'flag') assert.match(both.reasoning, /stub: I get B\. \| stub: I get B\./);
});
test('handle: a long rate-limit wait stops the whole run (quota), not just one question', async () => {
  await assert.rejects(handle(q, stub(new RateLimited(3600)), null, fastThrottle, newStats()), QuotaReached);
});

test('a hung or failed Gemini request becomes a retryable error, not a stalled run', async () => {
  const f = (async (_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timed out'))))) as unknown as typeof fetch;
  process.env.REQUEST_TIMEOUT_MS = '50';
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout does not hold the event loop open by itself
  try { await assert.rejects(gemini('m', 'k', f).generate(buildPrompt(q)), (e: any) => e instanceof ProviderError && e.retryable); }
  finally { clearInterval(keepAlive); delete process.env.REQUEST_TIMEOUT_MS; }
});

test('a model that stays busy (503) is given up on after a couple of waits, so the run can switch models', async () => {
  process.env.BUSY_WAIT_SCALE = '0';
  try {
    const busy = new ProviderError(503, 'high demand', true);
    const p = stub(busy, busy, busy);
    await assert.rejects(handle(q, p, null, fastThrottle, newStats()), ModelUnavailable);
    assert.equal(p.calls(), 3);
    const recovers = stub(busy, good);
    assert.equal((await handle(q, recovers, null, fastThrottle, newStats())).kind, 'save');
  } finally { delete process.env.BUSY_WAIT_SCALE; }
});

test('the strict-editor check must approve before anything is saved; a rejected draft is rewritten once, then dropped', async () => {
  const p = stub(good, good); p.checks.push({ ok: false, problems: ['B has 5 distinct elements, not 6.'] }, { ok: true, problems: [] });
  const o = await handle(q, p, null, fastThrottle, newStats());
  assert.equal(o.kind, 'save'); assert.equal(p.calls(), 2); assert.equal(p.checkCalls(), 2);
  const bad = stub(good, good); bad.checks.push({ ok: false, problems: ['invented plot detail'] });
  const st = newStats();
  assert.equal((await handle(q, bad, null, fastThrottle, st)).kind, 'fail'); assert.equal(st.rejectedByCheck, 2);
});
test('set-novel questions and missing passages go to an editor without any model call', async () => {
  const p = stub(good);
  const novel = { ...q, stem_html: 'The following question is based on <em>The Life Changer</em>. What is the Note of Salvation?' };
  const o = await handle(novel, p, null, fastThrottle, newStats());
  assert.equal(o.kind, 'flag'); assert.equal(p.calls(), 0);
  assert.equal((await handle({ ...q, stem_html: 'What was the common ritual at the morning assembly at Stardom on Tuesdays?' }, p, null, fastThrottle, newStats())).kind, 'flag');
  const noPassage = { ...q, stem_html: 'According to the passage, the author believes that' };
  assert.equal((await handle(noPassage, p, null, fastThrottle, newStats())).kind, 'flag');
  assert.equal((await handle({ ...noPassage, passage_html: '<p>text</p>' }, p, null, fastThrottle, newStats())).kind, 'save');
  // Even with an editor-confirmed key, the AI never writes a set-novel explanation.
  const callsBefore = p.calls();
  assert.equal((await handle({ ...novel, key_source: 'editor' }, p, null, fastThrottle, newStats())).kind, 'fail');
  assert.equal(p.calls(), callsBefore);
});
