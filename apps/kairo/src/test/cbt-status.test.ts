import { describe, expect, it } from 'vitest';
import { syncText, timerLevel } from '../features/cbt/status';

describe('exam timer level', () => {
  it('JAMB mock (2 h): gold at 5 min, red at 1 min', () => {
    expect(timerLevel(3600, 7200)).toBe('normal');
    expect(timerLevel(300, 7200)).toBe('warn');
    expect(timerLevel(61, 7200)).toBe('warn');
    expect(timerLevel(60, 7200)).toBe('critical');
  });
  it('5-minute daily quiz: scaled, not gold from the start', () => {
    expect(timerLevel(290, 300)).toBe('normal');
    expect(timerLevel(60, 300)).toBe('warn');
    expect(timerLevel(30, 300)).toBe('critical');
  });
  it('untimed', () => expect(timerLevel(null, null)).toBe('normal'));
});

describe('save status', () => {
  it('never says Saved for the server unless confirmed', () => {
    expect(syncText('saved', true).short).toBe('Saved');
    expect(syncText('phone', true).short).toBe('On phone');
    expect(syncText('pending', true).short).toBe('Sync pending');
    expect(syncText('offline', true).short).toBe('Offline');
    expect(syncText('error', true).short).toBe('Not saved');
    expect(syncText('phone', false).long).toMatch(/sent when you submit/);
  });
});
