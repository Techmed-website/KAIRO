import { useEffect, useState } from 'react';

// JAMB-style basic calculator: single line, + − × ÷, √, x², C (clear all), CE (clear entry).
const KEYS = ['C', 'CE', '√', 'x²', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'];
type Op = '+' | '−' | '×' | '÷';
interface S { acc: number | null; op: Op | null; cur: string; fresh: boolean; trail: string }
const INIT: S = { acc: null, op: null, cur: '0', fresh: true, trail: '' };

export function fmt(n: number): string {
  if (!isFinite(n)) return 'Error';
  const r = +n.toPrecision(10);
  return String(r).length > 12 ? r.toExponential(6) : String(r);
}
const apply = (a: number, op: Op, b: number) => (op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b);

export function press(s: S, k: string): S {
  if (/^\d$/.test(k)) return { ...s, cur: s.fresh || s.cur === '0' ? k : s.cur.length < 12 ? s.cur + k : s.cur, fresh: false };
  if (k === '.') return s.fresh ? { ...s, cur: '0.', fresh: false } : s.cur.includes('.') ? s : { ...s, cur: s.cur + '.' };
  if (k === 'C') return INIT;
  if (k === 'CE') return { ...s, cur: '0', fresh: true };
  if (k === '√') { const v = +s.cur; return { ...s, trail: `√(${s.cur})`, cur: v < 0 ? 'Error' : fmt(Math.sqrt(v)), fresh: true }; }
  if (k === 'x²') { const v = +s.cur; return { ...s, trail: `(${s.cur})²`, cur: fmt(v * v), fresh: true }; }
  if ('+−×÷'.includes(k)) {
    const acc = s.op && !s.fresh && s.acc !== null ? apply(s.acc, s.op, +s.cur) : s.acc !== null && s.op ? s.acc : +s.cur;
    return { acc, op: k as Op, cur: fmt(acc), fresh: true, trail: `${fmt(acc)} ${k}` };
  }
  if (k === '=' && s.op && s.acc !== null) {
    const b = +s.cur;
    return { acc: null, op: null, cur: fmt(apply(s.acc, s.op, b)), fresh: true, trail: `${fmt(s.acc)} ${s.op} ${fmt(b)} =` };
  }
  return s;
}

const KEYMAP: Record<string, string> = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: 'CE', Escape: 'C', Delete: 'C' };
export function keyFor(e: KeyboardEvent): string | null {
  if (/^[\d.]$/.test(e.key)) return e.key;
  return KEYMAP[e.key] ?? null;
}

export default function Calculator() {
  const [s, setS] = useState<S>(INIT);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const k = keyFor(e); if (k) { e.preventDefault(); setS((p) => press(p, k)); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="calc">
      <div className="calc-disp" aria-live="polite">
        <div className="calc-trail">{s.trail}</div>
        <div className="calc-cur num">{s.cur}</div>
      </div>
      <div className="calc-keys">
        {KEYS.map((k) => (
          <button key={k} className={`calc-key ${'+−×÷'.includes(k) ? 'op' : ''} ${['C', 'CE', '√', 'x²'].includes(k) ? 'fn' : ''} ${k === '=' ? 'eq' : ''}`}
            onClick={() => setS((p) => press(p, k))}
            aria-label={k === 'C' ? 'Clear all' : k === 'CE' ? 'Clear entry' : k === '√' ? 'Square root' : k === 'x²' ? 'Square' : k}>{k}</button>
        ))}
      </div>
    </div>
  );
}
