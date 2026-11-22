import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { subjectName } from '../../lib/subjects';
import type { SubjectCode } from '../../lib/types';
import { Sheet, Tabs } from '../../ui/components';
import { IcBack } from '../../ui/icons';
import { CatalogError, OptionsPicker, Skel, suggestedSec, useCatalog, useStart, type Opts } from './common';

export default function SubjectPractice() {
  const { code = 'ENG' } = useParams();
  const { cat, err } = useCatalog();
  const { busy, start } = useStart();
  const [tab, setTab] = useState<'year' | 'topic'>('year');
  const [year, setYear] = useState<{ year: number; count: number } | null>(null);
  const [topics, setTopics] = useState<number[]>([]);
  const [count, setCount] = useState(20);
  const [opts, setOpts] = useState<Opts>({ feedback: 'instant', timed: false });
  const [topicSheet, setTopicSheet] = useState(false);
  const s = cat?.find((x) => x.code === code);
  const topicTotal = useMemo(() => (s?.topics ?? []).filter((t) => topics.includes(t.id)).reduce((a, t) => a + t.count, 0), [s, topics]);

  const goYear = () => year && start({ mode: 'year', subject: code as SubjectCode, year: year.year, feedback: opts.feedback,
    time_limit_sec: opts.timed ? suggestedSec(year.count) : null });
  const goTopic = () => start({ mode: 'topic', subject: code as SubjectCode, topic_ids: topics, count: Math.min(count, topicTotal),
    feedback: opts.feedback, time_limit_sec: opts.timed ? suggestedSec(Math.min(count, topicTotal)) : null });

  return (
    <div className="page stack">
      <div className="row"><Link to="/practice" className="icon-btn" aria-label="Back"><IcBack /></Link><h1>{subjectName(code)}</h1></div>
      <Tabs value={tab} onChange={setTab} label="Practice by" items={[{ value: 'year', label: 'By year' }, { value: 'topic', label: 'By topic' }]} />
      {err ? <CatalogError err={err} /> : !s ? <Skel h={64} /> : tab === 'year' ? (
        <div className="year-grid">
          {(s.years ?? []).map((y) => (
            <button key={y.year} className="year" onClick={() => setYear(y)}><b className="num">{y.year}</b><span className="muted small num">{y.count} q</span></button>
          ))}
        </div>
      ) : (
        <>
          <p className="muted small">JAMB syllabus topics. Pick one or more.</p>
          <div className="topic-list">
            {(s.topics ?? []).map((t) => {
              const on = topics.includes(t.id);
              return (
                <button key={t.id} className="topic" aria-pressed={on} onClick={() => setTopics(on ? topics.filter((x) => x !== t.id) : [...topics, t.id])}>
                  <span className="tick" aria-hidden="true">{on ? '✓' : ''}</span><span className="grow">{t.name}</span><span className="muted small num">{t.count}</span>
                </button>
              );
            })}
          </div>
          {topics.length > 0 && (
            <div className="sticky-start">
              <button className="btn btn-primary btn-lg btn-block" onClick={() => setTopicSheet(true)}>
                Practise {topics.length} topic{topics.length > 1 ? 's' : ''} · {topicTotal} questions</button>
            </div>
          )}
        </>
      )}

      <Sheet open={!!year} onClose={() => setYear(null)} label="Start year paper">
        {year && (
          <div className="sheet-body stack">
            <div className="stack-sm"><h2>{subjectName(code)} {year.year}</h2><p className="muted small num">{year.count} questions, in paper order</p></div>
            <OptionsPicker value={opts} onChange={setOpts} count={year.count} />
            <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={goYear}>{busy ? 'Preparing…' : 'Start'}</button>
          </div>
        )}
      </Sheet>
      <Sheet open={topicSheet} onClose={() => setTopicSheet(false)} label="Start topic practice">
        <div className="sheet-body stack">
          <h2>Topic practice</h2>
          <div className="opt-row"><span className="small"><b>Questions</b></span>
            <div className="chip-row">{[10, 20, 40].map((n) => (
              <button key={n} className="chip" aria-pressed={count === n} disabled={n > topicTotal && n !== 10} onClick={() => setCount(n)}>{n}</button>))}</div>
          </div>
          <OptionsPicker value={opts} onChange={setOpts} count={Math.min(count, topicTotal)} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={goTopic}>{busy ? 'Preparing…' : 'Start'}</button>
        </div>
      </Sheet>
    </div>
  );
}
