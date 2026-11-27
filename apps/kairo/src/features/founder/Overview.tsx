import { useState } from 'react';
import { useFounder } from './Founder';
import { FEATURE_LABEL, fmtDay, fmtRange, getFeatures, getGuests, getOverview, num, pct, type GuestReport, type FeatureRow, type Kpis, type Overview as O } from './data';
import { CoverageNote, Delta, ErrorCard, Kpi, LineChart, Loading, type Series } from './ui';
import { useLoad } from './useLoad';

const COLORS = { registrations: 'var(--fi-s1)', active: 'var(--fi-s2)', returning: 'var(--fi-s3)' };

export default function Overview() {
  const { range, refreshKey } = useFounder();
  const { data, error, loading, reload } = useLoad(async (fresh) => {
    const [o, f, g] = await Promise.all([getOverview(range, fresh), getFeatures(range, fresh), getGuests(range, fresh).catch(() => null)]);
    return { o, f: f.current, g };
  }, [range.from, range.to, refreshKey]);
  const [show, setShow] = useState({ registrations: true, active: true, returning: true });

  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!data) return <div className="stack"><div className="fi-kpis">{Array.from({ length: 8 }, (_, i) => <Loading key={i} h={130} />)}</div><Loading /></div>;
  const { o, f, g } = data;
  const c = o.current, p = o.previous;
  // Only compare when the previous period lies fully inside the recorded history.
  const comparable = !!o.coverage.attempts_since && o.period.prev_from >= o.coverage.attempts_since;
  const prevLabel = `previous ${o.period.days} day${o.period.days === 1 ? '' : 's'} (${fmtRange({ from: o.period.prev_from, to: o.period.prev_to })})`;
  const series: Series[] = ([
    { key: 'registrations', label: 'New registrations', color: COLORS.registrations, values: o.series.map((s) => s.registrations) },
    { key: 'active', label: 'Active students', color: COLORS.active, values: o.series.map((s) => s.active) },
    { key: 'returning', label: 'Returning students', color: COLORS.returning, values: o.series.map((s) => s.returning) },
  ] as Series[]).filter((s) => show[s.key as keyof typeof show]);
  const quizRate = pct(c.quiz_completed, c.quiz_started);
  const practiceRate = pct(c.practice_completed, c.practice_started);

  return (
    <div className="stack" aria-busy={loading}>
      <CoverageNote range={range} since={o.coverage.attempts_since} what="records" />
      <p className="muted small">Period totals unless marked lifetime. Comparison: {prevLabel}.</p>
      <div className="fi-kpis">
        <Kpi label="Registrations" value={num(c.registrations)} sub={`Lifetime: ${num(o.lifetime.students)} students`}
          def="Students whose KAIRO profile was created in the period (first KAIRO sign-in). Guests and staff excluded."
          delta={<Delta cur={c.registrations} prev={p.registrations} comparable={comparable} />} />
        <Kpi label="Daily active users" value={c.dau_avg == null ? '—' : num(c.dau_avg)} sub={`Average per day · last day: ${num(c.dau_last)}`}
          def="Unique students with qualifying activity (started or finished a practice, quiz or mock, downloaded an offline pack, saved a study plan or opened an answer review) on a Lagos calendar day, averaged over the period. Logins and page views alone do not count."
          delta={<Delta cur={c.dau_avg} prev={p.dau_avg} comparable={comparable} />} />
        <Kpi label="Weekly active users" value={num(c.wau)} sub={`7 days ending ${fmtDay(minDay(o.period.to, o.coverage.today))}`}
          def="Unique students with qualifying activity in the 7 Lagos days ending on the last day of the period."
          delta={<Delta cur={c.wau} prev={p.wau} comparable={comparable} />} />
        <Kpi label="Monthly active users" value={num(c.mau)} sub={`30 days ending ${fmtDay(minDay(o.period.to, o.coverage.today))}`}
          def="Unique students with qualifying activity in the 30 Lagos days ending on the last day of the period."
          delta={<Delta cur={c.mau} prev={p.mau} comparable={comparable} />} />
        <Kpi label="Returning users" value={num(c.returning_users)} sub={`of ${num(c.active_users)} active students`}
          def="Active students in the period who were active on an earlier Lagos day than the day they were active here."
          delta={<Delta cur={c.returning_users} prev={p.returning_users} comparable={comparable} />} />
        <Kpi label="Questions answered" value={num(c.questions)} sub={c.active_users ? `${num(Math.round((10 * c.questions) / c.active_users) / 10)} per active student` : undefined}
          def="Answered questions (an option chosen) in practice, quizzes and mocks started in the period, from the server's answer records. Each question counts once per attempt, so resends never inflate it. Rejected attempts excluded."
          delta={<Delta cur={c.questions} prev={p.questions} comparable={comparable} />} />
        <Kpi label="Practice sessions" value={num(c.practice_started)} sub={`${num(c.practice_completed)} completed${practiceRate != null ? ` (${practiceRate}%)` : ''}`}
          def="Personal practice sessions started in the period (topic, year, custom/mixed, retries and reviews; mocks counted separately). Completed = submitted."
          delta={<Delta cur={c.practice_started} prev={p.practice_started} comparable={comparable} />} />
        <Kpi label="Completed quizzes" value={num(c.quiz_completed)} sub={`of ${num(c.quiz_started)} started${quizRate != null ? ` (${quizRate}%)` : ''}`}
          def="Daily Builder Quiz and challenge attempts started in the period that were submitted. Guest plays excluded (shown below)."
          delta={<Delta cur={c.quiz_completed} prev={p.quiz_completed} comparable={comparable} />} />
      </div>

      <section className="card stack-sm" aria-labelledby="h-growth">
        <div className="row-between wrap"><h2 id="h-growth">Growth trend</h2><span className="muted small">{o.period.grain === 'week' ? 'Weekly (weeks start Monday)' : 'Daily'}</span></div>
        <div className="chip-row" role="group" aria-label="Series to show">
          {(['registrations', 'active', 'returning'] as const).map((k) => (
            <button key={k} type="button" className={`chip ${show[k] ? 'chip-on' : ''}`} aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}>
              <i className="fi-swatch" style={{ background: COLORS[k] }} />{k === 'registrations' ? 'New registrations' : k === 'active' ? 'Active' : 'Returning'}</button>
          ))}
        </div>
        {o.series.length === 0 ? <p className="muted">No days in this period yet.</p>
          : series.length === 0 ? <p className="muted">Pick at least one series.</p>
          : <LineChart title="Registrations, active and returning students over time" labels={o.series.map((s) => s.bucket)} series={series} />}
      </section>

      <section className="card stack-sm" aria-labelledby="h-learn">
        <h2 id="h-learn">Learning activity</h2>
        <div className="fi-grid2">
          <Stat label="Questions answered" value={num(c.questions)} />
          <Stat label="Questions per active student" value={c.active_users ? num(Math.round((10 * c.questions) / c.active_users) / 10) : '—'} />
          <Stat label="Practice sessions started" value={num(c.practice_started)} />
          <Stat label="Practice sessions completed" value={num(c.practice_completed)} hint={c.practice_abandoned ? `${num(c.practice_abandoned)} abandoned (open 24h+)` : undefined} />
          <Stat label="Quiz attempts" value={num(c.quiz_started)} />
          <Stat label="Quiz completion rate" value={quizRate == null ? '—' : `${quizRate}%`} />
          <Stat label="Mock exams started" value={num(c.mock_started)} />
          <Stat label="Mock exams completed" value={num(c.mock_completed)} />
          <Stat label="Guest quiz plays" value={num(c.guest_plays)} hint="Anonymous players from shared quiz links (not in the numbers above)" />
          <Stat label="New guests" value={num(c.guests)} hint={`Lifetime guests still unconverted: ${num(o.lifetime.guests)}`} />
        </div>
      </section>

      {g && <GuestCard g={g} range={range} />}

      <Insights o={o} c={c} p={p} comparable={comparable} features={f} />
    </div>
  );
}

