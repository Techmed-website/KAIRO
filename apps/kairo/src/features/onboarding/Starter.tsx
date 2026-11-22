import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { startPractice } from '../../lib/session';
import { friendlyError } from '../../lib/supabase';
import type { SubjectCode } from '../../lib/types';
import { Spinner } from '../../ui/components';

/** 10 questions from the student's own subjects, instant feedback. */
export default function Starter() {
  const { subjectCodes } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const started = useRef(false);
  const run = async () => {
    setErr('');
    const codes: SubjectCode[] = subjectCodes.length === 4 ? subjectCodes : ['ENG', 'MTH', 'PHY', 'CHM'];
    const counts = [3, 3, 2, 2];
    try {
      const id = await startPractice({ mode: 'mixed', feedback: 'instant',
        subjects: codes.map((code, i) => ({ code, count: counts[i] })) });
      nav(`/cbt/${id}`, { replace: true });
    } catch (e) { setErr(friendlyError(e)); }
  };
  useEffect(() => {
    if (started.current || !subjectCodes.length) return;
    started.current = true; run();
  }, [subjectCodes]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return (
    <div className="page no-nav center"><div className="stack" style={{ maxWidth: 360 }}>
      <p className="error">{err}</p>
      <button className="btn btn-primary btn-block" onClick={run}>Try again</button>
      <button className="btn btn-ghost btn-block" onClick={() => nav('/')}>Go to home</button>
    </div></div>
  );
  return <Spinner label="Picking 10 questions from your subjects" />;
}
