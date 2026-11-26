import { describe, expect, it } from 'vitest';
import { bandFor } from '../features/review/Encourage';
import { questionLabel } from '../lib/label';

describe('result bands (encourage, then the next step)', () => {
  it('uses a 60% pass mark by default: pass ≥ 60, neutral 40–59, below 40 needs support', () => {
    expect(bandFor(60)).toBe('pass');
    expect(bandFor(100)).toBe('pass');
    expect(bandFor(59.9)).toBe('neutral');
    expect(bandFor(40)).toBe('neutral');
    expect(bandFor(39)).toBe('fail');
    expect(bandFor(0)).toBe('fail');
  });
  it('follows the quiz pass mark from result_config', () => {
    expect(bandFor(70, { pass_mark: 80 })).toBe('neutral');
    expect(bandFor(55, { pass_mark: 80 })).toBe('fail');
  });
});

describe('question labels', () => {
  it('only a verified JAMB year is a past question', () => {
    expect(questionLabel({ year: 2019, source: 'jamb' })).toBe('JAMB Past Question, 2019');
    expect(questionLabel({ year: 2019, source: undefined })).toBe('JAMB Past Question, 2019');
    expect(questionLabel({ year: null, source: 'jamb' })).toBe('Practice Question');
    expect(questionLabel({ year: null, source: 'techmed' })).toBe('TECHMED Practice Question');
    expect(questionLabel({ year: 2024, source: 'techmed' })).toBe('TECHMED Practice Question');
  });
});

import { analysisLines, topicResults, weakestTopic } from '../features/review/AttemptInsights';
import { bandMessage } from '../features/review/Encourage';
import type { PaperQuestion } from '../lib/types';

const q = (id: string, topic: number | null, key: 'A' | 'B' = 'A') => ({ id, topic_id: topic, correct_option: key, subject: 'CHM' }) as unknown as PaperQuestion;

describe('result: what to practise next', () => {
  const qs = [q('1', 10), q('2', 10), q('3', 20), q('4', 20), q('5', 20), q('6', 30), q('7', null)];
  const ans = { 1: 'A', 2: 'B', 3: 'B', 4: 'B', 5: 'A', 6: 'A', 7: 'B' } as Record<string, 'A' | 'B'>;
  const answers = Object.fromEntries(Object.entries(ans).map(([k, v]) => [k, { selected: v, time_ms: 0, flagged: false }]));
  it('scores topics from answered questions, weakest first', () => {
    const t = topicResults(qs, answers);
    expect(t.map((x) => [x.tid, x.c, x.n])).toEqual([[20, 1, 3], [10, 1, 2], [30, 1, 1]]);
  });
  it('picks the weakest topic that has a miss', () => {
    expect(weakestTopic(topicResults(qs, answers))?.tid).toBe(20);
    expect(weakestTopic([{ tid: 1, c: 2, n: 2, pct: 1 }])).toBeNull();
  });
  it('blank answers do not count against a topic', () => {
    expect(topicResults([q('1', 10)], {})).toEqual([]);
  });
});

describe('result: analysis lines', () => {
  it('only says what the data supports, at most four lines', () => {
    const base = { answered: 10, avg_sec: 20, community_avg_sec: 30, community_pct: 50, peers: 40, peer_avg_pct: 50, percentile: 72, beat_the_crowd: 2, missed_easy: 1, slow: 0 };
    const l = analysisLines(base);
    expect(l[0]).toContain('higher than 72% of 40');
    expect(l[1]).toContain('faster than');
    expect(l.length).toBe(4);
    expect(analysisLines({ ...base, percentile: null, avg_sec: null, beat_the_crowd: 0, missed_easy: 0 })).toEqual([]);
    expect(analysisLines({ ...base, peers: 2 }).some((x) => x.includes('higher than'))).toBe(false);
  });
});

describe('result: quiz message', () => {
  it('same quote for the same attempt, overridable per quiz', () => {
    expect(bandMessage(80, null, 'abc').quote).toBe(bandMessage(80, null, 'abc').quote);
    expect(bandMessage(80, { pass: { quote: 'Custom' } }, 'abc').quote).toBe('Custom');
    expect(bandMessage(20, null, 'x').band).toBe('fail');
  });
});
