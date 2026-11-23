import { Link } from 'react-router-dom';
import type { ResultConfig, SubjectCode } from '../../lib/types';

/**
 * After a quiz: encourage first (TECHMED is known for that), then point to the next step that fits the score.
 * Strong score: go further with classes. Close: a little guidance closes the gap. Low: learn free on KAIRO first, help is there.
 * Never promises a score or admission. Images and quotes can be replaced per quiz in result_config.
 */
export type Band = 'pass' | 'neutral' | 'fail';

export function bandFor(pct: number, cfg?: ResultConfig | null): Band {
  const pass = cfg?.pass_mark ?? 60;
  if (pct >= pass) return 'pass';
  if (pct >= pass - 20) return 'neutral';
  return 'fail';
}

const QUOTES: Record<Band, string[]> = {
  pass: [
    'Excellence is a habit, and you are building it.',
    'This is what preparation looks like. Keep stacking days like this.',
    'Builders don’t guess. You just proved it.',
  ],
  neutral: [
    'You are closer than you think. A few fixes and you are there.',
    'Progress, not perfection. Every review moves you up.',
    'Good foundation. Now let’s sharpen the edges.',
  ],
  fail: [
    'A low score today is information, not a verdict.',
    'Every Builder starts somewhere. The explanations are your fastest teacher.',
    'Mistakes here are mistakes you won’t make in JAMB.',
  ],
};
const HEADLINE: Record<Band, string> = {
  pass: 'Builder standard!',
  neutral: 'So close. Keep going!',
  fail: 'Don’t stop now. This is how it starts.',
};

const SITE = 'https://techmedng.com';
const utm = (band: Band, what: string) => `utm_source=kairo&utm_medium=quiz_result&utm_campaign=${band}&utm_content=${what}`;
const RESOURCE: Partial<Record<SubjectCode, { label: string; path: string }>> = {
  CHM: { label: 'The Mole Concept Cure', path: '/resources/mole-concept-cure/' },
  PHY: { label: 'Physics Calculation Workbook', path: '/resources/physics-calculation-workbook/' },
};

export function Encourage({ pct, cfg, subject, seed }: { pct: number; cfg?: ResultConfig | null; subject: SubjectCode | null; seed: string }) {
  const band = bandFor(pct, cfg);
  const pick = QUOTES[band][[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % QUOTES[band].length];
  const quote = cfg?.[band]?.quote || pick;
  const image = cfg?.[band]?.image;
  const res = (subject && RESOURCE[subject]) || { label: 'TECHMED study resources', path: '/resources/' };
  const classes = `${SITE}/pricing/?${utm(band, 'classes')}`;
  const resources = `${SITE}${res.path}?${utm(band, 'resources')}`;
  const practise = subject ? `/practice/${subject}` : '/practice';

  return (
    <section className={`card enc enc-${band}`} aria-label="How you did">
      <div className="enc-top">
        {image ? <img src={image} alt="" width={84} height={84} className="enc-img" /> : <BandArt band={band} />}
        <div className="stack-sm grow">
          <p className="enc-h">{HEADLINE[band]}</p>
          <p className="enc-q">“{quote}”</p>
        </div>
      </div>
      <div className="enc-next">
        {band === 'pass' && <>
          <p>You clearly put in the work. TECHMED live classes go beyond past questions, with tutors who teach the <i>why</i> behind every answer, so a good day becomes your normal.</p>
          <div className="enc-ctas">
            <a className="btn btn-accent" href={classes} target="_blank" rel="noopener">See TECHMED classes</a>
            <a className="btn" href={resources} target="_blank" rel="noopener">{res.label}</a>
          </div>
        </>}
        {band === 'neutral' && <>
          <p>You are nearly there. Read the explanations below, then let a TECHMED tutor walk you through these exact topics. A little guidance closes the gap fast.</p>
          <div className="enc-ctas">
            <a className="btn btn-accent" href={classes} target="_blank" rel="noopener">Get help in live classes</a>
            <a className="btn" href={resources} target="_blank" rel="noopener">{res.label}</a>
          </div>
        </>}
        {band === 'fail' && <>
          <p>Go through every explanation below, then practise this topic free on KAIRO, as often as you like. When you want a guide by your side, TECHMED classes are here for you.</p>
          <div className="enc-ctas">
            <Link className="btn btn-accent" to={practise}>Practise this topic free</Link>
            <a className="btn" href={classes} target="_blank" rel="noopener">See TECHMED classes</a>
          </div>
        </>}
        <p className="muted small">Free on KAIRO: thousands of JAMB past questions with explanations. No activation code, no PIN.</p>
      </div>
    </section>
  );
}

/** TECHMED-branded placeholder art (navy and gold) until QuizBoot-style images are supplied in result_config. */
function BandArt({ band }: { band: Band }) {
  return (
    <svg className="enc-img" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="42" fill="#011236" />
      <circle cx="42" cy="42" r="36" fill="none" stroke="#c9a227" strokeWidth="2" opacity=".6" />
      {band === 'pass' && <path d="M28 24h28v8a14 14 0 0 1-28 0zM24 26h4v6a6 6 0 0 1-4-6zM60 26h-4v6a6 6 0 0 0 4-6zM38 46h8v8h6v6H32v-6h6z" fill="#c9a227" />}
      {band === 'neutral' && <path d="M22 56l14-14 8 8 14-16v8h4V26H46v4h8L44 42l-8-8-18 18z" fill="#c9a227" />}
      {band === 'fail' && <path d="M42 60V40m0 0c0-8 6-13 14-13 0 8-6 13-14 13zm0 4c0-7-5-11-12-11 0 7 5 11 12 11z" stroke="#c9a227" strokeWidth="4" fill="none" strokeLinecap="round" />}
    </svg>
  );
}
