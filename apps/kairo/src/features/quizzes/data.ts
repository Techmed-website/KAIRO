import { cbt } from '../../lib/supabase';

/** KAIRO's Quizzes section (cbt.quiz_hub / cbt.quiz_page). Your own numbers come back only when signed in. */
export interface MyQuiz { attempts: number; best: number | null; last_attempt_id: string | null; in_progress_id: string | null; ranked_attempt_id: string | null; rank: number | null }
export interface QuizCard {
  id: string; slug: string | null; title: string; description: string | null; type: string; subject: string | null;
  topic_label: string | null; day_number: number | null; question_count: number; time_limit_sec: number | null;
  opens_at: string | null; closes_at: string | null; status: string; featured: boolean; ranked: boolean; guests_allowed: boolean;
  prize_text: string | null; max_winners: number | null; has_passcode: boolean; players: number; url: string; me: MyQuiz | null;
}
export interface BoardRow { rank: number; name: string; score: number; total: number; duration_sec: number | null; is_me: boolean }
export interface Hub { today: QuizCard | null; challenges: QuizCard[]; recent: QuizCard[] }

export async function loadHub(): Promise<Hub> {
  const { data, error } = await cbt().rpc('quiz_hub');
  if (error) throw error;
  return data as Hub;
}
export async function loadQuiz(id: string): Promise<(QuizCard & { board: BoardRow[]; ranked_count?: number; guest_players?: number }) | null> {
  const { data, error } = await cbt().rpc('quiz_page', { p_id: id, p_limit: 50 });
  if (error) throw error;
  return data as (QuizCard & { board: BoardRow[] }) | null;
}

/** "Day 15: Physics" + "Motion" from a daily title; other quizzes keep their title. */
export function split(q: Pick<QuizCard, 'type' | 'title'>): { heading: string; sub: string | null } {
  const m = q.type === 'daily_quiz' ? q.title.match(/—\s*(Day \d+:\s*[^(]+?)\s*\((.+)\)\s*$/) : null;
  return m ? { heading: m[1], sub: m[2] } : { heading: q.title, sub: null };
}
export const quizState = (q: QuizCard, now = Date.now()): 'open' | 'soon' | 'closed' =>
  q.status === 'closed' || q.status === 'archived' || (q.closes_at && Date.parse(q.closes_at) <= now) ? 'closed'
    : q.status === 'scheduled' || (q.opens_at && Date.parse(q.opens_at) > now) ? 'soon' : 'open';
export const mins = (s: number | null) => (s ? `${Math.round(s / 60)} min` : 'untimed');
export const mmss = (s: number | null) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }) : '');
