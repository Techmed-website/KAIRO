import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, type TutorResult } from './core.ts';

const base: TutorResult = {
  verdict: 'agree', correct_option: 'B', reasoning_for_editor: 'Key confirmed.',
  concept: 'In series the same current flows through each resistor, so resistances add.',
  steps: ['R = R1 + R2', 'R = 4 + 6', 'R = 10 Ω'],
  why_not: [{ option: 'A', explanation: 'You subtracted; series resistances never cancel.' },
            { option: 'C', explanation: 'You multiplied; no resistor rule multiplies resistances alone.' },
            { option: 'D', explanation: 'That is the parallel value, (4 × 6) ÷ (4 + 6) = 2.4 Ω.' }],
  tip: 'Series means add.',
};
const opts = ['A', 'B', 'C', 'D'] as const;

test('agreement with full why-not lines is saved in the app format', () => {
  const d = decide(base, 'B', [...opts]);
  assert.equal(d.action, 'save');
  if (d.action === 'save') {
    assert.match(d.explanation, /^Concept: /);
    assert.match(d.explanation, /\nWhy the other options are wrong:\nA: You subtracted/);
    assert.match(d.explanation, /\nTECHMED TIP: Series means add\.$/);
  }
});
test('a different answer is flagged for an editor, never saved', () => {
  const d = decide({ ...base, verdict: 'agree', correct_option: 'C' }, 'B', [...opts]);
  assert.deepEqual(d.action === 'flag' && [d.verdict, d.proposed], ['disagree', 'C']);
});
test('ambiguous or broken questions are flagged', () => {
  assert.equal(decide({ ...base, verdict: 'invalid' }, 'B', [...opts]).action, 'flag');
});
test('generic or missing why-not lines are sent back for a retry', () => {
  const generic = { ...base, why_not: [...base.why_not.slice(0, 2), { option: 'D' as const, explanation: 'Results from an incorrect calculation.' }] };
  assert.equal(decide(generic, 'B', [...opts]).action, 'retry');
  assert.equal(decide({ ...base, why_not: base.why_not.slice(0, 2) }, 'B', [...opts]).action, 'retry');
  assert.equal(decide(base, 'B', ['A', 'B', 'C', 'D', 'E']).action, 'retry'); // option E not explained
});

test('an editor-confirmed key is never disputed: a dissenting model output is retried, not flagged', () => {
  assert.equal(decide({ ...base, verdict: 'disagree', correct_option: 'C' }, 'B', [...opts], true).action, 'retry');
  assert.equal(decide(base, 'B', [...opts], true).action, 'save');
});
