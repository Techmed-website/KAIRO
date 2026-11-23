import { beforeEach, describe, expect, it } from 'vitest';
import { sharedSessionStorage as s } from '../lib/sharedSession';

const KEY = 'sb-test-auth-token';
const clearCookies = () => document.cookie.split('; ').forEach((c) => { const n = c.split('=')[0]; if (n) document.cookie = `${n}=; Path=/; Max-Age=0`; });

describe('shared session cookie storage', () => {
  beforeEach(() => { clearCookies(); localStorage.clear(); });

  it('round-trips a small value', () => {
    s.setItem(KEY, '{"user":{"id":"u1"}}');
    expect(s.getItem(KEY)).toBe('{"user":{"id":"u1"}}');
  });

  it('splits a big session across cookies and reads it back whole', () => {
    const big = JSON.stringify({ access_token: 'a'.repeat(2500), refresh_token: 'r'.repeat(40), user: { id: 'u1', note: 'é€'.repeat(300) } });
    s.setItem(KEY, big);
    expect(document.cookie.split('; ').filter((c) => c.startsWith(`${KEY}.`)).length).toBeGreaterThan(1);
    expect(s.getItem(KEY)).toBe(big);
  });

  it('removes every chunk, including leftovers from a longer earlier value', () => {
    s.setItem(KEY, 'x'.repeat(4500));
    s.setItem(KEY, 'short');
    expect(document.cookie).not.toContain(`${KEY}.1=`);
    s.removeItem(KEY);
    expect(s.getItem(KEY)).toBeNull();
    expect(document.cookie).not.toContain(KEY);
  });

  it('moves a pre-existing localStorage session into the cookie (nobody is signed out by the switch)', () => {
    localStorage.setItem(KEY, '{"user":{"id":"old"}}');
    expect(s.getItem(KEY)).toBe('{"user":{"id":"old"}}');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.cookie).toContain(`${KEY}.0=`);
  });
});
