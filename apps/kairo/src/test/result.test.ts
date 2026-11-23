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
