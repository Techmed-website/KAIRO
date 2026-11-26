import { describe, expect, it } from 'vitest';
import { countdown } from '../features/leaderboard/Leaderboard';
import { levelProgress } from '../features/progress/progress';
import { badgeIcon } from '../features/progress/Badges';
import { IcFlame, IcMedal, IcTrophy } from '../ui/icons';

describe('leaderboard reset countdown', () => {
  it('days and hours, hours and minutes, minutes', () => {
    expect(countdown((2 * 1440 + 4 * 60 + 30) * 60000)).toBe('2d 4h');
    expect(countdown((3 * 60 + 12) * 60000)).toBe('3h 12m');
    expect(countdown(8 * 60000 + 5000)).toBe('8m');
    expect(countdown(20000)).toBe('1m');
    expect(countdown(0)).toBeNull();
  });
});

describe('level progress', () => {
  it('share of the way from this level to the next', () => {
    expect(levelProgress({ total: 174, floor: 100, next: 300, level: 2, today: 0, week: 0, week_ends_at: '', tier: 'Bronze' })).toBeCloseTo(0.37);
    expect(levelProgress({ total: 100, floor: 100, next: 300, level: 2, today: 0, week: 0, week_ends_at: '', tier: 'Bronze' })).toBe(0);
  });
});

describe('badge artwork', () => {
  it('every badge gets a line icon, never an emoji', () => {
    expect(badgeIcon('streak_14')).toBe(IcFlame);
    expect(badgeIcon('weekly_champion')).toBe(IcTrophy);
    expect(badgeIcon('something_new')).toBe(IcMedal);
  });
});
