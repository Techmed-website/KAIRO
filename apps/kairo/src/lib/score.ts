import type { Answer, PaperQuestion, SubjectCode } from './types';

/** A subject score in JAMB terms: out of 100. */
export const to100 = (correct: number, total: number) => (total > 0 ? Math.round((correct / total) * 100) : 0);

export interface SubjectScore { code: SubjectCode; correct: number; total: number; answered: number; score100: number }

export function scoreBySubject(questions: PaperQuestion[], answers: Record<string, Answer>): SubjectScore[] {
  const map = new Map<SubjectCode, SubjectScore>();
  for (const q of questions) {
    const s = map.get(q.subject) ?? { code: q.subject, correct: 0, total: 0, answered: 0, score100: 0 };
    s.total++;
    const sel = answers[q.id]?.selected;
    if (sel) s.answered++;
    if (sel && q.correct_option && sel === q.correct_option) s.correct++;
    map.set(q.subject, s);
  }
  return [...map.values()].map((s) => ({ ...s, score100: to100(s.correct, s.total) }));
}

/** JAMB aggregate: the sum of four subject scores, each out of 100, so out of 400. */
export function aggregate400(subjects: SubjectScore[]): number | null {
  if (subjects.length !== 4) return null;
  return subjects.reduce((a, s) => a + s.score100, 0);
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${m} m`;
  if (m) return `${m} m ${s} s`;
  return `${s} s`;
}
export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
