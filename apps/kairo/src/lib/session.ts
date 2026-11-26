import { db } from './db';
import { cbt } from './supabase';
import { deviceId } from './sync';
import type { Answer, LocalAttempt, OfflinePack, OptionKey, Paper, SubjectCode } from './types';

export type PracticeRequest =
  | { mode: 'year'; subject: SubjectCode; year: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'topic'; subject: SubjectCode; topic_ids: number[]; count?: number; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
  | { mode: 'mixed'; subjects: { code: SubjectCode; count: number }[]; years?: [number, number]; topic_ids?: number[]; feedback?: 'instant' | 'end'; time_limit_sec?: number | null }
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

/** The quiz is private and the passcode was missing or wrong. */
export class PasscodeError extends Error {}

/**
 * Start (or resume) an assessment. The server goes first: ranked and passcode-protected quizzes only hand out their
 * paper once the attempt exists, and if this student already has an unfinished attempt (another phone, cleared
 * storage) the server hands that one back, with the answers saved so far, and the clock is not reset.
 */
export async function startAssessment(assessment_id: string, title?: string, passcode?: string): Promise<string> {
  const t0 = Date.now();
  const args: Record<string, unknown> = { p_attempt: crypto.randomUUID(), p_assessment: assessment_id, p_device: deviceId() };
  if (passcode) args.p_passcode = passcode;
  const { data: st, error: e1 } = await cbt().rpc('start_attempt', args);
  if (e1) {
    if (e1.code === '28P01') throw new PasscodeError(passcode ? 'That passcode is not right. Check it and try again.' : 'This is a private challenge. Enter the passcode to start.');
    throw e1;
  }
  const rtt = Date.now() - t0;
  const s = st as {
    attempt: { id: string; started_at: string; deadline_at: string | null; shuffle_seed: number | null };
    server_now: string; resumed: boolean;
    answers?: { question_id: string; selected: OptionKey | null; time_ms: number | null; flagged: boolean | null }[];
  };
  const id = s.attempt.id;
  const offset = new Date(s.server_now).getTime() - (t0 + rtt / 2); // server minus phone clock

  // Already on this phone (refresh, back button): the local copy has the freshest answers.
  const mine = await db.attempts.get(id);
  if (mine && (await db.papers.get(mine.assessment_id))) {
    await db.attempts.update(id, { deadline_at: s.attempt.deadline_at, clock_offset_ms: offset });
    return id;
  }

  const { data: paperData, error: e2 } = await cbt().rpc('get_paper', { p_assessment: assessment_id });
  if (e2) throw e2;
  const paper = { assessment_id, ...(paperData as Omit<Paper, 'assessment_id'>) } as Paper;
  paper.questions.sort((a, b) => a.position - b.position);
  if (paper.assessment.shuffle_questions && s.attempt.shuffle_seed != null) {
    paper.questions = seededShuffle(paper.questions, s.attempt.shuffle_seed).map((q, i) => ({ ...q, position: i + 1 }));
  }
  await db.papers.put(paper);

  const answers: Record<string, Answer> = {};
  for (const x of s.answers ?? []) answers[x.question_id] = { selected: x.selected, time_ms: x.time_ms ?? 0, flagged: !!x.flagged };
  const local: LocalAttempt = {
    id, assessment_id, title: title ?? paper.assessment.title, type: paper.assessment.type,
    instant: paper.assessment.answers_visibility === 'per_question',
    time_limit_sec: paper.assessment.time_limit_sec,
    started_at: s.attempt.started_at, deadline_at: s.attempt.deadline_at, clock_offset_ms: offset,
    answers, current: 0, status: 'in_progress', sync: 'local', updated_at: Date.now(),
  };
  await db.attempts.put(local);
  return id;
}

/** Same order for the same seed: a resumed attempt shows the questions in the order the student first saw. */
function seededShuffle<T>(list: T[], seed: number): T[] {
  let x = seed >>> 0 || 1;
  const rand = () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Autosave the answers to the server while the clock runs (so another phone can carry on). Best effort, never blocks. */
export async function saveAnswersRemote(a: LocalAttempt) {
  if (!navigator.onLine || a.status !== 'in_progress' || !a.deadline_at) return;
  if (Date.now() + a.clock_offset_ms > new Date(a.deadline_at).getTime()) return;
  const answers = Object.entries(a.answers).map(([question_id, x]) => ({ question_id, selected: x.selected, time_ms: Math.round(x.time_ms), flagged: x.flagged }));
  await cbt().rpc('save_answers', { p_attempt: a.id, p_answers: answers });
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
