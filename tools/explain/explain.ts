// KAIRO explanation pipeline: TECHMED-method explanations + independent answer-key checks.
//
//   npm run models                         list the models your Gemini key can use (pick one; limits are in AI Studio)
//   npm run queue -- --limit 20            preview what still needs explaining
//   npm run eval                           score the model on the 9 pilot questions (no database writes)
//   npm run run -- --limit 100             explain up to 100 questions and save the ones that pass validation
//     --subject CHM        only one subject            --retry-failed      include questions that failed twice
//     --model <id>         Gemini model (or GEMINI_MODEL)    --rpm 8       requests per minute (stay under your limit)
//     --escalate gemini:<model> | anthropic:<model>    second opinion before a question is flagged to an editor
//     --dry-run            do everything except write to the database
//
// Env: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY (SUPABASE_URL optional). Paid providers need ALLOW_PAID_API=yes.
// Students only ever see an explanation that passed validation and agrees with the stored answer key. Disagreements go to
// cbt.key_reviews for a TECHMED editor. Re-running is always safe: explained questions leave the queue.
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, decide, strip, type Key, type QueueItem, type TutorResult } from './core.ts';
import { anthropic, gemini, geminiModels, ProviderError, RateLimited, type Provider, type Usage } from './providers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(here, 'runs');

const arg = (name: string, dflt?: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function db() {
  const url = process.env.SUPABASE_URL ?? 'https://unbgborbhxzsotaieiun.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API → service_role). Never commit it.');
  return createClient(url, key, { auth: { persistSession: false } }).schema('cbt');
}
function geminiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('Set GEMINI_API_KEY (aistudio.google.com → Get API key, in a project WITHOUT billing so it stays free).');
  return k;
}
async function makeProvider(spec: string): Promise<Provider> {
  const [id, ...rest] = spec.split(':');
  const model = rest.join(':');
  if (!model) throw new Error(`Give a model, e.g. gemini:<model-id>. Got "${spec}". Run "npm run models" to list them.`);
  if (id === 'gemini') return gemini(model, geminiKey());
  if (id === 'anthropic') return anthropic(model);
  throw new Error(`Unknown provider "${id}" (use gemini or anthropic)`);
}
async function mainProvider(): Promise<Provider> {
  const model = arg('model') ?? process.env.GEMINI_MODEL;
  if (!model) throw new Error('Choose a Gemini model: --model <id> or GEMINI_MODEL. Run "npm run models" to see what your key can use.');
  const p = await makeProvider(`gemini:${model}`);
  const available = await geminiModels(geminiKey());
  if (!available.includes(model)) throw new Error(`"${model}" is not available to this key. Available: ${available.filter((m) => /gemini/.test(m)).join(', ')}`);
  return p;
}

// ── Rate limiting: a minimum gap between calls, one wait-and-retry on a short 429, and a clean stop on a long one. ────
class Throttle {
  private last = 0;
  constructor(private rpm: number) {}
  async wait() { const gap = 60000 / this.rpm - (Date.now() - this.last); if (gap > 0) await sleep(gap); this.last = Date.now(); }
}
export class QuotaReached extends Error {}

