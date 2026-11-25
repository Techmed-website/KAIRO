import { useEffect, useState } from 'react';
import { cbt } from '../../lib/supabase';

const PLANNER_URL = 'https://techmedng.com/dashboard?view=planner';

interface PlannedTopic { key: string; topicTitle: string; subjectName: string }
interface Week { weekNumber: number; startDate: string; endDate: string; topics: PlannedTopic[] }
interface PlanData { current_week?: Week; completed?: string[]; input?: { targetDate?: string } }

/** This week's study-planner topics, shared with the TECHMED dashboard. Ticking a topic saves to the same plan. */
export function PlannerCard() {
  const [data, setData] = useState<PlanData | null | undefined>(undefined);

  useEffect(() => {
    cbt().rpc('get_study_plan').then(({ data: r }) => setData((r as { data?: PlanData } | null)?.data ?? null), () => setData(null));
  }, []);

  if (data === undefined) return null;
  const week = data?.current_week;
  if (!data || !week?.topics?.length) {
    return (
      <a className="card card-link mock-card" href={PLANNER_URL} target="_blank" rel="noopener">
        <div className="grow">
          <p className="eyebrow">Study planner</p>
          <h3>Know what to study next</h3>
          <p className="muted small">Free. Set your exam date and subjects once and get a week-by-week route.</p>
        </div>
      </a>
    );
  }
  const done = new Set(data.completed ?? []);
  const toggle = async (key: string) => {
    const next = new Set(done);
    if (next.has(key)) next.delete(key); else next.add(key);
    const merged = { ...data, completed: [...next] };
    setData(merged);
    // Re-read first so a change made on the website meanwhile is not overwritten.
    const { data: latest } = await cbt().rpc('get_study_plan');
    const server = (latest as { data?: PlanData } | null)?.data ?? {};
    await cbt().rpc('save_study_plan', { p_data: { ...server, completed: merged.completed } });
  };
  const left = week.topics.filter((t) => !done.has(t.key)).length;
  return (
    <section className="card stack-sm">
      <div className="row-between">
        <div><p className="eyebrow">Study planner · Week {week.weekNumber}</p><h3>{left ? `${left} topic${left === 1 ? '' : 's'} left this week` : 'Week done. Nice work.'}</h3></div>
        <a className="small" href={PLANNER_URL} target="_blank" rel="noopener">Open plan</a>
      </div>
      {week.topics.map((t) => (
        <label key={t.key} className="today-item" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={done.has(t.key)} onChange={() => toggle(t.key)} />
          <span className="grow"><b>{t.topicTitle}</b><span className="muted small" style={{ display: 'block' }}>{t.subjectName}</span></span>
        </label>
      ))}
    </section>
  );
}
