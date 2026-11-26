import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db';
import { scoreBySubject } from '../../lib/score';
import type { CatalogSubject, LocalAttempt, SubjectCode } from '../../lib/types';
import { IcArrowRight, IcBolt, IcClipboard, IcDownload, IcHistory, IcNext, IcSliders } from '../../ui/icons';
import { SUBJECT_ICONS } from '../../ui/subjectIcons';
import { BANK_ORDER, CatalogError, Skel, useCatalog, useStart, useTopicStats } from './common';

interface Recent { a: LocalAttempt; pct: number | null }

export default function PracticeHub() {
  const { cat, err } = useCatalog();
  const { busy, start } = useStart();
  const [quick, setQuick] = useState<SubjectCode | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const stats = useTopicStats();

  useEffect(() => {
    db.attempts.where('status').equals('submitted').toArray().then(async (list) => {
      list.sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''));
      const out: Recent[] = [];
      for (const a of list.slice(0, 3)) {
        const p = await db.papers.get(a.assessment_id);
        const correct = a.server?.score ?? (p ? scoreBySubject(p.questions, a.answers).reduce((x, s) => x + s.correct, 0) : null);
        const total = a.server?.total ?? p?.questions.length ?? 0;
        out.push({ a, pct: correct != null && total ? Math.round((100 * correct) / total) : null });
      }
      setRecent(out);
    }).catch(() => setRecent([]));
  }, []);

  const bySubject = new Map((cat ?? []).map((s) => [s.code, s]));
  const subjects = BANK_ORDER.map((c) => bySubject.get(c)).filter(Boolean) as CatalogSubject[];
  const topicName = new Map((cat ?? []).flatMap((s) => (s.topics ?? []).map((t) => [t.id, { name: t.name, code: s.code }] as const)));
  const recentTopics = stats ? [...stats.values()].filter((t) => t.last_attempt_at && topicName.has(t.topic_id))
    .sort((a, b) => (b.last_attempt_at ?? '').localeCompare(a.last_attempt_at ?? '')).slice(0, 3) : [];

  const goQuick = (code: SubjectCode) => { setQuick(code); start({ mode: 'mixed', subjects: [{ code, count: 10 }], feedback: 'instant' }); };

  return (
    <div className="page px">
      <header className="brand">
        <div className="brand-mark"><h1 className="px-title">Practice</h1><span className="tagline">Seize the moment.</span></div>
        <Link to="/history" className="hdr-btn" aria-label="Practice history"><IcHistory /></Link>
      </header>

      <section className="px-intro">
        <h2>What would you like to practise?</h2>
        <p className="muted">Choose your learning mode and keep building.</p>
      </section>

      <section className="mock-hero" aria-labelledby="h-mock">
        <div className="row-between"><span className="pill-gold">Exam simulation</span><span className="mock-ic" aria-hidden="true"><IcClipboard /></span></div>
        <h3 id="h-mock">Full JAMB Mock</h3>
        <p className="muted">Experience a complete JAMB-standard examination.</p>
        <ul className="mock-meta num" aria-label="Mock format"><li><b>180</b> questions</li><li><b>2</b> hours</li><li><b>400</b> marks</li></ul>
        <Link to="/practice/mock" className="btn btn-accent btn-lg btn-block cta">Start full mock <IcArrowRight /></Link>
      </section>

      <div className="mode-duo">
        <Link to="/practice/mixed" className="mode">
          <span className="gold-ic" aria-hidden="true"><IcSliders /></span>
          <b>Custom practice</b>
          <span className="muted small">Choose subjects, topics, years and question count.</span>
          <span className="gold-link small">Build a session <IcArrowRight /></span>
        </Link>
        <Link to="/practice/offline" className="mode">
          <span className="gold-ic" aria-hidden="true"><IcDownload /></span>
          <b>Offline packs</b>
          <span className="muted small">Download question sets and practise without internet.</span>
          <span className="gold-link small">Explore packs <IcArrowRight /></span>
        </Link>
      </div>

      <section className="quick" aria-labelledby="h-quick">
        <div className="row"><IcBolt className="quick-bolt" aria-hidden="true" /><div className="grow"><h3 id="h-quick">Quick practice</h3><p className="muted small">10 questions, answers as you go. Tap a subject to start.</p></div></div>
        <div className="quick-row">
          {BANK_ORDER.map((c) => {
            const I = SUBJECT_ICONS[c];
            return (
              <button key={c} type="button" className={`quick-btn s-${c}`} disabled={busy} onClick={() => goQuick(c)} aria-label={`Start 10 ${bySubject.get(c)?.name ?? c} questions`}>
                <I aria-hidden="true" /><span>{busy && quick === c ? '…' : shortName(c)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="h-bank">
        <div className="sec-head"><h2 id="h-bank">Question bank</h2></div>
        <p className="muted small">Choose a subject to explore its past questions.</p>
        {err ? <CatalogError err={err} /> : !cat ? <Skel h={76} n={5} /> : (
          <div className="bank">
            {subjects.map((s) => {
              const I = SUBJECT_ICONS[s.code];
              const years = s.years?.length ?? 0, topics = s.topics?.length ?? 0;
              return (
                <Link key={s.code} to={`/practice/${s.code}`} className={`bank-row s-${s.code}`}>
                  <span className="tint-ic" aria-hidden="true"><I /></span>
                  <span className="grow"><b>{s.name}</b><span className="muted small num">{years} year{years === 1 ? '' : 's'} · {topics} topic{topics === 1 ? '' : 's'}</span></span>
                  <span className="bank-n num"><b>{s.count.toLocaleString()}</b><small>questions</small></span>
                  <IcNext className="chev" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {((recent && recent.length > 0) || recentTopics.length > 0) && (
        <section className="stack-sm" aria-labelledby="h-recent">
          <div className="sec-head"><h2 id="h-recent">Recent practice</h2><Link to="/history" className="sec-link">History <IcArrowRight /></Link></div>
          {recentTopics.length > 0 && (
            <div className="chip-row recent-topics">
              {recentTopics.map((t) => {
                const n = topicName.get(t.topic_id)!;
                return <Link key={t.topic_id} to={`/practice/${n.code}/topics?t=${t.topic_id}`} className="chip num">{n.name} · {Math.round((100 * t.correct) / t.attempted)}%</Link>;
              })}
            </div>
          )}
          {(recent ?? []).map(({ a, pct }) => (
            <Link key={a.id} to={`/result/${a.id}`} className="card card-link row-between recent-row">
              <span className="grow"><b>{a.title}</b><span className="muted small" style={{ display: 'block' }}>{new Date(a.submitted_at!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></span>
              {pct != null && <span className="badge num">{pct}%</span>}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

const SHORT: Record<SubjectCode, string> = { ENG: 'English', PHY: 'Physics', CHM: 'Chem', BIO: 'Biology', MTH: 'Maths' };
const shortName = (c: SubjectCode) => SHORT[c];
