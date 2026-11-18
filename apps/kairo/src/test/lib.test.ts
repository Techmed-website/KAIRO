import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { formatExplanation, parseExplanation } from '../lib/explain';
import { sanitize } from '../lib/sanitize';
import { aggregate, aggregate400, clock, scoreBySubject, to100 } from '../lib/score';
import { press } from '../features/cbt/Calculator';
import type { PaperQuestion } from '../lib/types';

const q = (id: string, subject: PaperQuestion['subject'], key: 'A' | 'B'): PaperQuestion => ({
  id, version: 1, position: 1, stem_html: '', passage_html: null, options: [], subject, year: 2020, media_url: null, topic_id: 1, correct_option: key,
});

describe('scoring in JAMB terms', () => {
  it('rounds each subject to /100', () => {
    expect(to100(27, 40)).toBe(68); // 67.5 -> 68
    expect(to100(0, 0)).toBe(0);
    expect(to100(60, 60)).toBe(100);
  });
  it('scores per subject and sums a mock to /400', () => {
    const qs = [q('1', 'ENG', 'A'), q('2', 'ENG', 'A'), q('3', 'PHY', 'B'), q('4', 'CHM', 'A'), q('5', 'BIO', 'A')];
    const ans = { '1': { selected: 'A' as const, time_ms: 0, flagged: false }, '2': { selected: 'B' as const, time_ms: 0, flagged: false },
      '3': { selected: 'B' as const, time_ms: 0, flagged: false }, '5': { selected: 'A' as const, time_ms: 0, flagged: false } };
    const s = scoreBySubject(qs, ans);
    expect(s.map((x) => [x.code, x.score100])).toEqual([['ENG', 50], ['PHY', 100], ['CHM', 0], ['BIO', 100]]);
    expect(aggregate400(s)).toBe(250);
    expect(aggregate400(s.slice(0, 3))).toBeNull();
    expect(aggregate(s)).toEqual({ score: 250, max: 400 });
    expect(aggregate(s.slice(1, 4))).toEqual({ score: 200, max: 300 });
    expect(aggregate(s.slice(0, 1))).toEqual({ score: 50, max: 100 });
  });
  it('formats the timer', () => {
    expect(clock(7200)).toBe('2:00:00');
    expect(clock(299.4)).toBe('04:59');
    expect(clock(-3)).toBe('00:00');
  });
});

describe('explanation parsing', () => {
  it('splits the why-not block and assigns lines to options', () => {
    const p = parseExplanation('Hund\'s rule gives 3.\n\nWhy the other options are wrong:\nB: You paired two.\nC: Only the last one.\ncontinued here\nD: Noble gas.');
    expect(p?.main).toBe("Hund's rule gives 3.");
    expect(p?.whyNot).toEqual({ B: 'You paired two.', C: 'Only the last one. continued here', D: 'Noble gas.' });
  });
  it('keeps a plain explanation and returns null for empty', () => {
    expect(parseExplanation('Just this.')).toEqual({ main: 'Just this.', whyNot: {} });
    expect(parseExplanation('   ')).toBeNull();
    expect(parseExplanation(null)).toBeNull();
  });
});

describe('sanitizing third-party HTML', () => {
  it('keeps formatting, sup/sub, tables and /qimg images', () => {
    const out = sanitize('<p>H<sub>2</sub>O<sup>2</sup> <em>x</em></p><table><tr><td>1</td></tr></table><img src="/qimg/a-1.webp">');
    expect(out).toContain('<sub>2</sub>');
    expect(out).toContain('<td>1</td>');
    expect(out).toContain('src="/qimg/a-1.webp"');
  });
  it('drops scripts, handlers, styles and outside images', () => {
    const out = sanitize('<img src="https://evil.example/x.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:x">l</a><span style="color:red" onclick="x">t</span>');
    expect(out).not.toMatch(/script|onerror|onclick|evil|javascript|style/);
    expect(out).toContain('t');
  });
  it('leaves LaTeX untouched for KaTeX', () => {
    expect(sanitize('\\(x^2 + y\\)')).toBe('\\(x^2 + y\\)');
  });
});

describe('JAMB calculator', () => {
  const run = (keys: string[]) => keys.reduce((s, k) => press(s, k), { acc: null, op: null, cur: '0', fresh: true, trail: '' } as Parameters<typeof press>[0]).cur;
  it('does chained arithmetic left to right', () => {
    expect(run(['1', '2', '+', '3', '×', '2', '='])).toBe('30');
    expect(run(['7', '÷', '2', '='])).toBe('3.5');
    expect(run(['0', '.', '1', '+', '0', '.', '2', '='])).toBe('0.3');
  });
  it('supports √, x², C and CE', () => {
    expect(run(['8', '1', '√'])).toBe('9');
    expect(run(['1', '2', 'x²'])).toBe('144');
    expect(run(['5', '+', '9', 'CE', '3', '='])).toBe('8');
    expect(run(['5', '+', '9', 'C'])).toBe('0');
    expect(run(['1', '÷', '0', '='])).toBe('Error');
  });
});

