export type OptionKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type SubjectCode = 'ENG' | 'MTH' | 'PHY' | 'CHM' | 'BIO';

export interface PaperQuestion {
  id: string; version: number; position: number;
  stem_html: string; passage_html: string | null;
  options: { key: OptionKey; html: string }[];
  subject: SubjectCode; year: number | null; media_url: string | null; topic_id: number | null;
  correct_option?: OptionKey; explanation_html?: string | null;
  explanation_source?: 'source' | 'ai_legacy' | 'ai_techmed' | 'editor';
}
export interface Assessment {
  id: string; type: 'practice' | 'topic_test' | 'daily_quiz' | 'weekly_drill' | 'mock';
  title: string; time_limit_sec: number | null;
  answers_visibility: 'per_question' | 'after_submit' | 'after_close'; ranked: boolean;
}
export interface Answer { selected: OptionKey | null; time_ms: number; flagged: boolean }

export type SyncState = 'local' | 'syncing' | 'synced' | 'failed';
export interface LocalAttempt {
  id: string; assessment_id: string; title: string; type: Assessment['type'];
  instant: boolean; time_limit_sec: number | null;
  started_at: string; deadline_at: string | null; clock_offset_ms: number;
  answers: Record<string, Answer>; current: number;
  status: 'in_progress' | 'submitted';
  submitted_at?: string; duration_sec?: number;
  origin?: 'online' | 'offline';
  sync: SyncState; server?: { status: string; score: number; total: number; reject_reason: string | null };
  updated_at: number;
}
export interface Paper { assessment_id: string; assessment: Assessment; questions: PaperQuestion[] }

export interface CatalogSubject {
  code: SubjectCode; name: string; count: number;
  years: { year: number; count: number }[] | null;
  topics: { id: number; name: string; count: number }[] | null;
}

/** A practice set downloaded for offline use: the paper is in db.papers, not started yet. */
export interface OfflinePack { assessment_id: string; title: string; subject: SubjectCode; question_count: number; created_at: number; images: number }
