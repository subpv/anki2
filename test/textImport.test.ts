import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotesJson, repairLatexBackslashes } from '../server/textImport.ts';

test('repairs single LaTeX backslashes but keeps real escapes', () => {
  const raw = String.raw`{"a":"$\frac{1}{2}\rho v^2$ and \alpha, \nabla, \theta, \times","b":"line1\nline2\tTab \"q\" \\sqrt{x} é"}`;
  const { text, repaired } = repairLatexBackslashes(raw);
  const v = JSON.parse(text);
  assert.equal(v.a, String.raw`$\frac{1}{2}\rho v^2$ and \alpha, \nabla, \theta, \times`);
  assert.equal(v.b, 'line1\nline2\tTab "q" \\sqrt{x} é');
  assert.equal(repaired, 6);
  // Already correct JSON is left alone.
  const good = JSON.stringify({ a: String.raw`\frac{a}{b} \rho` });
  assert.equal(repairLatexBackslashes(good).text, good);
});

test('parses all card types and reports problems per note', () => {
  const ok = parseNotesJson(JSON.stringify({
    course: 'Fluids',
    notes: [
      { type: 'basic', front: 'Q', back: 'A', tags: ['a', 'b'], source: 'L3' },
      { type: 'cloze', text: '{{c1::KCL}} and {{c2::KVL}}' },
      { type: 'numeric', question: 'I?', value: '2,5', unit: 'mA' },
      { type: 'param', question: '{{a}}+1', vars: [{ name: 'a', min: 1, max: 5 }], formula: 'a+1' },
      { type: 'formula', name: 'Ohm', latex: 'U=RI', symbols: [{ sym: 'U', meaning: 'V' }], rearrangements: [{ solveFor: 'I', latex: 'I=U/R' }] },
      { type: 'code', prompt: 'p', language: 'rust', code: 'x' },
      { type: 'derivation', title: 't', steps: ['a', 'b'] },
      { type: 'vocab', word: 'en hund', meaning: 'der Hund', picture: '🐕' },
    ],
  }));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.course, 'Fluids');
  assert.equal(ok.notes.length, 8);
  assert.equal(ok.notes[0].tags, 'a b');
  assert.equal(ok.notes[2].data.value, 2.5);
  assert.equal(ok.notes[2].data.tolerance, 2);
  assert.equal(ok.notes[5].data.language, 'text');
  assert.ok(ok.notes[4].data.rearrangements[0].id);

  const bad = parseNotesJson('```json\n[{"type":"basic","front":"Q"},{"type":"cloze","text":"no cloze"},{"type":"numeric","question":"q","value":"x"},{"type":"spaceship"},{"type":"param","question":"q","formula":"a","vars":[{"name":"1a","min":0,"max":1}]}]\n```');
  assert.deepEqual(bad.problems.map((p) => [p.index, p.code, p.field]), [
    [1, 'missing', 'back'], [2, 'no-cloze', 'text'], [3, 'not-number', 'value'], [4, 'unknown-type', 'spaceship'], [5, 'bad-var', '1a'],
  ]);
  assert.equal(parseNotesJson('{"notes": [').problems[0].code, 'invalid-json');
  assert.equal(parseNotesJson('{"cards": []}').problems[0].code, 'no-notes');
});
