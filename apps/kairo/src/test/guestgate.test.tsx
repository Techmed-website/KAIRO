import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = { guest: true, finished: 0 };
const card = { id: 'q1', title: 'Day 17 Daily Builder Quiz', slug: 's', type: 'daily_quiz', status: 'live', opens_at: null, closes_at: null, question_count: 10,
  time_limit_sec: 300, guests_allowed: true, has_passcode: false, ranked: true, prize_text: null, players: 5 };

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1', is_anonymous: state.guest } }, loading: false, profile: null }) }));
vi.mock('../lib/guest', () => ({ guestFinishedCount: async () => state.finished, claimRank: async () => {}, linkGoogle: async () => {}, saveGuestAccount: async () => 'saved' }));
vi.mock('../lib/analytics', () => ({ track: vi.fn(), trackPage: vi.fn(), flush: vi.fn() }));
vi.mock('../lib/session', () => ({ PasscodeError: class extends Error {}, startAssessment: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInAnonymously: async () => ({ error: null }) } },
  cbt: () => ({ rpc: async () => ({ data: card, error: null }) }),
  friendlyError: (e: unknown) => String(e),
}));

import OpenQuiz from '../features/daily/OpenQuiz';
import { track } from '../lib/analytics';

async function render() {
  const el = document.createElement('div'); document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(<MemoryRouter initialEntries={['/q/q1']}><Routes><Route path="/q/:id" element={<OpenQuiz />} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

describe('one free guest quiz, then a sign-up wall', () => {
  beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; });
  it('a guest who has not finished a quiz can start', async () => {
    state.guest = true; state.finished = 0;
    const el = await render();
    expect(el.textContent).toContain('Start quiz');
    expect(el.textContent).not.toContain('Create your free account to play on');
  });
  it('a guest who already finished one sees the wall instead of Start', async () => {
    state.guest = true; state.finished = 1;
    const el = await render();
    expect(el.textContent).toContain('Create your free account to play on');
    expect(el.textContent).not.toContain('Start quiz');
    expect(el.querySelector('input[type="email"]')).not.toBeNull();
    expect(track).toHaveBeenCalledWith('guest_gate_shown', expect.anything());
  });
  it('a signed-in student is never walled', async () => {
    state.guest = false; state.finished = 5;
    const el = await render();
    expect(el.textContent).toContain('Start quiz');
    expect(el.textContent).not.toContain('Create your free account to play on');
  });
});
