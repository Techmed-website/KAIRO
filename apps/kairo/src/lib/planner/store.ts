// The student's study plan, shared with the TECHMED dashboard planner through cbt.study_plans
// (cbt.get_study_plan / cbt.save_study_plan). Same JSON fields as the website's plannerSync.ts:
//   input (PlannerInput), completed (topic keys), notes (key → text), snapshot, current_week (WeekPlan).
// Fields this app does not own are always kept. Offline: the last copy is read from the phone, and a change
// made offline is saved on the phone and sent the next time the plan loads online.
import { kvGet, kvSet } from '../db';
import { cbt } from '../supabase';
import type { PlannerInput, PlanSnapshot, WeekPlan } from './engine';

export interface PlanBlob {
  input?: PlannerInput;
  completed?: string[];
  notes?: Record<string, string>;
  snapshot?: PlanSnapshot;
  current_week?: WeekPlan;
  [field: string]: unknown;
}
export const PLANNER_FIELDS = ['input', 'completed', 'notes', 'snapshot', 'current_week'] as const;

const CACHE = 'study-plan';
const PENDING = 'study-plan-pending';

async function serverBlob(): Promise<PlanBlob> {
  const { data, error } = await cbt().rpc('get_study_plan');
  if (error) throw error;
  return ((data as { data?: PlanBlob } | null)?.data ?? {}) as PlanBlob;
}

export function apply(base: PlanBlob, patch: Partial<Record<string, unknown>>): PlanBlob {
  const out: PlanBlob = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete out[k]; else out[k] = v; }
  return out;
}

/** The plan, from the server when online (sending any change made offline first), else from the phone. */
export async function loadPlan(): Promise<{ blob: PlanBlob; offline: boolean }> {
  try {
    const pending = await kvGet<Partial<PlanBlob>>(PENDING);
    let blob = await serverBlob();
    if (pending) {
      blob = apply(blob, pending);
      const { error } = await cbt().rpc('save_study_plan', { p_data: blob });
      if (!error) await kvSet(PENDING, null);
    }
    await kvSet(CACHE, blob);
    return { blob, offline: false };
  } catch {
    const cached = (await kvGet<PlanBlob>(CACHE).catch(() => undefined)) ?? {};
    const pending = await kvGet<Partial<PlanBlob>>(PENDING).catch(() => undefined);
    return { blob: pending ? apply(cached, pending) : cached, offline: true };
  }
}

/**
 * Change some fields (null removes a field). Re-reads the server copy first so a change made on the website
 * meanwhile is kept, then saves. Returns the plan as saved, or the local copy when offline.
 */
let chain: Promise<unknown> = Promise.resolve();
export function savePlan(patch: Partial<Record<keyof PlanBlob, unknown>>): Promise<PlanBlob> {
  // One save at a time: each re-reads the server copy, so two quick ticks must not overlap and lose one.
  const run = chain.then(() => saveNow(patch));
  chain = run.catch(() => {});
  return run;
}

async function saveNow(patch: Partial<Record<keyof PlanBlob, unknown>>): Promise<PlanBlob> {
  try {
    const next = apply(await serverBlob(), patch);
    const { error } = await cbt().rpc('save_study_plan', { p_data: next });
    if (error) throw error;
    await kvSet(CACHE, next);
    return next;
  } catch {
    const pending = (await kvGet<Partial<PlanBlob>>(PENDING).catch(() => undefined)) ?? {};
    const merged = { ...pending, ...patch };
    await kvSet(PENDING, merged);
    const cached = (await kvGet<PlanBlob>(CACHE).catch(() => undefined)) ?? {};
    return apply(cached, merged);
  }
}
