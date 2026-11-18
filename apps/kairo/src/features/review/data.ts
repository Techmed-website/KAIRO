import { db } from '../../lib/db';
import { cbt } from '../../lib/supabase';
import type { Answer, LocalAttempt, OptionKey, PaperQuestion } from '../../lib/types';

export interface ReviewData {
  attempt: LocalAttempt | null; title: string; type: string;
  questions: PaperQuestion[]; answers: Record<string, Answer>;
  server?: { score: number; total: number; duration_sec: number | null; submitted_at: string | null };
}

/** Prefer the copy on the phone (works offline); otherwise ask the server (another device, or a cleared phone). */
export async function loadReview(id: string): Promise<ReviewData | null> {
  const a = await db.attempts.get(id);
  if (a) {
    const p = await db.papers.get(a.assessment_id);
    if (p) return { attempt: a, title: a.title, type: a.type, questions: p.questions, answers: a.answers };
  }
  const { data, error } = await cbt().rpc('get_review', { p_attempt: id });
  if (error) throw error;
  const r = data as {
    attempt: { score: number; total: number; duration_sec: number | null; submitted_at: string | null; assessment_id: string };
    items: (Omit<PaperQuestion, 'version' | 'position'> & { question_id: string; selected: OptionKey | null; flagged: boolean })[];
  };
  const { data: as } = await cbt().from('assessments').select('title,type').eq('id', r.attempt.assessment_id).maybeSingle();
  const questions: PaperQuestion[] = (r.items ?? []).map((it, i) => ({
    ...it, id: it.question_id, version: 0, position: i + 1,
    subject: it.subject ?? ('ENG' as const), year: it.year ?? null, media_url: it.media_url ?? null, topic_id: it.topic_id ?? null,
  }));
  const answers: Record<string, Answer> = Object.fromEntries(
    (r.items ?? []).map((it) => [it.question_id, { selected: it.selected, flagged: it.flagged, time_ms: 0 }]));
  return { attempt: a ?? null, title: as?.title ?? 'Practice', type: as?.type ?? 'practice', questions, answers, server: r.attempt };
}
