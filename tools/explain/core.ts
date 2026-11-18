// Provider-independent parts of the explanation pipeline: types, output schema, prompt building and the decision rules.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatExplanation } from '../../apps/kairo/src/lib/explain.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const METHOD = readFileSync(path.join(here, 'techmed-method.md'), 'utf8');
const PUBLIC_DIR = path.join(here, '../../apps/kairo/public');

export type Key = 'A' | 'B' | 'C' | 'D' | 'E';

export interface QueueItem {
  question_id: string; subject: string; year: number | null; stem_html: string; passage_html: string | null;
  options: { key: Key; html: string }[]; media_url: string | null; correct_option: Key; topic: string | null;
  existing_explanation: string | null; key_source?: string;
}
export interface TutorResult {
  verdict: 'agree' | 'disagree' | 'ambiguous' | 'invalid'; correct_option: Key; reasoning_for_editor: string;
  concept: string; steps: string[]; why_not: { option: Key; explanation: string }[]; tip: string;
}

export const SCHEMA = {
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

export const SUBJECTS: Record<string, string> = { ENG: 'Use of English', MTH: 'Mathematics', PHY: 'Physics', CHM: 'Chemistry', BIO: 'Biology' };
export const strip = (h: string | null) => (h ?? '').replace(/<sup>(.*?)<\/sup>/g, '^($1)').replace(/<sub>(.*?)<\/sub>/g, '_($1)')
  .replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&le;/g, '≤').replace(/&ge;/g, '≥').replace(/&minus;/g, '−').replace(/&ordm;/g, '°').trim();

export interface Prompt { system: string; text: string; image?: { mime: string; b64: string } }

/** The question as plain text for the model, plus its diagram (read from the app's public folder). */
export function buildPrompt(q: QueueItem, feedback?: string): Prompt {
  const confirmed = q.key_source === 'editor';
  const text = [
    `Subject: ${SUBJECTS[q.subject] ?? q.subject}${q.year ? ` (UTME ${q.year})` : ''}${q.topic ? ` · Topic: ${q.topic}` : ''}`,
    q.passage_html ? `Passage:\n${strip(q.passage_html)}` : '',
    `Question:\n${strip(q.stem_html)}`,
    `Options:\n${q.options.map((o) => `${o.key}. ${strip(o.html)}`).join('\n')}`,
    confirmed
      ? `Answer key: ${q.correct_option}. A TECHMED editor has confirmed this key. Do not dispute it: set verdict to "agree", correct_option to ${q.correct_option}, and explain why it is right.`
      : `Supplied answer key: ${q.correct_option} (from a third-party source; check it independently).`,
    q.media_url ? 'The diagram for this question is attached.' : '',
    feedback ? `Your previous answer was rejected because: ${feedback}. Write the whole answer again and fix this.` : '',
  ].filter(Boolean).join('\n\n');
  const file = q.media_url && /^\/qimg\/[\w.\-]+\.webp$/.test(q.media_url) ? path.join(PUBLIC_DIR, q.media_url) : null;
  const image = file && existsSync(file) ? { mime: 'image/webp', b64: readFileSync(file).toString('base64') } : undefined;
  return { system: METHOD, text, image };
}

const GENERIC = /(incorrect|wrong) (calculation|answer)\.?$|^(it|this) is (simply )?(wrong|incorrect)\.?$|distractors? represent/i;

/** Decide what to do with one result. Pure, so it can be tested and reused for imported results. */
export function decide(r: TutorResult, key: Key, optionKeys: Key[], confirmedKey = false):
  | { action: 'save'; explanation: string } | { action: 'flag'; verdict: 'disagree' | 'ambiguous' | 'invalid'; proposed: Key | null; reasoning: string }
  | { action: 'retry'; why: string } {
  if (confirmedKey && (r.verdict !== 'agree' || r.correct_option !== key)) return { action: 'retry', why: 'a TECHMED editor confirmed this key, but the model did not explain it' };
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


// ── Second pass: a strict editor checks the draft before anything is saved. ────────────────────────────────────────
export const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'problems'],
  properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } },
} as const;
export interface CheckResult { ok: boolean; problems: string[] }

const CHECKER = `You are a strict TECHMED editor checking an explanation before Nigerian UTME students see it.
Mark ok=false if ANY of these is true, and list each problem in one short sentence:
- a factual, scientific or grammatical error, or a wrong count, calculation or unit;
- a claim that is not supported by the question, passage or diagram, or a detail that is invented (names, plot events, dates);
- a "why not" line that is wrong, generic, or does not explain that specific option;
- the explanation does not actually show why the given answer is correct;
- the question itself is ambiguous or has more than one correct option.
If everything is correct and clear, return ok=true and no problems. Return only the JSON object.`;

export function buildCheckPrompt(q: QueueItem, explanation: string): Prompt {
  const base = buildPrompt(q);
  return { system: CHECKER, image: base.image,
    text: `${base.text.replace(/\n\nSupplied answer key:[^\n]*|\n\nAnswer key:[^\n]*/g, '')}\n\nAnswer key: ${q.correct_option}\n\nDraft explanation to check:\n${explanation}` };
}

/** Questions no model can check from the question alone: set novels, and comprehension with the passage missing. */
export function needsEditor(q: QueueItem): string | null {
  const stem = strip(q.stem_html);
  // Set texts by title, or by the characters and places their questions name without the title.
  if (/\b(novel|the life changer|lekki headmaster|in dependence|sweet sixteen|the last days at forcados|stardom|ummi|salma|kolawole abdul|adebepo)\b/i.test(stem))
    return 'Based on a set text (novel); the answer depends on the book, which is not attached. An editor with the text should confirm the key.';
  if (!q.passage_html && /\b(the passage|the extract|according to the (author|writer|passage))\b/i.test(stem))
    return 'Refers to a passage that is not attached to this question.';
  return null;
}
