import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { IcNext } from '../../ui/icons';
import { CatalogError, Skel, useCatalog } from './common';

export default function PracticeHub() {
  const { cat, err } = useCatalog();
  const { subjectCodes } = useAuth();
  const sorted = cat ? [...cat].sort((a, b) => Number(subjectCodes.includes(b.code)) - Number(subjectCodes.includes(a.code))) : null;
  return (
    <div className="page stack">
      <h1>Practice</h1>
      <div className="duo">
        <Link to="/practice/mock" className="card card-link feature"><p className="eyebrow">Full mock</p><b>JAMB standard</b><span className="muted small">180 questions · 2 h · /400</span></Link>
        <Link to="/practice/mixed" className="card card-link feature"><p className="eyebrow">Mixed</p><b>Build your own</b><span className="muted small">Subjects, years, timer</span></Link>
      </div>
      <Link to="/practice/offline" className="card card-link row-between">
        <div className="grow"><b>Offline packs</b><p className="muted small">Download sets now, practise with no network later</p></div>
        <IcNext width={20} height={20} />
      </Link>
      <h2>By subject</h2>
      {err ? <CatalogError err={err} /> : !sorted ? <Skel /> : (
        <div className="stack-sm">
          {sorted.map((s) => (
            <Link key={s.code} to={`/practice/${s.code}`} className="card card-link row-between">
              <div className="grow"><b>{s.name}</b><p className="muted small num">{s.count.toLocaleString()} questions · {s.years?.length ?? 0} years · {s.topics?.length ?? 0} topics</p></div>
              <IcNext width={20} height={20} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
