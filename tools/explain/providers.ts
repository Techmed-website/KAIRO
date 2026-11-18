// AI providers for the explanation pipeline. Gemini is the default (free tier). Anthropic is kept for hard questions
// but refuses to run unless ALLOW_PAID_API=yes, so nobody can spend money by accident.
import { SCHEMA, type Prompt, type TutorResult } from './core.ts';
type Schema = Record<string, unknown>;

export interface Usage { input: number; output: number }
export interface Provider {
  id: 'gemini' | 'anthropic'; model: string; paid: boolean;
  generate(p: Prompt, schema?: Schema): Promise<{ result: TutorResult; usage: Usage }>;
}

/** The provider asked us to slow down. `waitSec` is its own suggestion; a long wait means the daily quota is used up. */
export class RateLimited extends Error {
  constructor(public waitSec: number, detail = '') { super(`rate limited (${waitSec}s)${detail ? `: ${detail}` : ''}`); }
}
export class ProviderError extends Error {
  constructor(public status: number, message: string, public retryable = false) { super(message); }
  /** The model is busy ("high demand"). Worth waiting a little, then trying another model. */
  get overloaded() { return this.status === 503 || this.status === 529; }
}

// ── Gemini ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** The shared JSON schema in Gemini's responseSchema dialect (upper-case type names). */
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === 'object') {
    const o = s as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'additionalProperties') continue;
      out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : toGeminiSchema(v);
    }
    return out;
  }
  return s;
}

export function geminiBody(p: Prompt, schema: Schema = SCHEMA as unknown as Schema) {
  const parts: unknown[] = [];
  if (p.image) parts.push({ inline_data: { mime_type: p.image.mime, data: p.image.b64 } });
  parts.push({ text: p.text });
  return {
    systemInstruction: { parts: [{ text: p.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema), temperature: 0.2, maxOutputTokens: 8192 },
  };
}

export function parseGeminiResponse(status: number, body: unknown): { result: TutorResult; usage: Usage } {
  const b = body as {
    error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  if (status === 429 || b.error?.status === 'RESOURCE_EXHAUSTED') {
    const delay = b.error?.details?.map((d) => d.retryDelay).find(Boolean);
    throw new RateLimited(delay ? Math.ceil(parseFloat(delay)) : 60, b.error?.message?.slice(0, 160));
  }
  if (status >= 400) throw new ProviderError(status, `Gemini ${status}: ${b.error?.message ?? 'error'}`, status >= 500);
  const cand = b.candidates?.[0];
  if (!cand) throw new ProviderError(200, `Gemini returned no answer${b.promptFeedback?.blockReason ? ` (blocked: ${b.promptFeedback.blockReason})` : ''}`);
  if (cand.finishReason && cand.finishReason !== 'STOP') throw new ProviderError(200, `Gemini stopped early: ${cand.finishReason}`, true);
  const text = cand.content?.parts?.map((x) => x.text ?? '').join('') ?? '';
  let result: TutorResult;
  try { result = JSON.parse(text) as TutorResult; } catch { throw new ProviderError(200, 'Gemini returned text that is not valid JSON', true); }
  const u = b.usageMetadata ?? {};
  return { result, usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
}

export function gemini(model: string, apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    id: 'gemini', model, paid: false,
    async generate(p, schema) {
      let res: Response;
      try {
        res = await fetchImpl(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(geminiBody(p, schema)),
          signal: AbortSignal.timeout(Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000)), // a hung request must not stall the run
        });
      } catch (e) {
        throw new ProviderError(0, `Gemini request failed: ${e instanceof Error ? e.message : e}`, true);
      }
      return parseGeminiResponse(res.status, await res.json().catch(() => ({})));
    },
  };
}

/** Models this key can use for text generation, straight from Google (so we never rely on a remembered model name). */
export async function geminiModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const out: string[] = [];
  let token = '';
  do {
    const res = await fetchImpl(`${GEMINI}/models?pageSize=100${token ? `&pageToken=${token}` : ''}`, { headers: { 'x-goog-api-key': apiKey } });
    const b = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string; error?: { message?: string } };
    if (!res.ok) throw new ProviderError(res.status, `Gemini model list: ${b.error?.message ?? res.status}`);
    for (const m of b.models ?? []) if (m.supportedGenerationMethods?.includes('generateContent')) out.push(m.name.replace(/^models\//, ''));
    token = b.nextPageToken ?? '';
  } while (token);
  return out;
}

// ── Anthropic (paid, optional) ────────────────────────────────────────────────────────────────────────────────────────
export async function anthropic(model: string, env = process.env): Promise<Provider> {
  if (env.ALLOW_PAID_API !== 'yes') {
    throw new Error('The Anthropic provider is paid and is switched off. Set ALLOW_PAID_API=yes (and ANTHROPIC_API_KEY) to use it on purpose.');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  return {
    id: 'anthropic', model, paid: true,
    async generate(p, schema) {
      const content: import('@anthropic-ai/sdk').default.Messages.ContentBlockParam[] = [];
      if (p.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: p.image.b64 } });
      content.push({ type: 'text', text: p.text });
      const stream = client.messages.stream({
        model, max_tokens: 16000,
        system: [{ type: 'text', text: p.system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'high', format: { type: 'json_schema', schema: schema ?? (SCHEMA as unknown as Record<string, unknown>) } },
        messages: [{ role: 'user', content }],
      });
      const m = await stream.finalMessage();
      if (m.stop_reason !== 'end_turn') throw new ProviderError(200, `Claude stopped: ${m.stop_reason}`, m.stop_reason === 'max_tokens');
      const text = m.content.find((c) => c.type === 'text');
      let result: TutorResult;
      try { result = JSON.parse(text && 'text' in text ? text.text : '') as TutorResult; } catch { throw new ProviderError(200, 'Claude returned invalid JSON', true); }
      return { result, usage: { input: m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0), output: m.usage.output_tokens } };
    },
  };
}
