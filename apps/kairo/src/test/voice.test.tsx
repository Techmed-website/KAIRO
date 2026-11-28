import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function mount(node: ReactNode) {
  const el = document.createElement('div'); document.body.appendChild(el);
  await act(async () => { createRoot(el).render(node); });
  return el;
}

// Server stand-in: remembers submitted ids (like the real primary key) and can simulate a dropped connection.
const server = { offline: false, saved: new Map<string, unknown>(), calls: [] as string[] };
vi.mock('../lib/analytics', () => ({ track: vi.fn(), trackPage: vi.fn(), flush: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1', is_anonymous: false } }, loading: false, profile: { full_name: 'Ada Obi' } }) }));
vi.mock('../lib/supabase', () => ({
  cbt: () => ({
    rpc: async (fn: string, args: { p?: { id: string; consent?: boolean } }) => {
      server.calls.push(fn);
      if (server.offline) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
      if (fn === 'voice_submit_testimonial' && !args.p?.consent) return { data: null, error: { message: 'Tick the consent box', code: '22023' } };
      if (fn.startsWith('voice_submit_')) {
        const dup = server.saved.has(args.p!.id); server.saved.set(args.p!.id, args.p);
        return { data: { ok: true, id: args.p!.id, duplicate: dup }, error: null };
      }
      return { data: null, error: null };
    },
  }),
  friendlyError: (e: { message?: string }) => e?.message ?? String(e),
}));

import { flushOutbox, isNetworkError, outboxSize, submitFeedback, submitTestimonial } from '../features/voice/api';
import { TestimonialForm } from '../features/voice/Pages';
import { StarInput } from '../features/voice/Voice';

beforeEach(() => { server.offline = false; server.saved.clear(); server.calls = []; localStorage.clear(); vi.useRealTimers(); });

describe('Student Voice client', () => {
  it('tells a dropped connection from a server refusal', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isNetworkError({ message: 'Choose a star rating.', code: '22023' })).toBe(false);
    expect(isNetworkError({ message: 'admins only', code: '42501' })).toBe(false);
  });

  it('sends a rating once', async () => {
    const r = await submitFeedback({ category: 'overall', rating: 4, trigger: 'voluntary' });
    expect(r.status).toBe('sent');
    expect(server.saved.size).toBe(1);
  });

  it('keeps feedback on the phone when offline and sends it once when back online', async () => {
    server.offline = true;
    const r = await submitFeedback({ category: 'technical', body: 'Leaderboard will not load', trigger: 'voluntary' });
    expect(r.status).toBe('queued');
    expect(outboxSize()).toBe(1);
    expect(server.saved.size).toBe(0);
    server.offline = false;
    expect(await flushOutbox()).toBe(1);
    expect(outboxSize()).toBe(0);
    expect(server.saved.has(r.id)).toBe(true);
    // A second flush (e.g. two 'online' events) sends nothing more.
    expect(await flushOutbox()).toBe(0);
    expect(server.saved.size).toBe(1);
  }, 10000);

  it('never submits a testimonial without consent', async () => {
    await expect(submitTestimonial({ body: 'KAIRO helped me a lot with chemistry.', display_mode: 'anon', consent: false })).rejects.toThrow(/consent/i);
    expect(server.calls).not.toContain('voice_submit_testimonial');
  });

  it('testimonial form: consent box starts unticked and the submit button stays disabled until it is ticked', async () => {
    const el = await mount(<MemoryRouter><TestimonialForm /></MemoryRouter>);
    const box = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    const area = el.querySelector('#vc-t-body') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(area, 'The daily quiz keeps me practising every morning.'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Submit review') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await act(async () => { box.click(); });
    expect(submit.disabled).toBe(false);
  });

  it('star input is a keyboard-accessible radio group', async () => {
    const onChange = vi.fn();
    const el = await mount(<StarInput value={0} onChange={onChange} label="Rate" />);
    const radios = el.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(5);
    await act(async () => { (radios[3] as HTMLInputElement).click(); });
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
