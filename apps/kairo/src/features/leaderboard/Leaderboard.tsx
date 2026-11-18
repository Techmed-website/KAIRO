import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kvGet, kvSet } from '../../lib/db';
import { formatDuration } from '../../lib/score';
import { SHORT, SUBJECT_NAMES } from '../../lib/subjects';
import { cbt, friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import { Tabs } from '../../ui/components';
import './leaderboard.css';

type Period = 'day' | 'week' | 'all';
type Scale = '4' | '3' | '2' | '1';
interface Row { rank: number; name: string; score: number; max: number; duration_sec: number | null; accuracy: number; subjects: SubjectCode[]; is_me: boolean }
type Me = Omit<Row, 'name' | 'is_me'>;
interface Board { since: string; participants: number; max: number; min_per_subject: number; rows: Row[]; me: Me | null }

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', all: 'all time' };
const SUBJECTS: SubjectCode[] = ['ENG', 'MTH', 'PHY', 'CHM', 'BIO'];

export default function Leaderboard() {
  const [scale, setScale] = useState<Scale>('4');
  const [period, setPeriod] = useState<Period>('week');
  const [subject, setSubject] = useState<SubjectCode | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const [stale, setStale] = useState(false);
  const n = Number(scale);
  const key = `board2:${scale}:${period}:${subject ?? ''}`;

  useEffect(() => {
    let live = true;
    setErr('');
    kvGet<Board>(key).then((b) => { if (!live) return; setBoard(b ?? null); setStale(!!b); });
    cbt().rpc('board', { p_period: period, p_subjects: n, p_subject: n === 1 ? subject : null, p_limit: 50 }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setErr(friendlyError(error)); return; }
      setBoard(data as Board); setStale(false); kvSet(key, data);
    });
    return () => { live = false; };
  }, [key, period, n, subject]);

  const top3 = board?.rows.slice(0, 3) ?? [];
  const meOnList = board?.rows.some((r) => r.is_me);
  const max = n * 100;

  return (
    <div className="page stack lb">
      <div className="stack-sm">
        <h1>Leaderboard</h1>
        <p className="muted small">Ranked by score, then by time: if two students tie, the faster one ranks higher. Papers with answers at the end and full mocks count.</p>
      </div>
      <Tabs value={scale} onChange={(v) => { setScale(v); if (v !== '1') setSubject(null); }} label="Paper size"
        items={[{ value: '4', label: '/400' }, { value: '3', label: '/300' }, { value: '2', label: '/200' }, { value: '1', label: '/100' }]} />
      {n === 1 && (
        <div className="chip-scroll" role="group" aria-label="Subject">
          <button className="chip" aria-pressed={!subject} onClick={() => setSubject(null)}>Any subject</button>
          {SUBJECTS.map((c) => <button key={c} className="chip" aria-pressed={subject === c} onClick={() => setSubject(c)}>{SUBJECT_NAMES[c]}</button>)}
        </div>
      )}
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
              <p className="lead">No one is on the /{max} board {PERIOD_LABEL[period]} yet.</p>
              <p className="muted small">{howToJoin(n, board.min_per_subject)}</p>
            </div>
          ) : (
            <>
              <div className="podium" aria-label="Top three">
                {[1, 0, 2].map((i) => top3[i] && (
                  <div key={i} className={`pod p${i + 1} ${top3[i].is_me ? 'me' : ''}`}>
                    <span className="pod-avatar" aria-hidden="true">{initials(top3[i].name)}</span>
                    <b className="pod-name">{top3[i].is_me ? 'You' : top3[i].name}</b>
                    <span className="pod-val num">{top3[i].score}<small>/{max}</small></span>
                    <span className="pod-acc num">{time(top3[i].duration_sec)}</span>
                    <div className="pod-step"><span>{i + 1}</span></div>
                  </div>
                ))}
              </div>
              <ol className="lb-list" aria-label="Rankings">
                {board.rows.slice(3).map((r) => (
                  <li key={r.rank + r.name} className={`lb-row ${r.is_me ? 'me' : ''}`}>
                    <span className="lb-rank num">{r.rank}</span>
                    <span className="pod-avatar sm" aria-hidden="true">{initials(r.name)}</span>
                    <div className="grow"><b>{r.is_me ? 'You' : r.name}</b><p className="muted small num">{time(r.duration_sec)}{n < 4 ? ` · ${r.subjects.map((c) => SHORT[c]).join(', ')}` : ''}</p></div>
                    <b className="num lb-score">{r.score}<small className="muted">/{max}</small></b>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="muted small num">{board.participants} on the board {PERIOD_LABEL[period]}{stale ? ' · updating…' : ''}</p>
        </>
      )}

      {board && !meOnList && (
        <div className="lb-me card">
          {board.me ? (
            <><span className="lb-rank num">#{board.me.rank}</span>
              <div className="grow"><b>You</b><p className="muted small num">{time(board.me.duration_sec)}</p></div>
              <b className="num lb-score">{board.me.score}<small className="muted">/{max}</small></b></>
          ) : (
            <div className="grow row-between wrap">
              <span className="small"><b>You are not on this board yet.</b><br /><span className="muted">{howToJoin(n, board.min_per_subject)}</span></span>
              <Link to={n === 4 ? '/practice/mock' : '/practice/mixed'} className="btn btn-sm btn-accent">{n === 4 ? 'Take a mock' : 'Practise'}</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const howToJoin = (n: number, min: number) =>
  `Finish a ${n}-subject paper with answers at the end${n === 4 ? ' (or a full mock)' : ''}, at least ${min} questions per subject.`;
const time = (s: number | null) => (s == null ? '' : formatDuration(s));
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