const minDay = (a: string, b: string) => (a < b ? a : b);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="fi-stat"><span className="num fi-stat-v">{value}</span><span className="small">{label}</span>{hint && <span className="muted small">{hint}</span>}</div>;
}

interface Insight { text: string; evidence: string }
/** Rule-based observations. Each needs a minimum sample and shows the numbers behind it. */
export function buildInsights(c: Kpis, p: Kpis, comparable: boolean, features: FeatureRow[], prevLabel: string): Insight[] {
  const out: Insight[] = [];
  if (comparable && (c.registrations + p.registrations) >= 10 && c.registrations !== p.registrations) {
    const up = c.registrations > p.registrations;
    out.push({ text: `Registrations ${up ? 'increased' : 'decreased'} compared with the previous period.`,
      evidence: `${num(c.registrations)} vs ${num(p.registrations)} in the ${prevLabel}${p.registrations ? ` (${up ? '+' : ''}${Math.round((100 * (c.registrations - p.registrations)) / p.registrations)}%)` : ''}.` });
  }
  const pr = pct(c.practice_completed, c.practice_started);
  if (c.practice_started >= 10 && pr != null && pr < 60) {
    out.push({ text: 'Many students start practice but do not complete it.', evidence: `${num(c.practice_completed)} of ${num(c.practice_started)} practice sessions were submitted (${pr}%); ${num(c.practice_abandoned)} have been left open for 24 hours or more.` });
  }
  const qr = pct(c.quiz_completed, c.quiz_started);
  if (c.quiz_started >= 10 && qr != null && qr < 70) {
    out.push({ text: 'A noticeable share of quiz attempts are not finished.', evidence: `${num(c.quiz_completed)} of ${num(c.quiz_started)} quiz attempts were submitted (${qr}%).` });
  }
  const used = features.filter((f) => f.primary_kind === 'attempt' && (f.starters ?? 0) > 0).sort((a, b) => (b.starters ?? 0) - (a.starters ?? 0));
  const total = used.reduce((s, f) => s + (f.starters ?? 0), 0);
  if (used.length >= 2 && (used[0].starters ?? 0) >= 10 && (used[0].starters ?? 0) >= 1.5 * (used[1].starters ?? 0)) {
    out.push({ text: `${FEATURE_LABEL[used[0].feature] ?? used[0].label} draws more students than any other learning feature.`,
      evidence: `${num(used[0].starters)} students started it, against ${num(used[1].starters)} for ${FEATURE_LABEL[used[1].feature] ?? used[1].label} (next most used).${total ? '' : ''}` });
  }
  for (const f of features) {
    if (f.primary_kind === 'attempt' && (f.starts ?? 0) >= 10) {
      const r = pct(f.completions, f.starts);
      if (r != null && r < 50) out.push({ text: `${FEATURE_LABEL[f.feature] ?? f.label}: high starts but low completion.`, evidence: `${num(f.completions)} of ${num(f.starts)} sessions completed (${r}%).` });
    }
  }
  if (c.n_returning_with_q >= 5 && c.n_first_time_with_q >= 5 && c.q_returning != null && c.q_first_time != null && c.q_first_time > 0
      && c.q_returning >= 1.3 * c.q_first_time) {
    out.push({ text: 'Returning students answer more questions than first-time students.',
      evidence: `${num(c.q_returning)} questions per returning student (${num(c.n_returning_with_q)} students) vs ${num(c.q_first_time)} per first-time student (${num(c.n_first_time_with_q)}).` });
  }
  if (c.guest_plays >= 10) {
    out.push({ text: 'Guests are playing quizzes without creating an account.', evidence: `${num(c.guest_plays)} quiz plays by guests in this period; ${num(c.guests)} new guest sessions.` });
  }
  return out;
}

