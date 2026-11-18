import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { subjectName } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import { Spinner } from '../../ui/components';
import { IcFlag } from '../../ui/icons';
import { Options, Passage, Stem, Tutor, whyNotFor } from '../cbt/Question';
import '../cbt/cbt.css';
import { loadReview, type ReviewData } from './data';
import './review.css';

type Filter = 'all' | 'wrong' | 'flagged' | 'blank';

export default function Review() {
  const { id = '' } = useParams();
  const [d, setD] = useState<ReviewData | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [subj, setSubj] = useState<string>('ALL');
  const [idx, setIdx] = useState(0);
  const [passageOpen, setPassageOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => { loadReview(id).then(setD).catch((e) => setErr(friendlyError(e))); }, [id]);

  const subjects = useMemo(() => [...new Set(d?.questions.map((q) => q.subject) ?? [])], [d]);
  const status = (qid: string, key?: string | null) => {
    const sel = d?.answers[qid]?.selected;
    return !sel ? 'blank' : sel === key ? 'ok' : 'bad';
  };
  const list = useMemo(() => (d?.questions ?? []).map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => {
    if (subj !== 'ALL' && q.subject !== subj) return false;
    const st = status(q.id, q.correct_option), a = d!.answers[q.id];
    return filter === 'all' || (filter === 'wrong' && st === 'bad') || (filter === 'flagged' && a?.flagged) || (filter === 'blank' && st === 'blank');
  }), [d, filter, subj]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setIdx(0); }, [filter, subj]);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [idx, list]);

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!d) return <Spinner label="Loading your review" />;

  const counts = {
    ok: d.questions.filter((q) => status(q.id, q.correct_option) === 'ok').length,
    bad: d.questions.filter((q) => status(q.id, q.correct_option) === 'bad').length,
    blank: d.questions.filter((q) => status(q.id, q.correct_option) === 'blank').length,
  };
  const cur = list[Math.min(idx, list.length - 1)];

  return (
    <div className="page stack review">
      <div className="row-between">
        <div><p className="eyebrow">{d.title}</p><h1>Review</h1></div>
        <Link to={`/result/${id}`} className="btn btn-sm">Result</Link>
      </div>
      <p className="row wrap small">
        <span className="badge badge-ok num">✓ {counts.ok} correct</span>
        <span className="badge badge-bad num">✗ {counts.bad} wrong</span>
        <span className="badge num">{counts.blank} not answered</span>
      </p>
      <div className="chip-scroll" role="group" aria-label="Filter">
        {([['all', 'All'], ['wrong', 'Wrong'], ['flagged', 'Flagged'], ['blank', 'Not answered']] as const).map(([v, l]) => (
          <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      {subjects.length > 1 && (
        <div className="chip-scroll" role="group" aria-label="Subject">
          <button className="chip" aria-pressed={subj === 'ALL'} onClick={() => setSubj('ALL')}>All subjects</button>
          {subjects.map((s) => <button key={s} className="chip" aria-pressed={subj === s} onClick={() => setSubj(s)}>{subjectName(s)}</button>)}
        </div>
      )}

      {!cur ? <p className="card muted">Nothing here. {filter === 'wrong' ? 'You got none of these wrong.' : 'Try another filter.'}</p> : (
        <>
          <div className="num-strip" ref={strip}>
            {list.map(({ q, n }, i) => (
              <button key={q.id} aria-current={i === idx} onClick={() => setIdx(i)}
                className={`ns ${status(q.id, q.correct_option)} ${d.answers[q.id]?.flagged ? 'flg' : ''}`}
                aria-label={`Question ${n}`}>{n}</button>
            ))}
          </div>
          <article className="card review-q">
            {cur.q.passage_html && <Passage html={cur.q.passage_html} open={passageOpen} onToggle={() => setPassageOpen((o) => !o)} />}
            <div className="qmeta">
              <span className="qnum">Question <b className="num">{cur.n}</b></span>
              <span className="badge">{subjectName(cur.q.subject)}{cur.q.year ? ` · ${cur.q.year}` : ''}</span>
              {d.answers[cur.q.id]?.flagged && <span className="badge badge-flag"><IcFlag width={14} height={14} />Flagged</span>}
            </div>
            <Stem q={cur.q} />
            <Options q={cur.q} selected={d.answers[cur.q.id]?.selected ?? null} reveal whyNot={whyNotFor(cur.q)} />
            <Tutor q={cur.q} selected={d.answers[cur.q.id]?.selected ?? null} />
          </article>
          <div className="row">
            <button className="btn grow" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>‹ Previous</button>
            <button className="btn btn-primary grow" disabled={idx >= list.length - 1} onClick={() => setIdx(idx + 1)}>Next ›</button>
          </div>
        </>
      )}
    </div>
  );
}
