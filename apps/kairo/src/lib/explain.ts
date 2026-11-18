import type { OptionKey } from './types';

export interface ParsedExplanation { main: string; whyNot: Partial<Record<OptionKey, string>> }

const MARKER = /^\s*Why the other options are wrong:\s*$/im;

/** Split `explanation_html` into the main explanation and per-option "why not" lines. */
export function parseExplanation(text: string | null | undefined): ParsedExplanation | null {
  if (!text || !text.trim()) return null;
  const m = MARKER.exec(text);
  if (!m) return { main: text.trim(), whyNot: {} };
  const main = text.slice(0, m.index).trim();
  const whyNot: Partial<Record<OptionKey, string>> = {};
  let last: OptionKey | null = null;
  for (const raw of text.slice(m.index + m[0].length).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const opt = /^\(?([A-E])[):.\-]\s*(.*)$/.exec(line);
    if (opt) { last = opt[1] as OptionKey; whyNot[last] = opt[2].trim(); }
    else if (last) whyNot[last] = `${whyNot[last]} ${line}`;
  }
  return { main, whyNot };
}
