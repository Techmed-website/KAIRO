import { cbt } from '../../lib/supabase';
import type { ResultConfig, SubjectCode } from '../../lib/types';

/** Calls to the staff-only quiz admin in Supabase (cbt.admin_*). Every one is checked and audited on the server. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await cbt().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type QuizType = 'challenge' | 'topic_test' | 'weekly_drill' | 'mock' | 'daily_quiz';
export const TYPE_LABEL: Record<string, string> = {
  challenge: 'Challenge', topic_test: 'Topic test', weekly_drill: 'Weekly drill', mock: 'Mock exam', daily_quiz: 'Daily quiz',
};

export interface AdminQuizRow {
  id: string; title: string; slug: string | null; type: string; status: string; opens_at: string | null; closes_at: string | null;
  featured: boolean; ranked: boolean; prize_text: string | null; day_number: number | null;
  question_count: number; attempts: number; players: number; has_passcode: boolean;
}
export interface SearchQuestion {
  id: string; subject: SubjectCode; topic: string | null; topic_id: number | null; year: number | null; status: string;
  difficulty: number | null; source: string; stem: string; diagram: boolean; passage: boolean; explained: boolean;
  key_source: string | null; flagged: boolean; last_used: string | null;
}
export interface QuizDetail {
  quiz: {
    id: string; type: QuizType; title: string; slug: string | null; description: string | null; subject: SubjectCode | null;
    topic_label: string | null; time_limit_sec: number | null; opens_at: string | null; closes_at: string | null;
    ranked: boolean; attempts_allowed: number | null; guests_allowed: boolean; shuffle_questions: boolean;
    prize_text: string | null; max_winners: number | null; result_config: ResultConfig | null; status: string;
    featured: boolean; caption: string | null; has_passcode: boolean; has_attempts: boolean; url: string; kairo_url: string;
  };
  questions: (Pick<SearchQuestion, 'id' | 'subject' | 'topic' | 'year' | 'status' | 'difficulty' | 'stem'> & { position: number })[];
}
export interface ResultRow {
  attempt_id: string; user_id: string; full_name: string; email: string | null; phone: string | null; guest: boolean;
  status: string; counts_for_rank: boolean; reject_reason: string | null; origin: string;
  score: number | null; total: number | null; pct: number | null; duration_sec: number | null;
  started_at: string; submitted_at: string | null; rank: number | null;
}
export interface SaveResult { id: string; replaced: string | null; slug: string; status: string; caption: string | null; url: string; kairo_url: string }

export const listQuizzes = (p: { type?: string; status?: string; q?: string } = {}) => rpc<AdminQuizRow[]>('admin_quiz_list', { p });
export const searchQuestions = (p: Record<string, unknown>) => rpc<SearchQuestion[]>('admin_question_search', { p });
export const quizDetail = (id: string) => rpc<QuizDetail>('admin_quiz_detail', { p_id: id });
export const quizResults = (id: string) => rpc<ResultRow[]>('admin_quiz_results', { p_id: id });
export const saveQuiz = (p: Record<string, unknown>) => rpc<SaveResult>('admin_save_quiz', { p });
export const quizAction = (id: string, action: 'publish_now' | 'close' | 'reopen' | 'archive' | 'feature' | 'unfeature' | 'duplicate') =>
  rpc<{ id: string; status?: string; duplicated_from?: string }>('admin_quiz_action', { p_id: id, p_action: action });
export const setAttempt = (attempt: string, reject: boolean, reason?: string) =>
  rpc<{ status: string }>('admin_set_attempt', { p_attempt: attempt, p_reject: reject, p_reason: reason ?? null });
export const updateQuestion = (id: string, p: { difficulty?: number | null; status?: 'retired' | 'published' }) =>
  rpc<{ status: string; difficulty: number | null }>('admin_question_update', { p_id: id, p });

/** Results as a CSV file the browser downloads (opens in Excel / Google Sheets). */
export function downloadCsv(title: string, rows: ResultRow[]) {
  const head = ['Rank', 'Name', 'Email', 'Phone', 'Score', 'Total', 'Percent', 'Time (s)', 'Status', 'Counts for rank', 'Reason', 'Guest', 'Submitted (Lagos)'];
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head, ...rows.map((r) => [r.rank, r.full_name, r.email, r.phone, r.score, r.total, r.pct, r.duration_sec, r.status,
    r.counts_for_rank ? 'yes' : 'no', r.reject_reason, r.guest ? 'yes' : 'no',
    r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : ''])].map((l) => l.map(cell).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w-]+/g, '-').slice(0, 60)}-results.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** "2026-11-30T19:00" (the phone's local time, i.e. Lagos for TECHMED staff) <-> ISO for the server. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
export const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—';
