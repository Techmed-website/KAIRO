import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kvGet, kvSet } from '../../lib/db';
import { cbt, friendlyError } from '../../lib/supabase';
import { Tabs } from '../../ui/components';
import './leaderboard.css';

type Kind = 'points' | 'mock';
type Period = 'day' | 'week' | 'all';
interface Row { rank: number; name: string; points: number; answered: number; accuracy: number; mock: number | null; is_me: boolean }
interface Me { rank: number | null; points: number; answered: number; accuracy: number | null; mock: number | null }
interface Board { since: string; participants: number; min_answered: number; rows: Row[]; me: Me | null }

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', all: 'all time' };

export default function Leaderboard() {
  const [kind, setKind] = useState<Kind>('points');
  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [stale, setStale] = useState(false);
  const key = `board:${kind}:${period}`;

  useEffect(() => {
    let live = true;
    setErr('');
    kvGet<Board>(key).then((b) => { if (live && b) { setBoard(b); setStale(true); } else if (live) setBoard(null); });
    cbt().rpc('board', { p_kind: kind, p_period: period, p_limit: 50 }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setErr(friendlyError(error)); return; }
      setBoard(data as Board); setStale(false); kvSet(key, data);
    });
    return () => { live = false; };
  }, [kind, period, key]);

  const value = (r: { points: number; mock: number | null }) => (kind === 'mock' ? r.mock ?? 0 : r.points);
  const unit = kind === 'mock' ? '/400' : 'correct';
  const top3 = board?.rows.slice(0, 3) ?? [];
  const meOnList = board?.rows.some((r) => r.is_me);

  return (
    <div className="page stack lb">
      <div className="stack-sm">
        <h1>Leaderboard</h1>
        <p className="muted small">Only answers given without seeing the key count: end-of-session practice and full mocks. Everyone competes fairly.</p>
      </div>
      <Tabs value={kind} onChange={setKind} label="Board" items={[{ value: 'points', label: 'Most correct' }, { value: 'mock', label: 'Best mock /400' }]} />
      <div className="chip-row" role="group" aria-label="Period">
        {(['day', 'week', 'all'] as Period[]).map((p) => (
          <button key={p} className="chip" aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'All time'}</button>
        ))}
      </div>

      {err && !board && <p className="card error">{err}</p>}
      {!board && !err && <div className="skeleton" style={{ height: 320 }} />}

      {board && (
        <>
          {board.rows.length === 0 ? (
            <div className="card stack-sm">
              <p className="lead">No one is on the board {PERIOD_LABEL[period]} yet.</p>
              <p className="muted small">{kind === 'mock' ? 'Finish a full JAMB mock to appear here.' : `Answer ${board.min_answered} questions in end-of-session practice or a mock to appear.`}</p>
            </div>
          ) : (
            <>
              <div className={`podium n${top3.length}`} aria-label="Top three">
                {[1, 0, 2].map((i) => top3[i] && (
                  <div key={i} className={`pod p${i + 1} ${top3[i].is_me ? 'me' : ''}`}>
                    <span className="pod-avatar" aria-hidden="true">{initials(top3[i].name)}</span>
                    <b className="pod-name">{top3[i].is_me ? 'You' : top3[i].name}</b>
                    <span className="pod-val num">{value(top3[i])}<small>{kind === 'mock' ? '/400' : ''}</small></span>
                    <span className="pod-acc num">{top3[i].accuracy}%</span>
                    <div className="pod-step"><span>{i + 1}</span></div>
                  </div>
                ))}
              </div>
              <ol className="lb-list" aria-label="Rankings">
                {board.rows.slice(3).map((r) => <RowItem key={r.rank + r.name} r={r} v={value(r)} unit={unit} />)}
              </ol>
            </>
          )}
          <p className="muted small num">{board.participants} on the board {PERIOD_LABEL[period]}{stale ? ' · updating…' : ''}</p>
        </>
      )}

      {board && !meOnList && (
        <div className="lb-me card">
          {board.me?.rank ? (
            <><span className="lb-rank num">#{board.me.rank}</span><div className="grow"><b>You</b><p className="muted small num">{board.me.accuracy}% accuracy</p></div>
              <b className="num">{value(board.me)} <small className="muted">{unit}</small></b></>
          ) : kind === 'points' ? (
            <div className="grow stack-sm">
              <b>You: {board.me?.answered ?? 0} of {board.min_answered} counted answers {PERIOD_LABEL[period]}</b>
              <div className="meter"><i style={{ width: `${Math.min(100, ((board.me?.answered ?? 0) / board.min_answered) * 100)}%` }} /></div>
              <Link to="/practice/mixed" className="small">Practise with answers at the end to join</Link>
            </div>
          ) : (
            <div className="grow row-between"><b>You have no mock {PERIOD_LABEL[period]}</b><Link to="/practice/mock" className="btn btn-sm btn-accent">Take a mock</Link></div>
          )}
        </div>
      )}
    </div>
  );
}

function RowItem({ r, v, unit }: { r: Row; v: number; unit: string }) {
  return (
    <li className={`lb-row ${r.is_me ? 'me' : ''}`}>
      <span className="lb-rank num">{r.rank}</span>
      <span className="pod-avatar sm" aria-hidden="true">{initials(r.name)}</span>
      <div className="grow"><b>{r.is_me ? 'You' : r.name}</b><p className="muted small num">{r.accuracy}% accuracy · {r.answered} answered</p></div>
      <b className="num">{v} <small className="muted">{unit}</small></b>
    </li>
  );
}
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
