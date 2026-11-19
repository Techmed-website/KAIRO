import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/db';
import { downloadPacks, startPack } from '../../lib/session';
import { SUBJECT_NAMES } from '../../lib/subjects';
import { friendlyError } from '../../lib/supabase';
import type { OfflinePack, SubjectCode } from '../../lib/types';
import { toast } from '../../ui/components';
import { IcBack, IcDownload } from '../../ui/icons';

const ALL: SubjectCode[] = ['ENG', 'MTH', 'PHY', 'CHM', 'BIO'];

export default function Offline() {
  const nav = useNavigate();
  const { subjectCodes } = useAuth();
  const [packs, setPacks] = useState<OfflinePack[] | null>(null);
  const [subs, setSubs] = useState<SubjectCode[]>(subjectCodes.length ? subjectCodes : ['ENG']);
  const [per, setPer] = useState(2);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const load = () => db.packs.orderBy('created_at').toArray().then(setPacks);
  useEffect(() => {
    load();
    // Load the screens an offline session needs now, so they work even before the service worker has cached them.
    import('../cbt/CbtScreen'); import('../cbt/Calculator'); import('../review/Result'); import('../review/Review');
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  const download = async () => {
    setProgress([0, subs.length * per]);
    try {
      const n = await downloadPacks(subs, per, 20, (d, t) => setProgress([d, t]));
      toast(`${n} pack${n > 1 ? 's' : ''} ready to use offline`);
    } catch (e) { toast(friendlyError(e)); }
    setProgress(null); load();
  };
  const start = async (p: OfflinePack) => {
    try { nav(`/cbt/${await startPack(p)}`); } catch (e) { toast(friendlyError(e)); load(); }
  };

  return (
    <div className="page stack">
      <div className="row"><Link to="/practice" className="icon-btn" aria-label="Back"><IcBack /></Link><h1>Offline packs</h1></div>
      <p className="muted">Download practice sets while you have data. Use them anywhere, even with no network: answers save on your phone and sync when you are back online.</p>

      <section className="stack-sm">
        <h2>Ready on this phone</h2>
        {!packs ? <div className="skeleton" style={{ height: 80 }} /> : packs.length === 0 ? (
          <p className="card muted">No packs yet. Download some below.</p>
        ) : packs.map((p) => (
          <div key={p.assessment_id} className="card row-between">
            <div className="grow"><b>{p.title}</b><p className="muted small">Explanations included{p.images ? ` · ${p.images} diagram${p.images > 1 ? 's' : ''}` : ''}</p></div>
            <button className="btn btn-primary btn-sm" onClick={() => start(p)}>Start</button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2>Download more</h2>
        {!online && <p className="error small">You are offline. Connect to download packs.</p>}
        <div className="stack-sm"><span className="small"><b>Subjects</b></span>
          <div className="chip-row">{ALL.map((c) => (
            <button key={c} className="chip" aria-pressed={subs.includes(c)} onClick={() => setSubs(subs.includes(c) ? subs.filter((x) => x !== c) : [...subs, c])}>{SUBJECT_NAMES[c]}</button>))}</div></div>
        <div className="stack-sm"><span className="small"><b>Packs per subject</b> (20 questions each)</span>
          <div className="chip-row">{[1, 2, 3].map((n) => <button key={n} className="chip" aria-pressed={per === n} onClick={() => setPer(n)}>{n}</button>)}</div></div>
        <button className="btn btn-primary btn-block" disabled={!online || !subs.length || !!progress} onClick={download}>
          <IcDownload />{progress ? `Downloading ${progress[0]}/${progress[1]}…` : `Download ${subs.length * per} pack${subs.length * per > 1 ? 's' : ''}`}
        </button>
        <p className="muted small">About 30–60 KB per pack, plus diagrams.</p>
      </section>
    </div>
  );
}
