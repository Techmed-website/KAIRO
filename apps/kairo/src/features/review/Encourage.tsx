import type { ResultConfig, SubjectCode } from '../../lib/types';
import { IcArrowRight } from '../../ui/icons';

/**
 * After a quiz: encourage first (TECHMED is known for that), then one gentle, optional pointer to classes.
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

/** Headline, quote and optional image for a quiz result (quote chosen steadily per attempt, overridable per quiz). */
export function bandMessage(pct: number, cfg: ResultConfig | null | undefined, seed: string) {
  const band = bandFor(pct, cfg);
  const pick = QUOTES[band][[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % QUOTES[band].length];
  return { band, headline: HEADLINE[band], quote: cfg?.[band]?.quote || pick, image: cfg?.[band]?.image };
}

const SITE = 'https://techmedng.com';
const utm = (band: Band, what: string) => `utm_source=kairo&utm_medium=quiz_result&utm_campaign=${band}&utm_content=${what}`;
const RESOURCE: Partial<Record<SubjectCode, { label: string; path: string }>> = {
  CHM: { label: 'The Mole Concept Cure', path: '/resources/mole-concept-cure/' },
  PHY: { label: 'Physics Calculation Workbook', path: '/resources/physics-calculation-workbook/' },
};
const COPY: Record<Band, string> = {
  pass: 'Want this to be your normal? TECHMED tutors teach the why behind every answer.',
  neutral: 'A tutor can walk you through these exact topics. A little guidance closes the gap fast.',
  fail: 'Practise free on KAIRO as often as you like. When you want a guide by your side, TECHMED classes are here.',
};

/** One quiet, optional card: classes, plus the subject's resource where TECHMED has one. */
export function ClassesNudge({ band, subject }: { band: Band; subject: SubjectCode | null }) {
  const res = subject ? RESOURCE[subject] : undefined;
  return (
    <aside className="r-nudge" aria-label="TECHMED classes">
      <p className="small">{COPY[band]}</p>
      <div className="row wrap">
        <a className="gold-link small" href={`${SITE}/pricing/?${utm(band, 'classes')}`} target="_blank" rel="noopener">See TECHMED classes <IcArrowRight /></a>
        {res && <a className="muted small" href={`${SITE}${res.path}?${utm(band, 'resources')}`} target="_blank" rel="noopener">{res.label}</a>}
      </div>
    </aside>
  );
}

/** TECHMED-branded art (navy and gold) until per-quiz images are supplied in result_config. */
export function BandArt({ band, size = 56 }: { band: Band; size?: number }) {
  return (
    <svg className="enc-img" width={size} height={size} viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="42" fill="#011236" />
      <circle cx="42" cy="42" r="36" fill="none" stroke="#c9a227" strokeWidth="2" opacity=".6" />
      {band === 'pass' && <path d="M28 24h28v8a14 14 0 0 1-28 0zM24 26h4v6a6 6 0 0 1-4-6zM60 26h-4v6a6 6 0 0 0 4-6zM38 46h8v8h6v6H32v-6h6z" fill="#c9a227" />}
      {band === 'neutral' && <path d="M22 56l14-14 8 8 14-16v8h4V26H46v4h8L44 42l-8-8-18 18z" fill="#c9a227" />}
      {band === 'fail' && <path d="M42 60V40m0 0c0-8 6-13 14-13 0 8-6 13-14 13zm0 4c0-7-5-11-12-11 0 7 5 11 12 11z" stroke="#c9a227" strokeWidth="4" fill="none" strokeLinecap="round" />}
    </svg>
  );
}
