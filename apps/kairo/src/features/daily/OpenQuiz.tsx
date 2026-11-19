import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { startAssessment } from '../../lib/session';
import { friendlyError } from '../../lib/supabase';
import { Spinner } from '../../ui/components';

/** /q/:id — the link TECHMED shares (WhatsApp, website): starts that quiz straight away. */
export default function OpenQuiz() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    startAssessment(id).then((a) => live && nav(`/cbt/${a}`, { replace: true })).catch((e) => live && setErr(friendlyError(e)));
    return () => { live = false; };
  }, [id, nav]);
  if (!err) return <Spinner label="Opening the quiz" />;
  return (
    <div className="page stack">
      <h1>This quiz could not open</h1>
      <p className="card error">{err}</p>
      <Link className="btn btn-primary btn-block" to="/daily">See all daily quizzes</Link>
    </div>
  );
}
