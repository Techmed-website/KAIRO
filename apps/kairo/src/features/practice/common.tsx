import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCatalog } from '../../lib/catalog';
import { startPractice, type PracticeRequest } from '../../lib/session';
import { cbt, friendlyError, supabase } from '../../lib/supabase';
import type { CatalogSubject, SubjectCode } from '../../lib/types';
import { toast } from '../../ui/components';
import './practice.css';

export function useCatalog() {
  const [cat, setCat] = useState<CatalogSubject[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { getCatalog().then(setCat).catch((e) => setErr(friendlyError(e))); }, []);
  return { cat, err };
}

/** Question-bank order on Practice (the brief's order). */
export const BANK_ORDER: SubjectCode[] = ['ENG', 'PHY', 'CHM', 'BIO', 'MTH'];

export interface TopicStat { topic_id: number; attempted: number; correct: number; last_attempt_at: string | null }

/** The signed-in student's own answers per topic (cbt.topic_stats). Filtered by user id: staff can read everyone's rows. */
export async function myTopicStats(): Promise<TopicStat[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data, error } = await cbt().from('topic_stats').select('topic_id,attempted,correct,last_attempt_at').eq('user_id', session.user.id);
  if (error) throw error;
  return (data ?? []) as TopicStat[];
}

export function useTopicStats() {
  const [stats, setStats] = useState<Map<number, TopicStat> | null>(null);
  useEffect(() => { myTopicStats().then((l) => setStats(new Map(l.map((t) => [t.topic_id, t])))).catch(() => setStats(new Map())); }, []);
  return stats;
}

export function useStart() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async (req: PracticeRequest) => {
    setBusy(true);
    try { nav(`/cbt/${await startPractice(req)}`); }
    catch (e) { toast(friendlyError(e)); setBusy(false); }
  };
  return { busy, start };
}

export interface Opts { feedback: 'instant' | 'end'; timed: boolean }
/** JAMB pace: about 45 seconds a question (180 in 2 hours = 40 s). */
export const suggestedSec = (n: number) => Math.max(5, Math.round((n * 45) / 60)) * 60;

export function OptionsPicker({ value, onChange, count }: { value: Opts; onChange: (o: Opts) => void; count: number }) {
  return (
    <div className="stack-sm">
      <div className="opt-row">
        <span className="small"><b>Answers</b></span>
        <div className="tabs" role="tablist" aria-label="When to see answers">
          <button role="tab" aria-selected={value.feedback === 'instant'} onClick={() => onChange({ ...value, feedback: 'instant' })}>After each question</button>
          <button role="tab" aria-selected={value.feedback === 'end'} onClick={() => onChange({ ...value, feedback: 'end' })}>At the end</button>
        </div>
        <span className="muted small">{value.feedback === 'end' ? 'Counts for the leaderboard (10+ questions per subject).' : 'Learning mode: see each answer as you go. Not ranked.'}</span>
      </div>
      <div className="opt-row">
        <span className="small"><b>Timer</b></span>
        <div className="tabs" role="tablist" aria-label="Timer">
          <button role="tab" aria-selected={!value.timed} onClick={() => onChange({ ...value, timed: false })}>Untimed</button>
          <button role="tab" aria-selected={value.timed} onClick={() => onChange({ ...value, timed: true })}>Timed · {Math.round(suggestedSec(count) / 60)} min</button>
        </div>
      </div>
    </div>
  );
}

export const CatalogError = ({ err }: { err: string }) => <p className="card error">{err}</p>;
export const Skel = ({ h = 56, n = 4 }: { h?: number; n?: number }) => (
  <div className="stack-sm">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</div>
);
