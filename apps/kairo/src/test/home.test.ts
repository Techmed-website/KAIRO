import { describe, expect, it } from 'vitest';
import { dailyState, greeting, initials, longDate, pct, type HomeQuiz } from '../features/home/data';

const q: HomeQuiz = { id: 'a', title: 't', day_number: 1, topic_label: null, subject: null, subject_code: null, question_count: 10,
  time_limit_sec: 300, opens_at: '', is_today: true, players: 0, best: null, in_progress: null, result: null };

describe('Home daily card state', () => {
  it('loading, error and none', () => {
    expect(dailyState(undefined, false)).toBe('loading');
    expect(dailyState(q, true)).toBe('error');
    expect(dailyState(null, false)).toBe('none');
    expect(dailyState({ ...q, is_today: false }, false)).toBe('none');
  });
  it('ready, in progress, done', () => {
    expect(dailyState(q, false)).toBe('ready');
    expect(dailyState({ ...q, in_progress: { attempt_id: 'x', deadline_at: null, answered: 2 } }, false)).toBe('in_progress');
    // A retry in progress never hides a finished quiz.
    expect(dailyState({ ...q, in_progress: { attempt_id: 'x', deadline_at: null, answered: 2 }, result: { attempt_id: 'r', score: 7, total: 10, answered: 10 } }, false)).toBe('done');
  });
});

describe('Home helpers', () => {
  it('greets by local hour', () => {
    expect(greeting(new Date(2026, 10, 26, 7))).toBe('Good morning');
    expect(greeting(new Date(2026, 10, 26, 13))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 10, 26, 20))).toBe('Good evening');
  });
  it('dates, initials, percentages', () => {
    expect(longDate(new Date(2026, 10, 26))).toBe('Thursday, 26 November');
    expect(initials('Wisdom Johnson')).toBe('WJ');
    expect(initials('Ada')).toBe('A');
    expect(initials('')).toBe('K');
    expect(pct(868, 1240)).toBe(70);
    expect(pct(3, 0)).toBe(0);
  });
});
