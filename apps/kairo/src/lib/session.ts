import { db } from './db';
import { cbt } from './supabase';
import { deviceId } from './sync';
import type { LocalAttempt, OfflinePack, Paper, SubjectCode } from './types';

export type PracticeRequest =
  | { mode: 'year'; subject: SubjectCode; year: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'topic'; subject: SubjectCode; topic_ids: number[]; count?: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'mixed'; subjects: { code: SubjectCode; count: number }[]; years?: [number, number]; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'mock'; subjects: SubjectCode[] }
  | { mode: 'retry'; attempt_id: string; feedback?: 'instant' | 'end' }
  | { mode: 'review'; count?: number; subject?: SubjectCode };

/** create_practice → get_paper → start_attempt, saving everything on the phone first. Returns the attempt id. */
export async function startPractice(req: PracticeRequest): Promise<string> {
  const body: Record<string, unknown> = { ...req };
  if (body.time_limit_sec == null) delete body.time_limit_sec;
  const fn = req.mode === 'retry' ? 'create_retry' : req.mode === 'review' ? 'create_review' : 'create_practice';
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

/** Download practice sets for offline use: paper, keys and explanations, diagrams and maths fonts. Not started yet. */
export async function downloadPacks(subjects: SubjectCode[], perSubject: number, size: number, onProgress?: (done: number, total: number) => void): Promise<number> {
  const total = subjects.length * perSubject;
  let done = 0, made = 0;
  let anyMath = false;
  for (const subject of subjects) {
    for (let i = 0; i < perSubject; i++) {
      const { data, error } = await cbt().rpc('create_practice', { p: { mode: 'mixed', feedback: 'instant', subjects: [{ code: subject, count: size }] } });
      if (error) throw error;
      const { assessment_id } = data as { assessment_id: string };
      const { data: paperData, error: e2 } = await cbt().rpc('get_paper', { p_assessment: assessment_id });
      if (e2) throw e2;
      const paper = { assessment_id, ...(paperData as Omit<Paper, 'assessment_id'>) } as Paper;
      paper.questions.sort((a, b) => a.position - b.position);
      const images = [...new Set(paper.questions.map((q) => q.media_url).filter((u): u is string => !!u && u.startsWith('/qimg/')))];
      await Promise.all(images.map((u) => fetch(u).catch(() => null))); // the service worker keeps them
      anyMath ||= paper.questions.some((q) => JSON.stringify(q).includes('\\('));
      await db.papers.put(paper);
      const pack: OfflinePack = { assessment_id, title: `${subjectLabel(subject)} · ${paper.questions.length} questions`, subject,
        question_count: paper.questions.length, created_at: Date.now(), images: images.length };
      await db.packs.put(pack);
      made++; onProgress?.(++done, total);
    }
  }
  if (anyMath) await import('./render').then((m) => m.warmMath()).catch(() => {});
  return made;
}
const subjectLabel = (c: SubjectCode) => ({ ENG: 'English', MTH: 'Mathematics', PHY: 'Physics', CHM: 'Chemistry', BIO: 'Biology' })[c];

/** Start a downloaded pack. Online: registered with the server as usual. Offline: starts on the phone and syncs later. */
export async function startPack(pack: OfflinePack): Promise<string> {
  const paper = await db.papers.get(pack.assessment_id);
  if (!paper) throw new Error('This pack is no longer on the phone. Download it again.');
  const id = crypto.randomUUID();
  const local: LocalAttempt = {
    id, assessment_id: pack.assessment_id, title: pack.title, type: paper.assessment.type, instant: true, time_limit_sec: null,
    started_at: new Date().toISOString(), deadline_at: null, clock_offset_ms: 0, answers: {}, current: 0,
    status: 'in_progress', origin: 'offline', sync: 'local', updated_at: Date.now(),
  };
  await db.attempts.put(local);
  await db.packs.delete(pack.assessment_id);
  if (navigator.onLine) {
    try {
      const { data, error } = await cbt().rpc('start_attempt', { p_attempt: id, p_assessment: pack.assessment_id, p_device: deviceId() });
      if (!error) {
        const s = data as { attempt: { started_at: string } };
        await db.attempts.update(id, { origin: 'online', started_at: s.attempt.started_at });
      }
    } catch { /* stay offline; submit_attempt accepts offline practice */ }
  }
  return id;
}
