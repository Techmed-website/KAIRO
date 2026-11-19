import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kvSet } from '../../lib/db';
import { canInstallAndroid, isIOS, isStandalone, promptInstall } from '../../lib/install';
import { IcShare } from '../../ui/icons';
import './onboarding.css';

export default function Install() {
  const nav = useNavigate();
  const [android, setAndroid] = useState(canInstallAndroid());
  useEffect(() => { kvSet('starter-done', true); if (isStandalone()) nav('/', { replace: true }); }, [nav]);
  useEffect(() => { const t = setInterval(() => setAndroid(canInstallAndroid()), 800); return () => clearInterval(t); }, []);
  const done = () => nav('/', { replace: true });
  return (
    <div className="page no-nav stack install">
      <div className="steps-dots" aria-label="Step 3 of 3"><i className="on" /><i className="on" /><i className="on" /></div>
      <img src="/icons/icon-192.png" alt="" width={88} height={88} className="install-icon" />
      <div className="stack-sm" style={{ textAlign: 'center' }}>
        <h1>Keep KAIRO on your phone</h1>
        <p className="muted">Open it in one tap like an app. It loads fast, uses little data, and keeps your answers safe when the network drops.</p>
      </div>
      {isIOS() ? (
        <ol className="ios-steps card">
          <li>Tap <b>Share</b> <IcShare width={18} height={18} /> at the bottom of Safari.</li>
          <li>Scroll and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b>. KAIRO appears on your home screen.</li>
        </ol>
      ) : android ? (
        <button className="btn btn-accent btn-lg btn-block" onClick={async () => { if (await promptInstall()) done(); }}>Install KAIRO</button>
      ) : (
        <ol className="ios-steps card">
          <li>Open your browser menu <b>⋮</b>.</li>
          <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
        </ol>
      )}
      <button className="btn btn-ghost btn-block" onClick={done}>Maybe later</button>
    </div>
  );
}
