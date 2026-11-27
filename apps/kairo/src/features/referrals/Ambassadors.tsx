import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadRefBoard, loadRefMonth, type RefBoard, type RefMonth } from '../../lib/referral';
import { friendlyError } from '../../lib/supabase';
import { IcBack } from '../../ui/icons';
import { initials } from '../leaderboard/BoardList';
import { RefBadge, refLevel } from './RefBadge';
import '../leaderboard/leaderboard.css';
import './referrals.css';

const PAGE = 50;

/** KAIRO AMBASSADORS: students ranked by activated referrals. Separate from the academic boards; never merged. */
export default function Ambassadors() {
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [board, setBoard] = useState<RefBoard | null>(null);
  const [rows, setRows] = useState<RefBoard['rows']>([]);
  const [month, setMonth] = useState<RefMonth | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setBoard(null); setRows([]); setErr('');
    loadRefBoard(period, PAGE, 0).then((b) => { setBoard(b); setRows(b.rows); }).catch((e) => setErr(friendlyError(e)));
  }, [period]);
  useEffect(() => { loadRefMonth().then(setMonth).catch(() => {}); }, []);
  const more = async () => { if (!board) return; const b = await loadRefBoard(period, PAGE, rows.length); setRows([...rows, ...b.rows]); };
  const top3 = rows.slice(0, 3), rest = rows.slice(3);

  return (
    <div className="page refp amb">
      <nav className="crumbs-lite"><Link to="/leaderboard" className="icon-btn" aria-label="Back to leaderboard"><IcBack /></Link></nav>
      <header className="ref-hero slim">
        <p className="ref-kicker">PROUDLY KAIRO</p>
        <h1>KAIRO Ambassadors</h1>
        <p>The students putting the most friends on. Ranked by activated referrals.</p>
      </header>

      {month && (month.top_ambassador || month.most_signups || month.best_retention) && (
        <section className="card stack-sm amb-month" aria-labelledby="h-month">
          <h2 id="h-month">{month.month} recognition</h2>
          <ul>
            {month.top_ambassador && <li><span>👑</span><span className="grow"><b>Top KAIRO Ambassador</b><small>{month.top_ambassador.name}</small></span><b className="num">{month.top_ambassador.value} activated</b></li>}
            {month.most_signups && <li><span>🚀</span><span className="grow"><b>Most sign-ups</b><small>{month.most_signups.name}</small></span><b className="num">{month.most_signups.value}</b></li>}
            {month.best_retention && <li><span>🔥</span><span className="grow"><b>Strongest retention</b><small>{month.best_retention.name}</small></span><b className="num">{month.best_retention.value}%</b></li>}
          </ul>
          <p className="muted small">Recognition only. Badges are permanent and never reset at month end.</p>
        </section>
      )}

      <div className="lbx-tabs" role="tablist" aria-label="Period">
        <button role="tab" aria-selected={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
        <button role="tab" aria-selected={period === 'month'} onClick={() => setPeriod('month')}>This month</button>
      </div>

      {err && <p className="card error">{err}</p>}
      {!board && !err && <div className="skeleton" style={{ height: 300 }} />}
      {board && rows.length === 0 && (
        <section className="lbx-empty">
          <h2>The board is wide open. 👀</h2>
          <p className="muted">Be the first KAIRO Ambassador: share your link and get one friend learning.</p>
          <Link to="/referrals" className="btn btn-accent">Get my invite link</Link>
        </section>
      )}
      {board && rows.length > 0 && <>
        <section className="lbx-podium" aria-label="Top three">
          {[1, 0, 2].map((i) => top3[i] ? (
            <div key={i} className={`lbx-pod p${i + 1} ${top3[i].is_me ? 'me' : ''}`}>
              {top3[i].badge ? <RefBadge code={top3[i].badge!} size={44} /> : <span className="lbx-av" aria-hidden="true">{initials(top3[i].name)}</span>}
              <b className="lbx-pod-name">{top3[i].is_me ? 'You' : top3[i].name}</b>
              <span className="lbx-pod-xp num">{top3[i].activated} activated</span>
              <div className="lbx-step"><span className="num">{i + 1}</span><small>{refLevel(top3[i].badge)?.title.replace('KAIRO ', '') ?? ''}</small></div>
            </div>
          ) : <div key={i} className="lbx-pod empty" />)}
        </section>
        {board.me && !rows.slice(0, 3).some((r) => r.is_me) && (
          <section className="lbx-me"><div className="grow"><b>You are #{board.me.rank}</b><small className="num">{board.me.activated} activated · {board.me.retained} came back</small></div>
            {board.me.badge && <RefBadge code={board.me.badge} size={34} />}</section>
        )}
        {!board.me && <section className="lbx-me none"><div className="grow"><b>You are not on this board yet</b><small>One activated friend puts you on it.</small></div><Link to="/referrals" className="btn btn-sm btn-accent">Invite</Link></section>}
        {rest.length > 0 && (
          <ol className="lbx-list">
            {rest.map((r) => (
              <li key={r.rank} className={`lbx-row ${r.is_me ? 'me' : ''}`}>
                <span className="lbx-rank num">{r.rank}</span>
                {r.badge ? <RefBadge code={r.badge} size={28} /> : <span className="lbx-av sm" aria-hidden="true">{initials(r.name)}</span>}
                <span className="grow"><b>{r.is_me ? 'You' : r.name}</b><small>{refLevel(r.badge)?.title ?? 'Builder'}</small></span>
                <span className="small muted num">{r.retained} back</span>
                <b className="lbx-xp num">{r.activated}<small> activated</small></b>
              </li>
            ))}
          </ol>
        )}
        {rows.length < board.participants && <button className="btn btn-block" onClick={more}>Show more</button>}
        <p className="muted small num">{board.participants} Ambassador{board.participants === 1 ? '' : 's'} on this board</p>
      </>}
    </div>
  );
}
