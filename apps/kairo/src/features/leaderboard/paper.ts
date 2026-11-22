import { kvGet, kvSet } from '../../lib/db';
import { cbt } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import type { BoardRow } from './BoardList';

export type PaperBoard =
  | { eligible: false; reason: 'instant' | 'short' }
  | {
      eligible: true; scope: 'assessment' | 'paper' | 'subjects'; title: string; question_count: number; max: number; participants: number;
      this: { rank: number; score: number; duration_sec: number | null; subject_scores: Partial<Record<SubjectCode, number>>; personal_best: boolean };
      me: (Omit<BoardRow, 'name' | 'is_me' | 'max'>) | null; rows: BoardRow[];
    };

/** Rank of one finished attempt against everyone who sat the same paper. Cached for offline viewing. */
export async function loadPaperBoard(attemptId: string, limit = 50): Promise<PaperBoard> {
  const { data, error } = await cbt().rpc('paper_board', { p_attempt: attemptId, p_limit: limit });
  if (error) {
    const cached = await kvGet<PaperBoard>(`paper:${attemptId}`);
    if (cached) return cached;
    throw error;
  }
  kvSet(`paper:${attemptId}`, data);
  return data as PaperBoard;
}

export const NOT_RANKED: Record<'instant' | 'short', string> = {
  instant: 'Practice with instant feedback is not ranked, because the answers are on your phone. Choose “answers at the end” or take a mock to get a rank.',
  short: 'Papers need at least 10 questions per subject to be ranked.',
};

export function scopeLabel(b: Extract<PaperBoard, { eligible: true }>) {
  if (b.scope === 'subjects') return `${b.max / 100}-subject papers on the same subjects, all time`;
  return `${b.title} · ${b.question_count} questions`;
}
