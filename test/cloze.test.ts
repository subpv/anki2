import test from 'node:test';
import assert from 'node:assert/strict';
import { clozeIndices, clozeSource, parseCloze } from '../shared/cloze.ts';
import { checkAnswer, parseQuantity } from '../shared/units.ts';

test('cloze gaps with LaTeX braces, hints and display math', () => {
  const t = 'Area $A = {{c1::\\frac{\\pi d^2}{4}}}$, {{c2::Ohm::law}} and $$ {{c3::x^{2}}} $$';
  const g = parseCloze(t);
  assert.deepEqual(g.map((x) => [x.index, x.answer, x.hint, x.math]), [
    [1, '\\frac{\\pi d^2}{4}', '', 'inline'],
    [2, 'Ohm', 'law', null],
    [3, 'x^{2}', '', 'display'],
  ]);
  assert.deepEqual(clozeIndices(t), [1, 2, 3]);
  // Card 1: the formula is blanked inside the math, the other gaps show their answer.
  const q = clozeSource(t, 1, false);
  assert.equal(q, 'Area $A = \\textcolor{#e8632a}{\\underline{\\;\\text{?}\\;}}$, Ohm and $$ x^{2} $$');
  assert.equal(clozeSource(t, 3, true), 'Area $A = \\frac{\\pi d^2}{4}$, Ohm and $$ \\textcolor{#e8632a}{x^{2}} $$');
  assert.equal(clozeSource(t, 2, false), 'Area $A = \\frac{\\pi d^2}{4}$, <span class="cloze blank">law</span> and $$ x^{2} $$');
  // An escaped dollar is not math; an unclosed gap stays as text.
  assert.equal(parseCloze('costs \\$5 {{c1::a}}')[0].math, null);
  assert.deepEqual(parseCloze('{{c1::open'), []);
  // A hint inside math cannot break out of \text{…}.
  assert.match(clozeSource('${{c1::x::a}b}}$', 1, false), /\\text\{a\\\}b\}/);
});

test('numbers with a Unicode minus sign', () => {
  assert.equal(parseQuantity('−3,5 V')?.value, -3.5);
  assert.equal(checkAnswer('−2 mA', -0.002, 'A', 1).ok, true);
});
