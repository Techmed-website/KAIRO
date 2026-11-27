import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _internal, deviceCategory, flush, routeFeature, track, trackPage } from '../lib/analytics';
import { addDays, daysBetween, describe as describeItem, lagosToday, presetRange } from '../features/founder/data';
import { buildInsights } from '../features/founder/Overview';
import type { FeatureRow, Kpis } from '../features/founder/data';

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), onAuthStateChange: () => ({}) } },
  cbt: () => ({}),
}));

describe('route → feature mapping', () => {
  it('maps KAIRO routes to features without ids', () => {
    expect(routeFeature('/')).toEqual({ path: '/', feature: 'home' });
    expect(routeFeature('/practice/chm/topics')).toMatchObject({ path: '/practice/:code/topics', feature: 'topic_practice', subject: 'CHM' });
    expect(routeFeature('/practice/BIO/years')).toMatchObject({ feature: 'year_practice', subject: 'BIO' });
    expect(routeFeature('/practice/PHY')).toMatchObject({ feature: 'question_bank' });
    expect(routeFeature('/practice/mixed')?.feature).toBe('custom_practice');
    expect(routeFeature('/practice/offline')?.feature).toBe('offline');
    expect(routeFeature('/review/abc')).toMatchObject({ path: '/review/:id', feature: 'results', entity: 'abc' });
    expect(routeFeature('/q/xyz')).toMatchObject({ feature: 'daily_quiz', entity: 'xyz' });
    expect(routeFeature('/leaderboard')?.feature).toBe('leaderboard');
  });
  it('never tracks the exam runner or staff screens', () => {
    expect(routeFeature('/cbt/123')).toBeNull();
    expect(routeFeature('/editor/quizzes')).toBeNull();
    expect(routeFeature('/founder/live')).toBeNull();
  });
  it('device categories', () => {
    expect(deviceCategory(390)).toBe('mobile'); expect(deviceCategory(800)).toBe('tablet'); expect(deviceCategory(1440)).toBe('desktop');
  });
});

describe('tracker', () => {
  beforeEach(() => { _internal.reset(); localStorage.clear(); vi.restoreAllMocks(); });

  it('queues without network calls and starts a session first', () => {
    const f = vi.spyOn(globalThis, 'fetch');
    track('user_login');
    expect(f).not.toHaveBeenCalled();
    expect(_internal.queue.map((e) => e.name)).toEqual(['user_session_started', 'user_login']);
    expect(new Set(_internal.queue.map((e) => e.id)).size).toBe(2);
    expect(_internal.queue[1].session_id).toBe(_internal.queue[0].session_id);
  });
  it('ignores an immediate repeat of the same page (strict mode / redirects) and adds a review event', () => {
    trackPage('/leaderboard'); trackPage('/leaderboard');
    trackPage('/review/r1');
    const names = _internal.queue.map((e) => e.name);
    expect(names.filter((n) => n === 'page_viewed')).toHaveLength(2);
    expect(names).toContain('answer_review_opened');
    trackPage('/cbt/a1');
    expect(_internal.queue.some((e) => e.path?.startsWith('/cbt'))).toBe(false);
  });
  it('sends a batch once and clears it; keeps it when the network fails; never throws', async () => {
    track('page_viewed', { feature: 'home', path: '/' });
    const ok = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('1', { status: 200 }));
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((ok.mock.calls[0][1] as RequestInit).body));
    expect(body.p_events.length).toBe(2);
    expect((ok.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'Content-Profile': 'cbt', Authorization: 'Bearer tok' });
    expect(_internal.queue).toHaveLength(0);

    track('study_plan_saved');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(flush()).resolves.toBeUndefined();
    expect(_internal.queue.map((e) => e.name)).toContain('study_plan_saved');
    expect(JSON.parse(localStorage.getItem('kairo-events') || '[]').length).toBeGreaterThan(0);
  });
  it('caps the queue at 200 events', () => {
    for (let i = 0; i < 260; i++) track('page_viewed', { feature: 'home' });
    expect(_internal.queue.length).toBeLessThanOrEqual(200);
  });
});

