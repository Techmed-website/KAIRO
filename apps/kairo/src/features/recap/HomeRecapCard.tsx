import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { IcNext } from '../../ui/icons';
import { loadMyRecaps, periodLabel, type Recap } from './data';
import './recap.css';

/** Home: "Your week is ready" for 3 days after a recap is built, then it lives in /recap history. */
export function HomeRecapCard() {
  const { session } = useAuth();
  const [r, setR] = useState<Recap | null>(null);
  const student = !!session && !session.user.is_anonymous;
  useEffect(() => { if (student) loadMyRecaps().then((d) => setR(d.latest?.fresh ? d.latest : null)).catch(() => setR(null)); }, [student]);
  if (!r) return null;
  const x = r.data;
  return (
    <Link to="/recap" className="card card-link rc-home">
      <div className="grow">
        <p className="eyebrow">{r.kind === 'week' ? 'Your week' : 'Your month'} is ready · {periodLabel(r)}</p>
        {x.questions ? (
          <>
            <h3 className="num">{x.questions.toLocaleString()} questions{x.accuracy != null ? ` · ${x.accuracy}%` : ''}</h3>
            <p className="muted small num">🔥 {x.streak.current}-day streak{x.beat_pct != null && x.beat_pct >= 50 ? ` · ahead of ${x.beat_pct}% of students` : ''}{x.focus_topic ? ` · next: ${x.focus_topic.name}` : ''}</p>
          </>
        ) : <h3>We missed you. See your recap and restart your run.</h3>}
      </div>
      <IcNext />
    </Link>
  );
}