describe('outbox', () => {
  beforeEach(() => { vi.resetModules(); });
  it('retries with back-off, then marks synced only after the server replies', async () => {
    let fail = true;
    const rpc = vi.fn(async () => (fail ? { data: null, error: { message: 'boom' } } : { data: { status: 'final', score: 3, total: 5, reject_reason: null }, error: null }));
    vi.doMock('../lib/supabase', () => ({ cbt: () => ({ rpc }) }));
    const { db } = await import('../lib/db');
    const { enqueueSubmit, flushOutbox } = await import('../lib/sync');
    const a = { id: 'a1', assessment_id: 's1', title: 't', type: 'practice', instant: true, time_limit_sec: null, started_at: new Date().toISOString(),
      deadline_at: null, clock_offset_ms: 0, answers: { q1: { selected: 'A', time_ms: 1234.6, flagged: true } }, current: 0, status: 'submitted',
      sync: 'local', updated_at: 0 } as never;
    await db.attempts.put(a);
    await enqueueSubmit(a, [{ id: 'q1', version: 2 }, { id: 'q2', version: 1 }]);
    expect((await db.attempts.get('a1'))?.sync).toBe('failed');
    const item = await db.outbox.get('a1');
    expect(item?.tries).toBe(1);
    expect(item?.next_at).toBeGreaterThan(Date.now());
    const payload = item?.payload as { answers: { question_id: string; selected: string | null; time_ms: number; flagged: boolean; version: number }[] };
    expect(payload.answers).toEqual([
      { question_id: 'q1', version: 2, selected: 'A', time_ms: 1235, flagged: true },
      { question_id: 'q2', version: 1, selected: null, time_ms: 0, flagged: false },
    ]);
    await flushOutbox();                // not due yet: no new call
    expect(rpc).toHaveBeenCalledTimes(1);
    fail = false;
    await flushOutbox(true);
    expect((await db.attempts.get('a1'))?.sync).toBe('synced');
    expect((await db.attempts.get('a1'))?.server?.score).toBe(3);
    expect(await db.outbox.count()).toBe(0);
  });
});

import { chemSubscripts, dollarMathToLatex } from '../lib/notation';
describe('notation repairs', () => {
  it('turns $…$ maths into KaTeX delimiters but leaves prices alone', () => {
    expect(dollarMathToLatex('Ammonium chloride ($NH_4Cl$) and ($NH_4^+$)')).toBe('Ammonium chloride (\\(NH_4Cl\\)) and (\\(NH_4^+\\))');
    expect(dollarMathToLatex('It costs $5 and $10 today')).toBe('It costs $5 and $10 today');
    expect(dollarMathToLatex('$$x^2$$')).toBe('$$x^2$$');
  });
  it('subscripts chemical formulas only', () => {
    expect(chemSubscripts('NH4Cl and H2SO4, C6H12O6, Ca(OH)2.')).toBe('NH<sub>4</sub>Cl and H<sub>2</sub>SO<sub>4</sub>, C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>, Ca(OH)<sub>2</sub>.');
    expect(chemSubscripts('Question 12, Year 2015, A1, X2 and 2NaCl')).toBe('Question 12, Year 2015, A1, X2 and 2NaCl');
    expect(chemSubscripts('H<sub>2</sub>O and \\(CO_2\\) and <img src="/qimg/a2.webp">')).toBe('H<sub>2</sub>O and \\(CO_2\\) and <img src="/qimg/a2.webp">');
  });
});

describe('TECHMED explanation format', () => {
  it('round-trips concept, steps, why-not and tip', () => {
    const text = formatExplanation({ concept: 'One mole of H2SO4 holds 4 moles of O atoms.', steps: ['1 mol → 4 mol O', '0.5 × 4 = 2.0 mol'],
      whyNot: { D: 'That is for 1 mole.', A: 'Assumes one O per molecule.' }, tip: 'Multiply by the subscript.' });
    expect(text.split('\n')[0]).toBe('Concept: One mole of H2SO4 holds 4 moles of O atoms.');
    const p = parseExplanation(text)!;
    expect(p.concept).toBe('One mole of H2SO4 holds 4 moles of O atoms.');
    expect(p.steps).toEqual(['1 mol → 4 mol O', '0.5 × 4 = 2.0 mol']);
    expect(p.whyNot).toEqual({ A: 'Assumes one O per molecule.', D: 'That is for 1 mole.' });
    expect(p.tip).toBe('Multiply by the subscript.');
    expect(p.main).toBe('');
  });
});

import { mastery } from '../features/performance/Performance';
describe('mastery labels', () => {
  it('waits for 10 answered before judging a topic', () => {
    expect(mastery(9, 100)).toEqual({ label: 'Keep going · 9/10', tone: 'new' });
    expect(mastery(10, 80).label).toBe('Strong');
    expect(mastery(20, 65).label).toBe('Getting there');
    expect(mastery(12, 40).label).toBe('Needs work');
  });
});

import { checkExplanation } from '../features/editor/Editor';
describe('editor explanation check', () => {
  const q = { options: [{ key: 'A' as const, html: 'a' }, { key: 'B' as const, html: 'b' }, { key: 'C' as const, html: 'c' }] };
  it('needs a concept and a why-not line for every wrong option, none for the key', () => {
    expect(checkExplanation('Steps:\n1. x', q, 'A')).toMatch(/concept/);
    expect(checkExplanation('Concept: c\nWhy the other options are wrong:\nB: no', q, 'A')).toBe('Explain why C is wrong.');
    expect(checkExplanation('Concept: c\nWhy the other options are wrong:\nA: x\nB: y\nC: z', q, 'A')).toMatch(/should not have/);
    expect(checkExplanation('Concept: c\nWhy the other options are wrong:\nB: y\nC: z\nTECHMED TIP: t', q, 'A')).toBeNull();
  });
});
