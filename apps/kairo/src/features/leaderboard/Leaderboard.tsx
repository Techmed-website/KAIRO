import { useEffect, useState } from 'react';
import { RefBadge } from '../referrals/RefBadge';
import '../referrals/referrals.css';
import { Link } from 'react-router-dom';
import { kvGet, kvSet } from '../../lib/db';
import { cbt, friendlyError } from '../../lib/supabase';
import { IcArrowDown, IcArrowUp, IcInfo } from '../../ui/icons';
import { initials } from './BoardList';
import './leaderboard.css';

type Period = 'day' | 'week' | 'all';
interface Row { rank: number; name: string; xp: number; level: number; is_me: boolean; prev_rank: number | null; ref?: string | null }
interface Board { period: Period; starts_at: string | null; ends_at: string | null; participants: number; rows: Row[]; me: Omit<Row, 'name' | 'is_me'> | null }

const TABS: { value: Period; label: string }[] = [{ value: 'day', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'all', label: 'All time' }];

/** XP leaderboards: today (resets at midnight), this week (resets Sunday 10 pm) and all time. Data from cbt.xp_board. */
export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>('week');
  const [loaded, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(Date.now());
  const key = `xpboard:${period}`;
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let live = true;
    setErr(''); setBoard(null);
    kvGet<Board>(key).then((b) => { if (live && b) { setBoard(b); setStale(true); } });
    cbt().rpc('xp_board', { p_period: period, p_limit: 50 }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setErr(error ? friendlyError(error) : 'The leaderboard is not available right now.'); return; }
      setBoard(data as Board); setStale(false); kvSet(key, data);
    });
    return () => { live = false; };
  }, [key, period]);

  // Only show data for the selected period (never last tab's numbers under this tab's label).
  const board = loaded && loaded.period === period ? loaded : null;
  const top3 = board?.rows.slice(0, 3) ?? [];
  const rest = board?.rows.slice(3) ?? [];
  const me = board?.me;
  const resets = board?.ends_at ? countdown(new Date(board.ends_at).getTime() - now) : null;

  return (
    <div className="page lbx">
      <header className="stack-sm">
        <h1>Leaderboard</h1>
        <p className="muted">Compete. Improve. Keep building.</p>
        <Link to="/ambassadors" className="lbx-amb small">🛡️ KAIRO Ambassadors board <span aria-hidden="true">›</span></Link>
        <Link to="/reviews" className="lbx-amb small">💬 Student reviews <span aria-hidden="true">›</span></Link>
      </header>
      <div className="lbx-tabs" role="tablist" aria-label="Leaderboard period">
        {TABS.map((t) => <button key={t.value} role="tab" aria-selected={period === t.value} onClick={() => setPeriod(t.value)}>{t.label}</button>)}
      </div>
      <p className="lbx-note small">
        {period === 'all' ? 'Total XP since you joined KAIRO.' : <>XP earned {period === 'day' ? 'today' : 'this week'}{resets ? <> · <b className="num">resets in {resets}</b></> : null}</>}
        {' '}<Link to="/achievements#xp" className="lbx-how"><IcInfo />How XP works</Link>
      </p>

      {err && !board && <p className="card error">{err}</p>}
      {!board && !err && <div className="stack-sm"><div className="skeleton" style={{ height: 190 }} /><div className="skeleton" style={{ height: 240 }} /></div>}

      {board && (
        <>
          {board.rows.length === 0 ? (
            <section className="lbx-empty">
              <h2>{period === 'day' ? 'Nobody is on today’s board yet.' : 'The board is empty so far.'}</h2>
              <p className="muted">Finish a practice or today’s Daily Builder Quiz to take the top spot.</p>
              <Link to="/quizzes" className="btn btn-accent">Take today’s quiz</Link>
            </section>
          ) : (
            <>
              <section className="lbx-podium" aria-label="Top three">
                {[1, 0, 2].map((i) => top3[i] ? (
                  <div key={i} className={`lbx-pod p${i + 1} ${top3[i].is_me ? 'me' : ''}`}>
                    <span className="lbx-av" aria-hidden="true">{initials(top3[i].name)}</span>
                    <b className="lbx-pod-name">{top3[i].is_me ? 'You' : top3[i].name}{top3[i].ref && <span className="ref-mark"><RefBadge code={top3[i].ref!} size={14} /></span>}</b>
                    <span className="lbx-pod-xp num">{top3[i].xp.toLocaleString()} XP</span>
                    <div className="lbx-step"><span className="num">{i + 1}</span><small>Lv {top3[i].level}</small></div>
                  </div>
                ) : <div key={i} className="lbx-pod empty" />)}
              </section>

              <MyCard me={me ?? null} period={period} participants={board.participants} />

              {rest.length > 0 && (
                <section className="stack-sm" aria-labelledby="h-rank">
                  <h2 id="h-rank">Rankings</h2>
                  <ol className="lbx-list">
                    {rest.map((r) => (
                      <li key={r.rank} className={`lbx-row ${r.is_me ? 'me' : ''}`}>
                        <span className="lbx-rank num">{r.rank}</span>
                        <span className="lbx-av sm" aria-hidden="true">{initials(r.name)}</span>
                        <span className="grow"><b>{r.is_me ? 'You' : r.name}{r.ref && <span className="ref-mark"><RefBadge code={r.ref} size={14} /></span>}</b><small className="num">Level {r.level}</small></span>
                        <Move rank={r.rank} prev={r.prev_rank} period={period} />
                        <b className="lbx-xp num">{r.xp.toLocaleString()}<small> XP</small></b>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <p className="muted small num">{board.participants} Builder{board.participants === 1 ? '' : 's'} on this board{stale ? ' · updating…' : ''}</p>
            </>
          )}
        </>
      )}
      <Link to="/quizzes" className="lbx-quiz small">Each quiz also has its own leaderboard, ranked by score and time <span aria-hidden="true">›</span></Link>
    </div>
  );
}

/** Your rank and XP; movement only where history exists (all time: since yesterday; this week: last week's finish). */
function MyCard({ me, period, participants }: { me: Board['me']; period: Period; participants: number }) {
  if (!me) {
    return (
      <section className="lbx-me none">
        <div className="grow"><b>You are not on this board yet</b><small>Finish a practice session to join {participants} other Builder{participants === 1 ? '' : 's'}.</small></div>
        <Link to="/practice" className="btn btn-sm btn-accent">Practise</Link>
      </section>
    );
  }
  const moved = me.prev_rank != null ? me.prev_rank - me.rank : null;
  return (
    <section className="lbx-me" aria-label="Your ranking">
      <div className="grow">
        <span className="lbx-me-label">Your ranking</span>
        <b className="lbx-me-rank num">#{me.rank}</b>
        <small className="num">{me.xp.toLocaleString()} XP {period === 'day' ? 'today' : period === 'week' ? 'this week' : 'in total'} · of {participants}</small>
      </div>
      {period === 'week' && me.prev_rank != null && <span className="lbx-chip num">Last week #{me.prev_rank}</span>}
      {period === 'all' && moved != null && moved !== 0 && (
        <span className={`lbx-chip num ${moved > 0 ? 'up' : 'down'}`}>{moved > 0 ? <IcArrowUp /> : <IcArrowDown />}{Math.abs(moved)} since yesterday</span>
      )}
    </section>
  );
}

function Move({ rank, prev, period }: { rank: number; prev: number | null; period: Period }) {
  if (period !== 'all' || prev == null || prev === rank) return null;
  const up = prev > rank;
  return <span className={`lbx-move ${up ? 'up' : 'down'}`} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(prev - rank)} since yesterday`}>{up ? <IcArrowUp /> : <IcArrowDown />}{Math.abs(prev - rank)}</span>;
}

/** "2d 4h", "3h 12m", "8m". */
export function countdown(ms: number): string | null {
  if (!(ms > 0)) return null;
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${Math.max(1, mm)}m`;
}
