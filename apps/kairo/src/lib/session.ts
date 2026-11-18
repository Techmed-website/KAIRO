import { db } from './db';
import { cbt } from './supabase';
import { deviceId } from './sync';
import type { LocalAttempt, Paper, SubjectCode } from './types';

export type PracticeRequest =
  | { mode: 'year'; subject: SubjectCode; year: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'topic'; subject: SubjectCode; topic_ids: number[]; count?: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'mixed'; subjects: { code: SubjectCode; count: number }[]; years?: [number, number]; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'mock'; subjects: SubjectCode[] }
  | { mode: 'retry'; attempt_id: string; feedback?: 'instant' | 'end' };

/** create_practice → get_paper → start_attempt, saving everything on the phone first. Returns the attempt id. */
export async function startPractice(req: PracticeRequest): Promise<string> {
  const body: Record<string, unknown> = { ...req };
  if (body.time_limit_sec == null) delete body.time_limit_sec;
  const fn = req.mode === 'retry' ? 'create_retry' : 'create_practice';
  const { data: created, error: e1 } = await cbt().rpc(fn, { p: body });
  if (e1) throw e1;
  const { assessment_id, title } = created as { assessment_id: string; title: string };
  return startAssessment(assessment_id, title);
}

export async function startAssessment(assessment_id: string, title?: string): Promise<string> {
  const id = crypto.randomUUID();
  const { data: paperData, error: e2 } = await cbt().rpc('get_paper', { p_assessment: assessment_id });
  if (e2) throw e2;
  const paper = { assessment_id, ...(paperData as Omit<Paper, 'assessment_id'>) } as Paper;
  paper.questions.sort((a, b) => a.position - b.position);
  await db.papers.put(paper);

  const local: LocalAttempt = {
    id, assessment_id, title: title ?? paper.assessment.title, type: paper.assessment.type,
    instant: paper.assessment.answers_visibility === 'per_question',
    time_limit_sec: paper.assessment.time_limit_sec,
    started_at: new Date().toISOString(), deadline_at: null, clock_offset_ms: 0,
    answers: {}, current: 0, status: 'in_progress', sync: 'local', updated_at: Date.now(),
  };
  await db.attempts.put(local); // saved on the phone before the server knows about it

  const t0 = Date.now();
  const { data: st, error: e3 } = await cbt().rpc('start_attempt', { p_attempt: id, p_assessment: assessment_id, p_device: deviceId() });
  if (e3) throw e3;
  const s = st as { attempt: { started_at: string; deadline_at: string | null }; server_now: string };
  const rtt = Date.now() - t0;
  const offset = new Date(s.server_now).getTime() - (t0 + rtt / 2); // server minus phone clock
  await db.attempts.update(id, { started_at: s.attempt.started_at, deadline_at: s.attempt.deadline_at, clock_offset_ms: offset });
  return id;
}

export async function activeAttempt(): Promise<LocalAttempt | undefined> {
  const list = await db.attempts.where('status').equals('in_progress').toArray();
  return list.sort((a, b) => b.updated_at - a.updated_at)[0];
}
