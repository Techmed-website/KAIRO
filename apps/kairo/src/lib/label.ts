import type { PaperQuestion } from './types';

/**
 * How a question is labelled to students. Only questions with a verified JAMB year are called past questions;
 * TECHMED's own questions say so; anything else is a plain practice question.
 */
export function questionLabel(q: Pick<PaperQuestion, 'year' | 'source'>): string {
  if (q.source === 'techmed') return 'TECHMED Practice Question';
  if (q.year && (q.source == null || q.source === 'jamb')) return `JAMB Past Question, ${q.year}`;
  return 'Practice Question';
}
