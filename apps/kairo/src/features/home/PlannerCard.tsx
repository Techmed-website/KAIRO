import { useEffect, useState } from 'react';
import { cbt } from '../../lib/supabase';
import { IcArrowRight, IcCalendar } from '../../ui/icons';

const PLANNER_URL = 'https://techmedng.com/dashboard?view=planner';

interface PlannedTopic { key: string; topicTitle: string; subjectName: string }
interface Week { weekNumber: number; startDate: string; endDate: string; topics: PlannedTopic[] }
interface PlanData { current_week?: Week; completed?: string[]; input?: { targetDate?: string } }

/** Study planner: an invitation until a plan exists, then this week's topics (shared with the TECHMED dashboard). */
export function PlannerCard() {
  const [data, setData] = useState<PlanData | null | undefined>(undefined);

  useEffect(() => {
    cbt().rpc('get_study_plan').then(({ data: r }) => setData((r as { data?: PlanData } | null)?.data ?? null), () => setData(null));
  }, []);

  if (data === undefined) return null;
  const week = data?.current_week;
  if (!data || !week?.topics?.length) {
    return (
      <section className="planner" aria-labelledby="h-planner">
        <div className="planner-top"><p className="eyebrow">Study planner</p><IcCalendar /></div>
        <h3 id="h-planner">Know what to study next.</h3>
        <p className="muted small">Set your examination date and subjects to receive a personalised week-by-week study route.</p>
        <a className="planner-link" href={PLANNER_URL} target="_blank" rel="noopener">Open study planner <IcArrowRight /></a>
      </section>
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
  const left = week.topics.filter((t) => !done.has(t.key));
  return (
    <section className="planner" aria-labelledby="h-planner">
      <div className="planner-top"><p className="eyebrow">Study planner · Week {week.weekNumber}</p><IcCalendar /></div>
      <h3 id="h-planner">{left.length ? `Next: ${left[0].topicTitle}` : 'Week done. Nice work.'}</h3>
      <p className="muted small">{left.length ? `${left[0].subjectName} · ${left.length} topic${left.length === 1 ? '' : 's'} left this week` : 'Open the planner to see what comes next.'}</p>
      <div>
        {week.topics.map((t) => (
          <label key={t.key} className="today-item" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={done.has(t.key)} onChange={() => toggle(t.key)} />
            <span className="grow"><b>{t.topicTitle}</b><span className="muted small" style={{ display: 'block' }}>{t.subjectName}</span></span>
          </label>
        ))}
      </div>
      <a className="planner-link" href={PLANNER_URL} target="_blank" rel="noopener">Open study planner <IcArrowRight /></a>
    </section>
  );
}
