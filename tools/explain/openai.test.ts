import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiBody, openaiCompat, parseOpenAIResponse, ProviderError, RateLimited } from './providers.ts';

const prompt = { system: 'sys', text: 'question', image: { mime: 'image/webp', b64: 'AAAA' } };
const ok = (content: string) => ({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

test('openai-compatible body: JSON mode, schema in the system prompt, image as a data URL', () => {
  const b = openaiBody('m', prompt, { type: 'object' }) as { response_format: unknown; messages: { content: unknown }[] };
  assert.deepEqual(b.response_format, { type: 'json_object' });
  assert.match(String(b.messages[0].content), /JSON schema/);
  assert.match(JSON.stringify(b.messages[1].content), /data:image\/webp;base64,AAAA/);
  assert.equal((openaiBody('m', prompt, {}, false) as { messages: { content: unknown }[] }).messages[1].content, 'question');
});

test('openai-compatible replies: fenced or think-prefixed JSON parses; 429 is a rate limit; 503 is overloaded', () => {
  assert.deepEqual(parseOpenAIResponse('groq', 200, ok('```json\n{"a":1}\n```')).result, { a: 1 });
  assert.deepEqual(parseOpenAIResponse('groq', 200, ok('<think>hmm</think>{"a":2}')).result, { a: 2 });
  assert.equal(parseOpenAIResponse('groq', 200, ok('{}')).usage.output, 5);
  assert.throws(() => parseOpenAIResponse('groq', 429, { error: { message: 'slow down' } }, new Headers({ 'retry-after': '7' })), (e) => e instanceof RateLimited && e.waitSec === 7);
  assert.throws(() => parseOpenAIResponse('github', 503, { error: 'busy' }), (e) => e instanceof ProviderError && e.overloaded);
  assert.throws(() => parseOpenAIResponse('github', 200, ok('not json')), (e) => e instanceof ProviderError && e.retryable);
  assert.throws(() => parseOpenAIResponse('github', 200, { choices: [{ finish_reason: 'length', message: { content: '{' } }] }), /stopped early/);
});

test('a text-only model gets the question again without the image', async () => {
  const sent: string[] = [];
  const fake = (async (_u: string, init: RequestInit) => {
    sent.push(String(init.body));
    return sent.length === 1
      ? new Response(JSON.stringify({ error: { message: 'Image input is not supported for this model' } }), { status: 400 })
      : new Response(JSON.stringify(ok('{"x":1}')), { status: 200 });
  }) as typeof fetch;
  const r = await openaiCompat('github', 'some/model', 't', fake).generate(prompt);
  assert.deepEqual(r.result, { x: 1 });
  assert.match(sent[0], /image_url/);
  assert.doesNotMatch(sent[1], /image_url/);
});
