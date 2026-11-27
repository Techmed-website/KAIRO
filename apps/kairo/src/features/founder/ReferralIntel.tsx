import { useState } from 'react';
import { toast } from '../../ui/components';
import { RefBadge, refLevel } from '../referrals/RefBadge';
import { useFounder } from './Founder';
import { fmtDateTime, getRefIntel, num, pct, reviewReferral, setReferralsEnabled } from './data';
import { ErrorCard, LineChart, Loading } from './ui';
import { useLoad } from './useLoad';

/** REFERRAL INTELLIGENCE: who brings new learners, how far they get, which badges are earned. From database records only. */
export default function ReferralIntel() {
  const { range, refreshKey } = useFounder();
  const { data: d, error, reload } = useLoad((fresh) => getRefIntel(range, fresh), [range.from, range.to, refreshKey]);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  if (!d) return <div className="stack"><Loading h={160} /><Loading /></div>;
  const t = d.totals;

  const toggle = async () => {
    if (!window.confirm(d.enabled ? 'Pause Proudly KAIRO? New referrals stop being recorded. Badges and numbers already earned are kept.' : 'Resume Proudly KAIRO?')) return;
    setBusy(true);
    try { await setReferralsEnabled(!d.enabled); toast(d.enabled ? 'Referral programme paused' : 'Referral programme resumed'); reload(); }
    catch { toast('Could not change the programme. Try again.'); }
    setBusy(false);
  };
  const review = async (id: string, status: 'valid' | 'rejected') => {
    const reason = status === 'rejected' ? window.prompt('Reason (optional)') ?? undefined : undefined;
    try { await reviewReferral(id, status, reason); toast(status === 'valid' ? 'Approved: it now counts' : 'Rejected'); reload(); }
    catch { toast('Could not update. Try again.'); }
  };
  const funnel = [
    { label: 'Unique link visitors', n: t.unique_visitors },
    { label: 'Signed up (registered in period)', n: t.registrations },
    { label: 'Activated (of those sign-ups)', n: t.cohort_activated },
    { label: 'Came back on a later day', n: t.cohort_retained },
  ];

  return (
    <div className="stack">
      <section className="card stack-sm">
        <div className="row-between wrap">
          <div><h2>Proudly KAIRO</h2><p className="muted small">Recognition-only referral programme. Status: <b>{d.enabled ? 'running' : 'paused'}</b> (changed {fmtDateTime(d.settings.updated_at)}).</p></div>
          <button className="btn btn-sm" disabled={busy} onClick={toggle}>{d.enabled ? 'Pause programme' : 'Resume programme'}</button>
        </div>
        <details className="fi-def"><summary>Qualification rules and badge thresholds</summary>
          <ul className="small">
            <li><b>Registered</b>: a brand-new account (at most 7 days old, not a guest, not the referrer) recorded through a link or code. First touch wins and never changes.</li>
            <li><b>Activated</b>: the friend finished a practice, quiz or mock with 10+ answered questions after creating their account (from attempt records, never client events). Only activated referrals count for badges.</li>
            <li><b>Retained</b>: after activating, the friend learned again on a later Lagos day.</li>
            <li><b>Blocked</b>: self-referral (incl. same Gmail with dots/+tags), existing accounts, circular referrals. <b>Flagged</b> (not counted until you approve): same phone or same device as the referrer.</li>
            <li><b>Badges</b>: {d.thresholds.map((b) => `${b.title} ${b.goal}`).join(' · ')}. Awarded once by the server; changing a threshold never removes a badge already earned. No XP, no money.</li>
          </ul>
        </details>
      </section>

      <div className="fi-kpis">
        {[
          ['Link visits', t.visits, 'Referral link opens (repeat opens from one phone within an hour count once).'],
          ['Unique visitors', t.unique_visitors, 'Distinct phones/browsers that opened a referral link.'],
          ['Registrations', t.registrations, 'New accounts attributed in the period (valid only).'],
          ['Activated', t.activated, 'Referrals that activated in the period (10+ answered questions in a finished session).'],
          ['Retained', t.retained, 'Referrals that came back on a later day, in the period.'],
          ['Students referring', t.referrers, `Students who brought at least one sign-up in the period. ${t.sharers} had their link opened.`],
          ['Flagged for review', t.flagged, 'Same phone or same device as the referrer. Not counted until approved.'],
          ['Rejected', t.rejected, 'Referrals you rejected in this period.'],
        ].map(([l, v, def]) => (
          <article key={l as string} className="fi-kpi"><h3 className="fi-kpi-label">{l}</h3><p className="fi-kpi-value num">{num(v as number)}</p>
            <details className="fi-def"><summary>Definition</summary><p>{def}</p></details></article>
        ))}
      </div>

      <section className="card stack-sm" aria-labelledby="h-rf">
        <h2 id="h-rf">Acquisition funnel</h2>
        <p className="muted small">Registrations, activations and retention are counted for friends who signed up in this period, so a drop-off shows where they stop. Success is never measured by clicks.</p>
        <ol className="fi-funnel">
          {funnel.map((s, i) => (
            <li key={s.label}>
              <div className="row-between wrap"><b>{i + 1}. {s.label}</b><b className="num">{num(s.n)}</b></div>
              <span className="fi-funnel-bar" style={{ width: `${Math.max(2, pct(s.n, funnel[0].n || funnel[1].n || 1) ?? 0)}%` }} />
              {i > 0 && <p className="small muted">{pct(s.n, funnel[i - 1].n) ?? 0}% of the previous step</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="card stack-sm" aria-labelledby="h-rd">
        <h2 id="h-rd">Referral activity by date</h2>
        {d.daily.length ? <LineChart title="Referral visits, registrations and activations per day" labels={d.daily.map((x) => x.day)} series={[
          { key: 'v', label: 'Link visits', color: 'var(--fi-s1)', values: d.daily.map((x) => x.visits) },
          { key: 'r', label: 'Registrations', color: 'var(--fi-s2)', values: d.daily.map((x) => x.registrations) },
          { key: 'a', label: 'Activated', color: 'var(--fi-s3)', values: d.daily.map((x) => x.activated) }]} /> : <p className="muted">No days in this period yet.</p>}
      </section>

      <section className="card stack-sm" aria-labelledby="h-rt">
        <h2 id="h-rt">Top referrers (all time)</h2>
        {d.top_referrers.length === 0 ? <p className="muted">No referrals yet. The launch announcement and invite prompts start the flow.</p> : (
          <div className="fi-table-wrap"><table className="fi-table">
            <thead><tr><th>Student</th><th>Badge</th><th>Code</th><th className="num">Visits</th><th className="num">Signed up</th><th className="num">Activated</th><th className="num">Retained</th><th className="num">Flagged</th><th>Contact</th></tr></thead>
            <tbody>{d.top_referrers.map((r) => (
              <tr key={r.user_id}><th scope="row">{r.name || r.student}<span className="muted small fi-kind num">{r.student}</span></th>
                <td>{r.badge ? <span className="row"><RefBadge code={r.badge} size={18} />{refLevel(r.badge)?.title}</span> : '—'}</td><td className="num">{r.code}</td>
                <td className="num">{num(r.visits)}</td><td className="num">{num(r.registrations)}</td><td className="num"><b>{num(r.activated)}</b></td>
                <td className="num">{num(r.retained)}</td><td className="num">{num(r.flagged)}</td>
                <td className="small">{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : ''} {r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : ''}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="h-rb">
        <h2 id="h-rb">Badge distribution</h2>
        <div className="fi-grid2">{d.badges.map((b) => (
          <div key={b.code} className="fi-stat"><RefBadge code={b.code} size={40} locked={!b.holders} /><span className="num fi-stat-v">{num(b.holders)}</span><span className="small">{b.title} ({b.goal})</span></div>))}</div>
        {d.awards.length > 0 && <>
          <h3>Award history</h3>
          <ol className="fi-feed">{d.awards.map((a, i) => (
            <li key={i} className="fi-feed-item"><time>{fmtDateTime(a.at)}</time><span className="grow"><b>{a.name || a.student}</b> earned {refLevel(a.badge)?.title}</span></li>))}</ol>
        </>}
      </section>

      <section className="card stack-sm" aria-labelledby="h-rc">
        <h2 id="h-rc">Referral cohorts by week</h2>
        {d.cohorts.length === 0 ? <p className="muted">No referred sign-ups in this period.</p> : (
          <div className="fi-table-wrap"><table className="fi-table">
            <thead><tr><th>Week of</th><th className="num">Signed up</th><th className="num">Activated</th><th className="num">Retained</th></tr></thead>
            <tbody>{d.cohorts.map((c) => <tr key={c.week}><td>{c.week}</td><td className="num">{c.registrations}</td>
              <td className="num">{c.activated} ({pct(c.activated, c.registrations) ?? 0}%)</td><td className="num">{c.retained} ({pct(c.retained, c.activated) ?? 0}%)</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="h-rr">
        <h2 id="h-rr">Suspicious referrals</h2>
        {d.review.length === 0 ? <p className="muted">Nothing flagged. Same-phone and same-device sign-ups appear here for review.</p> : (
          <div className="fi-table-wrap"><table className="fi-table">
            <thead><tr><th>Referred</th><th>Referrer</th><th>Why</th><th>When</th><th>Activated</th><th>Status</th><th /></tr></thead>
            <tbody>{d.review.map((r) => (
              <tr key={r.referred_id}><td>{r.referred_name || r.referred}</td><td>{r.referrer_name || r.referrer}</td><td className="small">{r.reason ?? '—'}</td>
                <td>{fmtDateTime(r.created_at)}</td><td>{r.activated ? 'yes' : 'no'}</td><td>{r.status}</td>
                <td><span className="row">{r.status !== 'valid' && <button className="btn btn-sm" onClick={() => review(r.referred_id, 'valid')}>Approve</button>}
                  {r.status !== 'rejected' && <button className="btn btn-sm btn-ghost" onClick={() => review(r.referred_id, 'rejected')}>Reject</button>}</span></td></tr>))}</tbody>
          </table></div>
        )}
        <p className="muted small">Rejecting a referral never removes a badge already earned.</p>
      </section>
    </div>
  );
}
