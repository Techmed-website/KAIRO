import Dexie, { type Table } from 'dexie';
import type { LocalAttempt, OfflinePack, Paper } from './types';

export interface OutboxItem { id: string; payload: unknown; tries: number; next_at: number }
export interface KV { key: string; value: unknown }

class KairoDB extends Dexie {
  attempts!: Table<LocalAttempt, string>;
  papers!: Table<Paper, string>;
  outbox!: Table<OutboxItem, string>;
  kv!: Table<KV, string>;
  packs!: Table<OfflinePack, string>;
  constructor() {
    super('kairo');
    this.version(1).stores({
      attempts: 'id, status, updated_at, sync',
      papers: 'assessment_id',
      outbox: 'id, next_at',
      kv: 'key',
    });
    this.version(2).stores({ packs: 'assessment_id, subject, created_at' });
  }
}
export const db = new KairoDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export const kvSet = (key: string, value: unknown) => db.kv.put({ key, value });