function Insights({ o, c, p, comparable, features }: { o: O; c: Kpis; p: Kpis; comparable: boolean; features: FeatureRow[] }) {
  const list = buildInsights(c, p, comparable, features, `previous ${o.period.days} day${o.period.days === 1 ? '' : 's'}`);
  return (
    <section className="card stack-sm" aria-labelledby="h-ins">
      <h2 id="h-ins">Product insights</h2>
      <p className="muted small">Calculated from the numbers on this page with fixed rules and minimum sample sizes. No AI-written claims.</p>
      {list.length ? <ul className="fi-insights">{list.map((i) => <li key={i.text}><b>{i.text}</b><span className="muted small">{i.evidence}</span></li>)}</ul>
        : <p className="muted">Not enough data in this period for a reliable observation yet. Try a longer period.</p>}
    </section>
  );
}

function GuestCard({ g, range }: { g: GuestReport; range: { from: string; to: string } }) {
  const tracked = !!g.tracking_since && range.to >= g.tracking_since;
  const rate = pct(g.converted, g.guests_finished);
  return (
    <section className="card stack-sm" aria-labelledby="h-guest">
      <h2 id="h-guest">Guest conversion</h2>
      <p className="muted small">Guests play one free quiz, then must create an account. Guests still unconverted right now: <b>{num(g.guests_now)}</b>.</p>
      <div className="fi-grid2">
        <Stat label="Guests who played" value={num(g.guests_played)} />
        <Stat label="Guests who finished a quiz" value={num(g.guests_finished)} />
        <Stat label="Finished 2+ quizzes as guest" value={num(g.guests_replayed)} hint="Before the sign-up wall, or on another phone" />
        {tracked ? <>
          <Stat label="Saw the sign-up form" value={num(g.prompted)} />
          <Stat label="Hit the sign-up wall" value={num(g.gated)} />
          <Stat label="Became an account" value={num(g.converted)} hint={rate == null ? undefined : `${rate}% of guests who finished`} />
        </> : <p className="fi-note">Data still being collected: conversion tracking starts {g.tracking_since ? fmtDay(g.tracking_since) : 'when the first guest sees the new sign-up flow'}.</p>}
      </div>
    </section>
  );
}
