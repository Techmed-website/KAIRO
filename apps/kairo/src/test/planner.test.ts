import { describe, expect, it } from 'vitest';
import { buildPlan, getWeekForDate, topicKey } from '../lib/planner/engine';
import { FALLBACK_SUBJECTS } from '../lib/planner/syllabus';
import { kairoTopics, SLUG_CODE } from '../lib/planner/topicMap';

// Syllabus topics that genuinely have no matching topic in KAIRO's question bank yet.
const UNMAPPED = new Set(['mathematics|Variation', 'use-of-english|Homonyms', 'use-of-english|Punctuation', 'use-of-english|Spelling',
  'use-of-english|Examination Structure', 'use-of-english|Question Distribution', 'use-of-english|Section Strategy']);

describe('planner', () => {
  it('every Blueprint subject has a KAIRO subject code', () => {
    for (const s of FALLBACK_SUBJECTS) expect(SLUG_CODE[s.slug]).toBeTruthy();
  });
  it('every syllabus topic maps to question-bank topics, except the known gaps', () => {
    for (const s of FALLBACK_SUBJECTS) for (const st of s.stages) for (const t of st.topics) {
      const ids = kairoTopics(s.slug, t.title);
      if (UNMAPPED.has(`${s.slug}|${t.title}`)) expect(ids).toEqual([]);
      else expect(ids.length, `${s.slug}: ${t.title}`).toBeGreaterThan(0);
    }
  });
  it('builds a plan with stable topic keys', () => {
    const input = { targetDate: '2027-04-20', availableDays: [1, 2, 3, 4, 5, 6], hoursPerAvailableDay: 2, createdAt: '2026-11-26',
      subjects: [{ slug: 'use-of-english', confidence: 'medium' as const, startingStageIndex: 0 }, { slug: 'chemistry', confidence: 'low' as const, startingStageIndex: 0 }] };
    const done = new Set([topicKey('chemistry', 1, 'Chemical Combination')]);
    const plan = buildPlan({ input, allSubjects: FALLBACK_SUBJECTS, alreadyCompletedKeys: done });
    const keys = plan.weeks.flatMap((w) => w.topics.map((t) => t.key));
    expect(keys).not.toContain(topicKey('chemistry', 1, 'Chemical Combination'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(getWeekForDate(plan, '2026-11-27')?.weekNumber).toBe(1);
    expect(getWeekForDate(plan, '2030-01-01')?.weekNumber).toBe(plan.weeks[plan.weeks.length - 1].weekNumber);
  });
});
