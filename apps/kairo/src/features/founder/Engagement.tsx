import { useFounder } from './Founder';
import { fmtShortDay, getEngagement, num, pct, type Engagement as E } from './data';
import { CoverageNote, ErrorCard, LineChart, Loading } from './ui';
import { useLoad } from './useLoad';

export default function Engagement() {
  const { range, refreshKey } = useFounder();
  const { data, error, reload } = useLoad((fresh) => getEngagement(range, fresh), [range.from, range.to, refreshKey]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!data) return <div className="stack"><Loading h={160} /><Loading /><Loading /></div>;
  const d = data; const s = d.summary;
  const last = d.daily[d.daily.length - 1];
  const rate = pct(s.practice_completed, s.practice_started);

  return (
    <div className="stack">
      <CoverageNote range={range} since={d.coverage.attempts_since} what="records" />
      <section className="card stack-sm" aria-labelledby="h-core">
        <h2 id="h-core">Core engagement</h2>
        <div className="fi-grid2">
          <Cell label="DAU (last day)" value={num(last?.dau)} def="Unique students with qualifying activity on that Lagos day." />
          <Cell label="WAU" value={num(last?.wau)} def="Unique students active in the 7 days ending on the last day." />
          <Cell label="MAU" value={num(last?.mau)} def="Unique students active in the 30 days ending on the last day." />
          <Cell label="Active students (period)" value={num(s.active_users)} def="Unique students with qualifying activity anywhere in the period." />
          <Cell label="New users" value={num(d.daily.reduce((a, x) => a + x.new, 0))} def="Registrations in the period." />
          <Cell label="Engaged learners" value={num(s.engaged)} def="Completed at least one practice, quiz or mock AND answered 10+ questions in the period." />
          <Cell label="Active days per active student" value={s.active_days_per_user == null ? '—' : num(s.active_days_per_user)} def="Average number of distinct Lagos days each active student was active." />
          <Cell label="Questions per active student" value={s.questions_per_active == null ? '—' : num(s.questions_per_active)} def="Answered questions in the period ÷ active students." />
          <Cell label="Practice completion rate" value={rate == null ? '—' : `${rate}%`} def="Practice sessions started in the period that were submitted." />
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="h-sess">
        <h2 id="h-sess">Sessions</h2>
        <CoverageNote range={range} since={d.coverage.events_since} what="events" />
        <div className="fi-grid2">
          <Cell label="App sessions" value={d.sessions.sessions ? num(d.sessions.sessions) : '—'} def="App sessions reported by the app (a new session starts after 30 minutes of inactivity). Only counted from the day tracking started." />
          <Cell label="Average sessions per active user" value={d.sessions.per_user == null ? '—' : num(d.sessions.per_user)} def="Sessions ÷ students who reported at least one session in the period." />
          <Cell label="Average session duration" value={d.sessions.avg_minutes == null ? '—' : `${num(d.sessions.avg_minutes)} min`}
            def={`First to last event in a session, averaged over sessions with 2+ events (${num(d.sessions.measured_sessions)} measured). Time after the last event is not visible, so this is a lower bound.`} />
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="h-trend">
        <h2 id="h-trend">Daily and weekly activity</h2>
        {d.daily.length ? <LineChart title="Daily active, rolling 7-day active and returning students" labels={d.daily.map((x) => x.day)} series={[
          { key: 'dau', label: 'DAU', color: 'var(--fi-s1)', values: d.daily.map((x) => x.dau) },
          { key: 'wau', label: 'WAU (rolling 7 days)', color: 'var(--fi-s2)', values: d.daily.map((x) => x.wau) },
          { key: 'ret', label: 'Returning', color: 'var(--fi-s3)', values: d.daily.map((x) => x.returning) }]} /> : <p className="muted">No days in this period yet.</p>}
      </section>

      <Retention d={d} />
    </div>
  );
}

function Cell({ label, value, def }: { label: string; value: string; def: string }) {
  return <div className="fi-stat"><span className="num fi-stat-v">{value}</span><span className="small">{label}</span>
    <details className="fi-def"><summary>Definition</summary><p>{def}</p></details></div>;
}

function Retention({ d }: { d: E }) {
  const mature = (k: 'd1' | 'd7' | 'd30' | 'w7') => d.cohorts.filter((c) => c[k] != null);
  const agg = (k: 'd1' | 'd7' | 'd30' | 'w7') => {
    const m = mature(k); const n = m.reduce((a, c) => a + c.size, 0);
    return { rate: pct(m.reduce((a, c) => a + (c[k] ?? 0), 0), n), n };
  };
  const cell = (v: number | null, size: number) => (v == null ? <td className="fi-immature" title="Cohort too young">not yet</td>
    : <td className="num" style={{ background: `color-mix(in srgb, var(--fi-s1) ${Math.round((v / Math.max(size, 1)) * 60)}%, transparent)` }}>{pct(v, size)}% <span className="muted small">({v})</span></td>);
  return (
    <section className="card stack-sm" aria-labelledby="h-ret">
      <h2 id="h-ret">Retention by registration cohort</h2>
      <div className="fi-grid2">
        {(['d1', 'd7', 'd30'] as const).map((k) => { const a = agg(k); return (
          <div key={k} className="fi-stat"><span className="num fi-stat-v">{a.rate == null ? '—' : `${a.rate}%`}</span>
            <span className="small">Day {k.slice(1)} retention</span><span className="muted small">{a.n ? `${num(a.n)} students in mature cohorts` : 'No cohort old enough yet'}</span></div>); })}
      </div>
      {d.cohorts.length === 0 ? <p className="muted">No students registered in this period.</p> : (
        <div className="fi-table-wrap"><table className="fi-table">
          <thead><tr><th>Registered</th><th className="num">Students</th><th>Day 1</th><th>Day 7</th><th>Day 30</th><th>Within 7 days</th></tr></thead>
          <tbody>{d.cohorts.map((c) => <tr key={c.cohort}><td>{fmtShortDay(c.cohort)}</td><td className="num">{c.size}</td>
            {cell(c.d1, c.size)}{cell(c.d7, c.size)}{cell(c.d30, c.size)}{cell(c.w7, c.size)}</tr>)}</tbody>
        </table></div>
      )}
      <details className="fi-def" open><summary>How these percentages are calculated</summary>
        <p>A cohort is every student whose KAIRO profile was created on the same Lagos calendar day (day 0). <b>Day N retention</b> is the share of the cohort with qualifying activity on exactly the Nth calendar day after day 0 (calendar-day retention). <b>Within 7 days</b> is a rolling-window measure: active on any of days 1–7. A cell shows "not yet" until day N has fully passed, so young cohorts never drag the averages down. Averages above are weighted by cohort size over mature cohorts only.</p>
      </details>
    </section>
  );
}
