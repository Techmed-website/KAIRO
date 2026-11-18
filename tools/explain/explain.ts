// KAIRO explanation pipeline: TECHMED-method explanations + independent answer-key checks, via the Message Batches API.
//
//   npm run queue   -- --limit 20 [--subject CHM]          preview what still needs explaining
//   npm run submit  -- --limit 500 [--subject CHM] [--effort high]   send a batch (50% price), prints the batch id
//   npm run collect -- <batch_id> [--dry-run]              validate results; save explanations, flag disputed keys
//   npx tsx explain.ts import <file.json> [--emit-sql]     same validation for results produced elsewhere
//
// Env: ANTHROPIC_API_KEY (or an `ant auth login` profile), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Nothing changes for students unless the model's own solution agrees with the stored key and every wrong option is
// explained; disagreements go to cbt.key_reviews for a TECHMED editor.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatExplanation } from '../../apps/kairo/src/lib/explain.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const METHOD = readFileSync(path.join(here, 'techmed-method.md'), 'utf8');
const QIMG = path.join(here, '../../apps/kairo/public');
const RUNS = path.join(here, 'runs');
const MODEL = 'claude-opus-5-5';
type Key = 'A' | 'B' | 'C' | 'D' | 'E';

interface QueueItem {
  question_id: string; subject: string; year: number | null; stem_html: string; passage_html: string | null;
  options: { key: Key; html: string }[]; media_url: string | null; correct_option: Key; topic: string | null;
  existing_explanation: string | null;
}
export interface TutorResult {
  verdict: 'agree' | 'disagree' | 'ambiguous' | 'invalid'; correct_option: Key; reasoning_for_editor: string;
  concept: string; steps: string[]; why_not: { option: Key; explanation: string }[]; tip: string;
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'correct_option', 'reasoning_for_editor', 'concept', 'steps', 'why_not', 'tip'],
  properties: {
    verdict: { type: 'string', enum: ['agree', 'disagree', 'ambiguous', 'invalid'] },
    correct_option: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
    reasoning_for_editor: { type: 'string' },
    concept: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    why_not: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['option', 'explanation'],
      properties: { option: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] }, explanation: { type: 'string' } } } },
    tip: { type: 'string' },
  },
} as const;

const SUBJECTS: Record<string, string> = { ENG: 'Use of English', MTH: 'Mathematics', PHY: 'Physics', CHM: 'Chemistry', BIO: 'Biology' };
const strip = (h: string | null) => (h ?? '').replace(/<sup>(.*?)<\/sup>/g, '^($1)').replace(/<sub>(.*?)<\/sub>/g, '_($1)')
  .replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&le;/g, '≤').replace(/&ge;/g, '≥').replace(/&minus;/g, '−').replace(/&ordm;/g, '°').trim();

function buildRequest(q: QueueItem, effort: 'medium' | 'high' | 'xhigh'): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const text = [
    `Subject: ${SUBJECTS[q.subject] ?? q.subject}${q.year ? ` (UTME ${q.year})` : ''}${q.topic ? ` · Topic: ${q.topic}` : ''}`,
    q.passage_html ? `Passage:\n${strip(q.passage_html)}` : '',
    `Question:\n${strip(q.stem_html)}`,
    `Options:\n${q.options.map((o) => `${o.key}. ${strip(o.html)}`).join('\n')}`,
    `Supplied answer key: ${q.correct_option} (from a third-party source; check it).`,
    q.media_url ? 'The diagram for this question is attached.' : '',
  ].filter(Boolean).join('\n\n');
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  const img = q.media_url && /^\/qimg\/[\w.\-]+$/.test(q.media_url) ? path.join(QIMG, q.media_url) : null;
  if (img && existsSync(img)) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: readFileSync(img).toString('base64') } });
  content.push({ type: 'text', text });
  return {
    model: MODEL, max_tokens: 16000,
    system: [{ type: 'text', text: METHOD, cache_control: { type: 'ephemeral' } }],
    output_config: { effort, format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content }],
  };
}