async function call(p: Provider, throttle: Throttle, prompt: ReturnType<typeof buildPrompt>, stats: Stats): Promise<{ result: TutorResult; usage: Usage }> {
  for (let attempt = 0; ; attempt++) {
    await throttle.wait();
    try {
      const r = await p.generate(prompt);
      stats.calls++; stats.input += r.usage.input; stats.output += r.usage.output;
      return r;
    } catch (e) {
      if (e instanceof RateLimited) {
        if (e.waitSec > 90 || attempt >= 1) throw new QuotaReached(`${p.model}: ${e.message}`);
        console.log(`  rate limited, waiting ${e.waitSec}s…`); await sleep((e.waitSec + 1) * 1000); continue;
      }
      if (e instanceof ProviderError && e.retryable && attempt < 2) { await sleep(3000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

interface Stats { calls: number; input: number; output: number; saved: number; flagged: number; retried: number; failed: number; escalated: number; started: number }
const newStats = (): Stats => ({ calls: 0, input: 0, output: 0, saved: 0, flagged: 0, retried: 0, failed: 0, escalated: 0, started: Date.now() });

type Outcome =
  | { kind: 'save'; explanation: string; note?: string }
  | { kind: 'flag'; verdict: 'disagree' | 'ambiguous' | 'invalid'; proposed: Key | null; reasoning: string }
  | { kind: 'fail'; reason: string };

/** One question end to end: ask, validate, retry weak output once, and ask a stronger model before flagging a key. */
export async function handle(q: QueueItem, main: Provider, escalate: Provider | null, throttle: Throttle, stats: Stats): Promise<Outcome> {
  const keys = q.options.map((o) => o.key);
  const confirmed = q.key_source === 'editor';
  let feedback: string | undefined;
  for (let pass = 0; pass < 2; pass++) {
    const { result } = await call(main, throttle, buildPrompt(q, feedback), stats);
    const d = decide(result, q.correct_option, keys, confirmed);
    if (d.action === 'save') return { kind: 'save', explanation: d.explanation };
    if (d.action === 'flag') {
      if (escalate) {
        stats.escalated++;
        const second = await call(escalate, throttle, buildPrompt(q), stats);
        const d2 = decide(second.result, q.correct_option, keys, confirmed);
        if (d2.action === 'save') return { kind: 'save', explanation: d2.explanation, note: `${main.model} flagged it; ${escalate.model} confirmed the key` };
        if (d2.action === 'flag') return { kind: 'flag', verdict: d2.verdict, proposed: d2.proposed, reasoning: `${escalate.model}: ${d2.reasoning} | ${main.model}: ${d.reasoning}` };
      }
      return { kind: 'flag', verdict: d.verdict, proposed: d.proposed, reasoning: d.reasoning };
    }
    feedback = d.why; stats.retried++;
  }
  return { kind: 'fail', reason: feedback ?? 'validation failed twice' };
}

async function queue(limit: number, subject?: string, includeFailed = false): Promise<QueueItem[]> {
  const { data, error } = await db().rpc('explanation_queue', { p_limit: limit, p_subject: subject ?? null, p_include_failed: includeFailed });
  if (error) throw error;
  return data as QueueItem[];
}

async function runCmd() {
  const main = await mainProvider();
  const escSpec = arg('escalate') ?? process.env.ESCALATE_MODEL;
  const escalate = escSpec ? await makeProvider(escSpec) : null;
  const limit = Number(arg('limit', '100')), dry = flag('dry-run');
  const rpm = Number(arg('rpm', process.env.RPM ?? '8'));
  const throttle = new Throttle(rpm);
  const items = await queue(limit, arg('subject'), flag('retry-failed'));
  console.log(`${main.model}${escalate ? ` (second opinion: ${escalate.id}:${escalate.model})` : ''} · ${items.length} questions · ${rpm}/min${dry ? ' · DRY RUN' : ''}`);
  const stats = newStats();
  const log: { question_id: string; subject: string; outcome: string; detail?: string }[] = [];
  let stoppedBy = '';

  for (const [i, q] of items.entries()) {
    let o: Outcome;
    try { o = await handle(q, main, escalate, throttle, stats); }
    catch (e) {
      if (e instanceof QuotaReached) { stoppedBy = e.message; break; }
      o = { kind: 'fail', reason: e instanceof Error ? e.message : String(e) };
    }
    let wrote = true;
    if (!dry) {
      const rpc = o.kind === 'save'
        ? db().rpc('save_explanation', { p: { question_id: q.question_id, explanation: o.explanation, model: `${main.id}:${main.model}`, expected_option: q.correct_option } })
        : o.kind === 'flag'
          ? db().rpc('flag_key', { p: { question_id: q.question_id, proposed_option: o.proposed, verdict: o.verdict, reasoning: o.reasoning.slice(0, 4000), model: `${main.id}:${main.model}` } })
          : Promise.resolve({ data: true, error: null });
      const { data, error } = await rpc;
      if (error) throw error;
      wrote = data !== false; // false: an editor owns it, the key changed meanwhile, or a review is already open
      await db().rpc('record_try', { p: { question_id: q.question_id, ok: o.kind !== 'fail', reason: o.kind === 'fail' ? o.reason : null, provider: main.id, model: main.model } });
    }
    if (o.kind === 'save') stats.saved++; else if (o.kind === 'flag') stats.flagged++; else stats.failed++;
    log.push({ question_id: q.question_id, subject: q.subject, outcome: o.kind + (wrote ? '' : ' (not written)'),
      detail: o.kind === 'fail' ? o.reason : o.kind === 'flag' ? `${o.verdict}${o.proposed ? ` → ${o.proposed}` : ''}` : o.note });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${items.length} · saved ${stats.saved} · flagged ${stats.flagged} · failed ${stats.failed}`);
  }
  report(main, stats, log, stoppedBy, items.length, dry);
}

function report(main: Provider, s: Stats, log: object[], stoppedBy: string, queued: number, dry: boolean) {
  mkdirSync(RUNS, { recursive: true });
  const secs = Math.round((Date.now() - s.started) / 1000);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(path.join(RUNS, `run-${stamp}.json`), JSON.stringify({ model: `${main.id}:${main.model}`, queued, ...s, seconds: secs, stoppedBy, log }, null, 1));
  const line = `saved ${s.saved} · flagged for an editor ${s.flagged} · failed ${s.failed} (will retry) · retried inside a question ${s.retried} · ${s.calls} calls · ${s.input.toLocaleString()} tokens in, ${s.output.toLocaleString()} out · ${secs}s`;
  console.log(line);
  if (stoppedBy) console.log(`Stopped early because the quota is used up (${stoppedBy}). Run again later; nothing is lost.`);
  if (dry) console.log('Dry run: nothing was written.');
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### KAIRO explanations${dry ? ' (dry run)' : ''}\n\n| | |\n|---|---|\n| Model | \`${main.id}:${main.model}\` |\n| Questions in this run | ${queued} |\n| Saved | ${s.saved} |\n| Flagged for an editor | ${s.flagged} |\n| Failed (retry later) | ${s.failed} |\n| API calls | ${s.calls} |\n| Tokens in / out | ${s.input.toLocaleString()} / ${s.output.toLocaleString()} |\n| Time | ${secs}s |\n${stoppedBy ? `\n**Stopped early:** quota used up (${stoppedBy}).\n` : ''}`);
}

// ── eval: how good is this model on questions whose right answer I worked out by hand? ───────────────────────────────
async function evalCmd() {
  const main = await mainProvider();
  const throttle = new Throttle(Number(arg('rpm', process.env.RPM ?? '8')));
  const gold = JSON.parse(readFileSync(path.join(here, 'pilot/pilot-questions.json'), 'utf8')) as (QueueItem & { gold: 'agree' | 'flag' })[];
  const stats = newStats();
  let match = 0;
  for (const q of gold) {
    try {
      const { result } = await call(main, throttle, buildPrompt(q), stats);
      const d = decide(result, q.correct_option, q.options.map((o) => o.key));
      const got = d.action === 'flag' ? 'flag' : result.verdict === 'agree' && result.correct_option === q.correct_option ? 'agree' : 'other';
      const ok = got === q.gold; if (ok) match++;
      console.log(`${ok ? 'ok  ' : 'MISS'} ${q.subject} expected ${q.gold}, got ${got} (${result.verdict}${d.action === 'retry' ? `, would retry: ${d.why}` : ''}) · ${strip(q.stem_html).slice(0, 50)}`);
      if (flag('show') && d.action === 'save') console.log(d.explanation.split('\n').map((l) => '     ' + l).join('\n'));
    } catch (e) { console.log(`ERR  ${q.subject} ${e instanceof Error ? e.message : e}`); if (e instanceof QuotaReached) break; }
  }
  console.log(`${match}/${gold.length} match my hand-checked pilot. ${stats.calls} calls, ${stats.input.toLocaleString()} tokens in, ${stats.output.toLocaleString()} out.`);
  console.log('Add --show to print the explanations it writes, and read them: this score checks keys, not teaching quality.');
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'models') { for (const m of await geminiModels(geminiKey())) if (/gemini/.test(m)) console.log(m); }
  else if (cmd === 'queue') {
    const items = await queue(Number(arg('limit', '20')), arg('subject'), flag('retry-failed'));
    for (const q of items) console.log(`${q.subject} ${q.year ?? ''} key ${q.correct_option}${q.key_source === 'editor' ? ' (editor-confirmed)' : ''} ${q.media_url ? '[diagram] ' : ''}${strip(q.stem_html).slice(0, 80)}`);
    console.log(`${items.length} shown`);
  } else if (cmd === 'run') await runCmd();
  else if (cmd === 'eval') await evalCmd();
  else console.log('Commands: models | queue | eval | run   (see the top of explain.ts)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
export { Throttle, newStats };
