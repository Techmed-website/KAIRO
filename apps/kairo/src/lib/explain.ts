import type { OptionKey } from './types';

/**
 * Explanation text format (stored in cbt.question_keys.explanation; plain text, line-based).
 * Legacy explanations are just free text, optionally followed by the why-not block. The TECHMED format adds headed
 * sections, each optional:
 *
 *   Concept: <the principle being tested>
 *   Steps:
 *   1. <step>
 *   2. <step>
 *   Why the other options are wrong:
 *   A: <why A is wrong>
 *   TECHMED TIP: <one-line takeaway>
 *
 * Any text before the first heading is kept as `main`.
 */
export interface ParsedExplanation {
  main: string; concept?: string; steps?: string[]; tip?: string;
  whyNot: Partial<Record<OptionKey, string>>;
}

const WHY = /^\s*Why the other options are wrong:\s*$/i;
const TIP = /^\s*TECHMED TIP:\s*(.*)$/i;
const CONCEPT = /^\s*(?:Concept|Understanding the concept):\s*(.*)$/i;
const STEPS = /^\s*(?:Steps|Step[- ]by[- ]step(?: explanation)?|Explanation):\s*(.*)$/i;

export function parseExplanation(text: string | null | undefined): ParsedExplanation | null {
  if (!text || !text.trim()) return null;
  const out: ParsedExplanation = { main: '', whyNot: {} };
  type Sec = 'main' | 'concept' | 'steps' | 'why' | 'tip';
  let sec: Sec = 'main';
  let last: OptionKey | null = null;
  const main: string[] = [], concept: string[] = [], steps: string[] = [], tip: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (WHY.test(line)) { sec = 'why'; continue; }
    if ((m = TIP.exec(line))) { sec = 'tip'; if (m[1]) tip.push(m[1]); continue; }
    if ((m = CONCEPT.exec(line))) { sec = 'concept'; if (m[1]) concept.push(m[1]); continue; }
    if ((m = STEPS.exec(line))) { sec = 'steps'; if (m[1]) steps.push(m[1]); continue; }
    if (sec === 'why') {
      if (!line) continue;
      const opt = /^\(?([A-E])[):.\-]\s*(.*)$/.exec(line);
      if (opt) { last = opt[1] as OptionKey; out.whyNot[last] = opt[2].trim(); }
      else if (last) out.whyNot[last] = `${out.whyNot[last]} ${line}`;
      continue;
    }
    if (sec === 'steps') { if (line) steps.push(line.replace(/^\d+[.)]\s*/, '')); continue; }
    (sec === 'concept' ? concept : sec === 'tip' ? tip : main).push(raw.trimEnd());
  }
  out.main = main.join('\n').trim();
  if (concept.join('').trim()) out.concept = concept.join('\n').trim();
  if (steps.length) out.steps = steps;
  if (tip.join('').trim()) out.tip = tip.join(' ').trim();
  if (!out.main && !out.concept && !out.steps && !out.tip && !Object.keys(out.whyNot).length) return null;
  return out;
}

/** Build the stored text from structured parts (used by the explanation pipeline). */
export function formatExplanation(p: { concept: string; steps: string[]; whyNot: Partial<Record<OptionKey, string>>; tip: string }): string {
  const lines = [`Concept: ${p.concept.trim()}`, 'Steps:', ...p.steps.map((s, i) => `${i + 1}. ${s.trim()}`), 'Why the other options are wrong:'];
  for (const k of Object.keys(p.whyNot).sort() as OptionKey[]) lines.push(`${k}: ${p.whyNot[k]!.trim()}`);
  lines.push(`TECHMED TIP: ${p.tip.trim()}`);
  return lines.join('\n');
}
