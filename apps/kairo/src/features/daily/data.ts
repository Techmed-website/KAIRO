import { cbt } from '../../lib/supabase';

export interface DailyQuiz { id: string; title: string; opens_at: string; time_limit_sec: number | null; question_count: number; my_best: number | null; players: number }

export async function dailyQuizzes(limit = 30): Promise<DailyQuiz[]> {
  const { data, error } = await cbt().rpc('daily_quizzes', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as DailyQuiz[];
}
/** "Day 12: Chemistry (Gas Laws)" from the full TECHMED title. */
export const shortTitle = (t: string) => t.replace(/^.*Daily Builder Quiz\s*[—–-]\s*/, '');