describe('reporting periods (Lagos)', () => {
  it('today is the Lagos date, not UTC', () => {
    expect(lagosToday(new Date('2026-11-26T23:30:00Z'))).toBe('2026-11-27'); // 00:30 WAT
    expect(lagosToday(new Date('2026-11-26T22:59:00Z'))).toBe('2026-11-26');
  });
  it('presets', () => {
    expect(presetRange('relaunch', '2026-11-27')).toEqual({ from: '2026-11-24', to: '2026-11-27', preset: 'relaunch' });
    expect(presetRange('7d', '2026-11-27')).toMatchObject({ from: '2026-11-21', to: '2026-11-27' });
    expect(presetRange('yesterday', '2026-12-01')).toMatchObject({ from: '2026-11-30', to: '2026-11-30' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-11-24', '2026-11-27')).toBe(3);
  });
  it('describes feed items in plain words', () => {
    expect(describeItem({ kind: 'started', name: 'practice_started', feature: 'topic_practice', subject: 'CHM', questions: 10, props: {} }))
      .toBe('Started Chemistry topic practice — 10 questions');
    expect(describeItem({ kind: 'completed', name: 'quiz_completed', feature: 'daily_quiz', subject: null, questions: 10, props: {} }))
      .toBe('Completed the Daily Builder Quiz — 10 questions');
    expect(describeItem({ kind: 'opened', name: 'page_viewed', feature: 'leaderboard', subject: null, questions: null, props: {} })).toBe('Opened Leaderboard');
  });
});

describe('insights only when the data supports them', () => {
  const k = (o: Partial<Kpis> = {}): Kpis => ({
    registrations: 0, active_users: 0, dau_avg: 0, dau_last: 0, wau: 0, mau: 0, returning_users: 0, new_active_users: 0, questions: 0,
    practice_started: 0, practice_completed: 0, practice_abandoned: 0, quiz_started: 0, quiz_completed: 0, mock_started: 0, mock_completed: 0,
    guest_plays: 0, guests: 0, q_returning: null, q_first_time: null, n_returning_with_q: 0, n_first_time_with_q: 0, ...o });
  it('nothing from tiny samples', () => {
    expect(buildInsights(k({ registrations: 3, practice_started: 4, practice_completed: 1 }), k({ registrations: 1 }), true, [], 'previous 1 day')).toEqual([]);
  });
  it('registrations change needs a comparable earlier period', () => {
    expect(buildInsights(k({ registrations: 40 }), k({ registrations: 20 }), false, [], 'x')).toEqual([]);
    const [i] = buildInsights(k({ registrations: 40 }), k({ registrations: 20 }), true, [], 'previous 7 days');
    expect(i.text).toMatch(/increased/); expect(i.evidence).toContain('40 vs 20'); expect(i.evidence).toContain('+100%');
  });
  it('practice drop-off, returning vs first-time, and low-completion features', () => {
    const f: FeatureRow = { feature: 'custom_practice', label: 'Custom (mixed) practice', primary_kind: 'attempt', primary_event: null, users: 30, opens: 0, openers: 0,
      starts: 40, starters: 30, completions: 12, completers: 10, abandoned: 20, repeat_users: 5, returned_users: 6 };
    const out = buildInsights(k({ practice_started: 50, practice_completed: 20, practice_abandoned: 25, q_returning: 40, q_first_time: 12,
      n_returning_with_q: 8, n_first_time_with_q: 20 }), k(), true, [f], 'x');
    const texts = out.map((i) => i.text).join(' | ');
    expect(texts).toMatch(/start practice but do not complete/);
    expect(texts).toMatch(/Returning students answer more/);
    expect(texts).toMatch(/high starts but low completion/);
  });
});