const GENERIC = /(incorrect|wrong) (calculation|answer)\.?$|^(it|this) is (simply )?(wrong|incorrect)\.?$|distractors? represent/i;

/** Decide what to do with one result. Pure, so it can be tested and reused for imported results. */
export function decide(r: TutorResult, key: Key, optionKeys: Key[]):
  | { action: 'save'; explanation: string } | { action: 'flag'; verdict: 'disagree' | 'ambiguous' | 'invalid'; proposed: Key | null; reasoning: string }
  | { action: 'retry'; why: string } {
  if (r.verdict === 'ambiguous' || r.verdict === 'invalid') return { action: 'flag', verdict: r.verdict, proposed: null, reasoning: r.reasoning_for_editor };
  if (r.verdict === 'disagree' || r.correct_option !== key) {
    return { action: 'flag', verdict: 'disagree', proposed: r.correct_option !== key ? r.correct_option : null, reasoning: r.reasoning_for_editor };
  }
  const wrong = optionKeys.filter((k) => k !== key);
  const got = new Map(r.why_not.map((w) => [w.option, w.explanation.trim()]));
  const missing = wrong.filter((k) => !got.get(k) || got.get(k)!.length < 15 || GENERIC.test(got.get(k)!));
  if (missing.length) return { action: 'retry', why: `weak or missing why-not for ${missing.join(', ')}` };
  if ([...got.keys()].some((k) => !wrong.includes(k))) return { action: 'retry', why: 'why-not for an option that is the key or does not exist' };
  if (!r.concept.trim() || !r.steps.length || !r.tip.trim()) return { action: 'retry', why: 'missing concept, steps or tip' };
  const whyNot = Object.fromEntries(wrong.map((k) => [k, got.get(k)!]));
  return { action: 'save', explanation: formatExplanation({ concept: r.concept, steps: r.steps, whyNot, tip: r.tip }) };
}

function arg(name: string, dflt?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function db() {
  const url = process.env.SUPABASE_URL ?? 'https://unbgborbhxzsotaieiun.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role). Never commit it.');
  return createClient(url, key, { auth: { persistSession: false } }).schema('cbt');
}

async function queue(limit: number, subject?: string): Promise<QueueItem[]> {
  const { data, error } = await db().rpc('explanation_queue', { p_limit: limit, p_subject: subject ?? null });
  if (error) throw error;
  return data as QueueItem[];
}

interface Outcome { question_id: string; action: string; detail?: string }
async function apply(items: { question_id: string; key: Key; options: Key[]; result: TutorResult }[], dryRun: boolean, emitSql = false) {
  const out: Outcome[] = [];
  const sql: string[] = [];
  const lit = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  for (const it of items) {
    const d = decide(it.result, it.key, it.options);
    if (d.action === 'retry') { out.push({ question_id: it.question_id, action: 'retry', detail: d.why }); continue; }
    const p = d.action === 'save'
      ? { question_id: it.question_id, explanation: d.explanation, model: MODEL, expected_option: it.key }
      : { question_id: it.question_id, proposed_option: d.proposed, verdict: d.verdict, reasoning: d.reasoning.slice(0, 4000), model: MODEL };
    const fn = d.action === 'save' ? 'save_explanation' : 'flag_key';
    if (emitSql) sql.push(`select cbt.${fn}(${lit(p)});`);
    else if (!dryRun) {
      const { data, error } = await db().rpc(fn, { p });
      if (error || data === false) { out.push({ question_id: it.question_id, action: 'error', detail: error?.message ?? 'not written (editor-owned, key changed, or already flagged)' }); continue; }
    }
    out.push({ question_id: it.question_id, action: d.action, detail: d.action === 'flag' ? `${d.verdict}${d.proposed ? ` → ${d.proposed}` : ''}` : undefined });
  }
  const count = (a: string) => out.filter((o) => o.action === a).length;
  console.log(`saved ${count('save')} · flagged for an editor ${count('flag')} · to retry ${count('retry')} · errors ${count('error')}${dryRun ? ' (dry run)' : ''}`);
  return { out, sql };
}

