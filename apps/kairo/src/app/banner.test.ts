import { describe, expect, it } from 'vitest';
import { visible } from './Banner';

describe('announcement banner', () => {
  const on = { kairoActive: true, kairoMessage: 'Hi' };
  it('needs active and a message', () => {
    expect(visible(on)).toBe(true);
    expect(visible({ ...on, kairoActive: false })).toBe(false);
    expect(visible({ kairoActive: true })).toBe(false);
    expect(visible(null)).toBe(false);
  });
  it('respects start and end dates', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    expect(visible({ ...on, startDate: '2026-11-20T00:00:00Z' }, now)).toBe(false);
    expect(visible({ ...on, endDate: '2026-11-18T00:00:00Z' }, now)).toBe(false);
    expect(visible({ ...on, startDate: '2026-11-18T00:00:00Z', endDate: '2026-11-20T00:00:00Z' }, now)).toBe(true);
  });
});
