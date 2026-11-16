import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, fmtNum, parseQuantity } from '../shared/units.ts';
import { cardOrds, clozeIndices } from '../shared/types.ts';

test('parses numbers with decimal comma, exponent and unit', () => {
  assert.deepEqual(parseQuantity('4,7 kΩ'), { value: 4.7, unit: 'kΩ' });
  assert.deepEqual(parseQuantity('2.5e-3A'), { value: 0.0025, unit: 'A' });
  assert.deepEqual(parseQuantity('3 x 10^8 m/s'), { value: 3e8, unit: 'm/s' });
  assert.equal(parseQuantity('abc'), null);
});

test('accepts other SI prefixes of the expected unit', () => {
  assert.equal(checkAnswer('2.553 mA', 2.553, 'mA', 2).ok, true);
  assert.equal(checkAnswer('0.002553 A', 2.553, 'mA', 2).ok, true);
  assert.equal(checkAnswer('2553 uA', 2.553, 'mA', 2).ok, true);
  assert.equal(checkAnswer('4.7 kohm', 4700, 'Ω', 1).ok, true);
  assert.equal(checkAnswer('120 mm', 0.12, 'm', 1).ok, true);
  assert.equal(checkAnswer('0.12 m', 120, 'mm', 1).ok, true);
  assert.equal(checkAnswer('1.5 MPa', 1500, 'kPa', 1).ok, true);
});

test('metre is not read as a milli prefix', () => {
  assert.equal(checkAnswer('5 m', 5, 'm', 1).ok, true);
  assert.equal(checkAnswer('5 m', 5, 's', 1).kind, 'unit');
});

test('tolerance, wrong unit and missing unit', () => {
  assert.equal(checkAnswer('2.60 mA', 2.553, 'mA', 2).ok, true);
  assert.equal(checkAnswer('2.61 mA', 2.553, 'mA', 2).kind, 'wrong');
  assert.equal(checkAnswer('2.553 V', 2.553, 'mA', 2).kind, 'unit');
  assert.equal(checkAnswer('2.553', 2.553, 'mA', 2).kind, 'missing-unit');
  assert.equal(checkAnswer('7', 2.553, 'mA', 2).kind, 'wrong');
  assert.equal(checkAnswer('0.5', 0.5, '', 1).ok, true);
  assert.equal(checkAnswer('-3 N', -3, 'N', 0).ok, true);
});

test('formats numbers without float noise', () => {
  assert.equal(fmtNum(0.1 + 0.2), '0.3');
  assert.equal(fmtNum(2553.19), '2553');
  assert.equal(fmtNum(1.5e-5), '1.5e-5');
});

test('card keys per note type', () => {
  assert.deepEqual(clozeIndices('{{c2::a}} {{c1::b}} {{c2::c}}'), [1, 2]);
  assert.deepEqual(cardOrds('basic', { reverse: true }), ['f', 'r']);
  assert.deepEqual(cardOrds('formula', { symbols: [{}], rearrangements: [{ id: 'x' }] }), ['recall', 'symbols', 'r:x']);
  assert.deepEqual(cardOrds('occlusion', { rects: [{ id: 'a' }, { id: 'b' }] }), ['o:a', 'o:b']);
});