async function main() {
  const cmd = process.argv[2];
  mkdirSync(RUNS, { recursive: true });
  if (cmd === 'queue') {
    const items = await queue(Number(arg('limit', '20')), arg('subject'));
    for (const q of items) console.log(`${q.subject} ${q.year ?? ''} key ${q.correct_option} ${q.media_url ? '[diagram] ' : ''}${strip(q.stem_html).slice(0, 80)}`);
    console.log(`${items.length} shown`);
  } else if (cmd === 'submit') {
    const effort = (arg('effort', 'high') as 'medium' | 'high' | 'xhigh');
    const items = await queue(Number(arg('limit', '100')), arg('subject'));
    if (!items.length) return console.log('Nothing to explain.');
    const client = new Anthropic();
    const batch = await client.messages.batches.create({
      // custom_id carries everything collect needs (question, key at submit time, number of options), so collecting
      // works from any machine or CI run without local state.
      requests: items.map((q) => ({ custom_id: `${q.question_id}_${q.correct_option}${q.options.length}`, params: buildRequest(q, effort) })),
    });
    const meta = items.map((q) => ({ question_id: q.question_id, key: q.correct_option, options: q.options.map((o) => o.key) }));
    writeFileSync(path.join(RUNS, `${batch.id}.json`), JSON.stringify({ batch: batch.id, created: new Date().toISOString(), effort, items: meta }, null, 1));
    console.log(`Batch ${batch.id}: ${items.length} questions. Collect with: npm run collect -- ${batch.id}`);
  } else if (cmd === 'collect') {
    const id = process.argv[3];
    if (!id) throw new Error('Usage: npm run collect -- <batch_id>');
    const client = new Anthropic();
    const b = await client.messages.batches.retrieve(id);
    if (b.processing_status !== 'ended') return console.log(`Still ${b.processing_status}: ${JSON.stringify(b.request_counts)}`);
    const items: Parameters<typeof apply>[0] = [];
    const failed: string[] = [];
    const usage = { input: 0, cached: 0, output: 0 };
    for await (const r of await client.messages.batches.results(id)) {
      const [qid, key, n] = [r.custom_id.slice(0, 36), r.custom_id.slice(37, 38) as Key, Number(r.custom_id.slice(38)) || 4];
      if (r.result.type !== 'succeeded') { failed.push(`${qid}: ${r.result.type}`); continue; }
      const m = r.result.message;
      usage.input += m.usage.input_tokens; usage.cached += m.usage.cache_read_input_tokens ?? 0; usage.output += m.usage.output_tokens;
      if (m.stop_reason !== 'end_turn') { failed.push(`${qid}: stop_reason ${m.stop_reason}`); continue; }
      const text = m.content.find((c): c is Anthropic.Messages.TextBlock => c.type === 'text')?.text;
      try {
        const result = JSON.parse(text ?? '') as TutorResult;
        items.push({ question_id: qid, key, options: (['A', 'B', 'C', 'D', 'E'] as Key[]).slice(0, n), result });
      } catch { failed.push(`${qid}: unreadable output`); }
    }
    const { out } = await apply(items, flag('dry-run'));
    writeFileSync(path.join(RUNS, `${id}-report.json`), JSON.stringify({ usage, failed, outcomes: out, results: items }, null, 1));
    // Batch price for this model is half the standard rate: $2 / $10 per million input / output tokens; cache reads less.
    const cost = (usage.input * 2 + usage.cached * 0.1 + usage.output * 10) / 1e6;
    console.log(`API failures ${failed.length}. Tokens in ${usage.input} (+${usage.cached} cached) out ${usage.output} ≈ $${cost.toFixed(2)}. Report: runs/${id}-report.json`);
  } else if (cmd === 'import') {
    const file = process.argv[3];
    const items = JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof apply>[0];
    const { sql } = await apply(items, flag('dry-run'), flag('emit-sql'));
    if (flag('emit-sql')) writeFileSync(file.replace(/\.json$/, '.sql'), sql.join('\n') + '\n');
  } else {
    console.log('Commands: queue | submit | collect <batch_id> | import <file.json> [--emit-sql]');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
