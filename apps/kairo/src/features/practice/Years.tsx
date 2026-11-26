import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { SubjectCode } from '../../lib/types';
import { CatalogError, Skel, useCatalog } from './common';
import { YearSheet } from './StartSheets';
import { BackBar } from './SubjectPractice';

/** Past papers by examination year, grouped by decade. Only years that exist in the bank are shown. */
export default function Years() {
  const { code = 'ENG' } = useParams();
  const subject = code as SubjectCode;
  const { cat, err } = useCatalog();
  const [year, setYear] = useState<{ year: number; count: number } | null>(null);
  const s = cat?.find((x) => x.code === subject);
  const years = [...(s?.years ?? [])].sort((a, b) => b.year - a.year);
  const decades = [...new Set(years.map((y) => Math.floor(y.year / 10) * 10))];

  return (
    <div className="page px">
      <BackBar name="Years" to={`/practice/${subject}`} parent={s?.name ?? 'Subject'} />
      <div className="stack-sm"><h1>Browse by year</h1><p className="muted small">Real past papers in {s?.name ?? 'this subject'}, in paper order. Tap a year to start.</p></div>
      {err ? <CatalogError err={err} /> : !s ? <Skel h={64} n={4} /> : years.length === 0 ? (
        <p className="card muted">No dated past papers in this subject yet. Try browsing by topic.</p>
      ) : decades.map((d) => (
        <section key={d} className="stack-sm" aria-label={`${d}s`}>
          <h3 className="decade num">{d}s</h3>
          <div className="year-grid">
            {years.filter((y) => Math.floor(y.year / 10) * 10 === d).map((y) => (
              <button key={y.year} type="button" className="year" onClick={() => setYear(y)} aria-label={`${y.year}, ${y.count} questions`}>
                <b className="num">{y.year}</b><span className="muted small num">{y.count} q</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <YearSheet subject={subject} name={s?.name ?? ''} year={year} onClose={() => setYear(null)} />
    </div>
  );
}
