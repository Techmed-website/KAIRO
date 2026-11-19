import { kvGet, kvSet } from './db';
import { cbt } from './supabase';
import type { CatalogSubject } from './types';

const TTL = 12 * 3600_000;
let mem: CatalogSubject[] | null = null;

/** Menus (counts by year and topic). Cached on the phone; refreshed twice a day. */
export async function getCatalog(): Promise<CatalogSubject[]> {
  if (mem) return mem;
  const cached = await kvGet<{ at: number; subjects: CatalogSubject[] }>('catalog');
  if (cached && Date.now() - cached.at < TTL) return (mem = cached.subjects);
  try {
    const { data, error } = await cbt().rpc('catalog');
    if (error) throw error;
    const subjects = ((data as { subjects: CatalogSubject[] }).subjects ?? []);
    await kvSet('catalog', { at: Date.now(), subjects });
    return (mem = subjects);
  } catch (e) {
    if (cached) return (mem = cached.subjects);
    throw e;
  }
}

export async function topicNames(): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  try { for (const s of await getCatalog()) for (const t of s.topics ?? []) m.set(t.id, t.name); } catch { /* offline */ }
  return m;
}
