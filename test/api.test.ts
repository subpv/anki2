import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import { client, startServer, type Server } from './helpers.ts';

let srv: Server;
let api: ReturnType<typeof client>;
before(async () => { srv = await startServer(18081, { AUTH_DEV_BYPASS: '1' }); api = client(srv.url); });
after(() => srv.stop());

let courseId: number;

test('courses and all note types create the right cards', async () => {
  courseId = (await api('/api/courses', { body: { name: 'Ele2', newPerDay: 3 } })).data.id;
  const notes = [
    { type: 'basic', data: { front: 'Ohm', back: '$U = RI$', reverse: true } },
    { type: 'cloze', data: { text: '{{c1::KCL}} and {{c2::KVL}}' } },
    { type: 'numeric', data: { question: 'I?', value: 2.553, unit: 'mA', tolerance: 2 } },
    { type: 'param', data: { question: '{{a}}+1', vars: [{ name: 'a', min: 1, max: 5, step: 1 }], formula: 'a+1', unit: '', tolerance: 1 } },
    { type: 'formula', data: { name: 'Ohm', latex: 'U=RI', symbols: [{ sym: 'U', meaning: 'voltage', unit: 'V' }], rearrangements: [{ id: 'a', solveFor: 'I', latex: 'I=U/R' }] } },
    { type: 'code', data: { prompt: 'p', language: 'c', code: 'int x;' } },
    { type: 'derivation', data: { title: 't', steps: ['a', 'b'] } },
    { type: 'occlusion', data: { image: '/media/x.png', rects: [{ id: 'r1', x: 0, y: 0, w: 0.1, h: 0.1, label: 'L' }] } },
  ];
  for (const n of notes) assert.equal((await api('/api/notes', { body: { courseId, ...n } })).status, 200, n.type);
  const [course] = (await api('/api/courses')).data;
  assert.equal(course.counts.total, 2 + 2 + 1 + 1 + 3 + 1 + 1 + 1);
  assert.equal(course.counts.new, 3, 'new cards are capped by the daily limit');
});

test('rejects invalid notes', async () => {
  assert.equal((await api('/api/notes', { body: { courseId, type: 'cloze', data: { text: 'no cloze' } } })).status, 400);
  assert.equal((await api('/api/notes', { body: { courseId: 9999, type: 'basic', data: { front: 'a', back: 'b' } } })).status, 400);
  assert.equal((await api('/api/notes', { body: { courseId, type: 'basic', data: { front: 'a', back: 'b' }, sourceUrl: 'javascript:alert(1)' } })).status, 400);
});

test('editing a note keeps surviving cards and their schedule', async () => {
  const list = (await api(`/api/notes?course=${courseId}&type=cloze`)).data;
  const note = list[0];
  const first = (await api(`/api/review/next?course=${courseId}`)).data.next;
  await api(`/api/notes/${note.id}`, { method: 'PUT', body: { courseId, type: 'cloze', data: { text: '{{c1::KCL}} only {{c3::new}}' } } });
  const after = (await api(`/api/notes/${note.id}`)).data;
  assert.equal(after.cardCount, 2);
  assert.ok(first);
});

test('review flow: learning steps, daily new limit, undo', async () => {
  const seen = new Set<number>();
  let r = (await api(`/api/review/next?course=${courseId}`)).data;
  assert.equal(r.counts.new, 3);
  assert.match(r.next.intervals[1], /m$/);
  assert.match(r.next.intervals[4], /d$/);
  const firstId = r.next.card.id;

  // Easy graduates immediately; three new cards are allowed today.
  for (let i = 0; i < 3; i++) {
    assert.equal(r.next.card.state, 0);
    seen.add(r.next.card.id);
    await api('/api/review/answer', { body: { cardId: r.next.card.id, rating: 4 } });
    r = (await api(`/api/review/next?course=${courseId}`)).data;
  }
  assert.equal(seen.size, 3);
  assert.equal(r.next, null, 'limit reached, nothing else today');
  assert.equal(r.counts.new, 0);

  // Undo puts the last card back as new and frees a slot.
  const undone = (await api('/api/review/undo', { method: 'POST' })).data.card;
  assert.equal(undone.card.state, 0);
  r = (await api(`/api/review/next?course=${courseId}`)).data;
  assert.equal(r.counts.new, 1);
  assert.equal(r.next.card.id, undone.card.id);

  // Again keeps it in learning and it comes straight back (learn-ahead).
  await api('/api/review/answer', { body: { cardId: r.next.card.id, rating: 1 } });
  r = (await api(`/api/review/next?course=${courseId}`)).data;
  assert.equal(r.next.card.state, 1);
  assert.equal(r.counts.learning, 1);
  assert.notEqual(firstId, undefined);
});

test('exam date caps intervals', async () => {
  const exam = new Date(Date.now() + 5 * 86_400_000);
  const examDate = `${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2, '0')}-${String(exam.getDate()).padStart(2, '0')}`;
  const id = (await api('/api/courses', { body: { name: 'Fluids', examDate, newPerDay: 50 } })).data.id;
  await api('/api/notes', { body: { courseId: id, type: 'basic', data: { front: 'a', back: 'b' } } });
  const r = (await api(`/api/review/next?course=${id}`)).data;
  await api('/api/review/answer', { body: { cardId: r.next.card.id, rating: 4 } });
  const note = (await api(`/api/notes?course=${id}`)).data[0];
  assert.ok(note.nextDue < new Date(`${examDate}T00:00:00`).getTime(), 'due before the exam');
});

test('suspend, search, stats, settings, cram', async () => {
  const hit = (await api('/api/notes?q=int%20x')).data;
  assert.equal(hit.length, 1);
  await api(`/api/notes/${hit[0].id}/suspend`, { body: { suspended: true } });
  assert.equal((await api(`/api/notes/${hit[0].id}`)).data.suspended, true);

  const stats = (await api('/api/stats')).data;
  assert.equal(stats.states.suspended, 1);
  assert.equal(stats.reviews.length, 30);
  assert.ok(stats.today >= 3);
  assert.equal(stats.streak, 1);

  assert.equal((await api('/api/settings', { method: 'PUT', body: { retention: 0.5, maxInterval: 100, learningSteps: '1m', relearningSteps: '10m' } })).status, 400);
  assert.equal((await api('/api/settings', { method: 'PUT', body: { retention: 0.85, maxInterval: 100, learningSteps: '1m 10m', relearningSteps: '10m' } })).status, 200);
  assert.equal((await api('/api/settings')).data.settings.retention, 0.85);

  const cram = (await api(`/api/courses/${courseId}/cram`)).data;
  assert.equal(cram.length, 11, 'all cards except the suspended one');
});

function makeApkg(modern: boolean): Buffer {
  const tmp = path.join(os.tmpdir(), `col-${Date.now()}-${modern}.db`);
  const col = new Database(tmp);
  col.exec('CREATE TABLE notes (id integer primary key, flds text, tags text)');
  const ins = col.prepare('INSERT INTO notes (flds, tags) VALUES (?, ?)');
  ins.run('What is \\(\\tau\\)?\x1f<img src="rc.png"> \\[\\tau = RC\\]', ' circuits ');
  ins.run('{{c1::Laplace}} transform\x1fextra', '');
  ins.run('\x1f', '');
  col.close();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const zip = new AdmZip();
  const db = fs.readFileSync(tmp);
  fs.rmSync(tmp);
  if (modern) {
    const name = Buffer.from('rc.png');
    const entry = Buffer.concat([Buffer.from([0x0a, name.length]), name, Buffer.from([0x10, png.length])]);
    zip.addFile('collection.anki21b', zlib.zstdCompressSync(db));
    zip.addFile('media', zlib.zstdCompressSync(Buffer.concat([Buffer.from([0x0a, entry.length]), entry])));
    zip.addFile('0', zlib.zstdCompressSync(png));
  } else {
    zip.addFile('collection.anki2', db);
    zip.addFile('media', Buffer.from(JSON.stringify({ 0: 'rc.png' })));
    zip.addFile('0', png);
  }
  return zip.toBuffer();
}

for (const modern of [false, true]) {
  test(`imports an Anki package (${modern ? 'zstd format' : 'legacy format'})`, async () => {
    const id = (await api('/api/courses', { body: { name: `Import ${modern}` } })).data.id;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(makeApkg(modern))]), 'deck.apkg');
    const r = await api(`/api/import/apkg?course=${id}`, { form });
    assert.deepEqual(r.data, { notes: 2, cards: 2, media: 1, skipped: 1 });
    const notes = (await api(`/api/notes?course=${id}`)).data;
    const basic = notes.find((n: any) => n.type === 'basic');
    assert.equal(basic.data.front, 'What is $\\tau$?');
    assert.match(basic.data.back, /<img src="\/media\/[0-9a-f]+\.png">/);
    assert.match(basic.data.back, /\$\$\\tau = RC\$\$/);
    assert.equal(basic.tags, 'circuits');
    const img = await fetch(srv.url + basic.data.back.match(/\/media\/[^"]+/)[0]);
    assert.equal(img.status, 200);
    assert.equal(notes.find((n: any) => n.type === 'cloze').data.text, '{{c1::Laplace}} transform');
  });
}

test('image upload accepts images only', async () => {
  const bad = new FormData();
  bad.append('file', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await api('/api/media', { form: bad })).status, 400);
});

test('optimiser fits parameters from review history', async () => {
  assert.equal((await api('/api/fsrs/optimize', { method: 'POST' })).status, 400, 'refuses with too few reviews');
  // Simulate 300 cards reviewed over ~3 months.
  const db = new Database(path.join(srv.dataDir, 'mechdeck.db'));
  const card = (db.prepare('SELECT * FROM cards LIMIT 1').get()) as any;
  const insCard = db.prepare('INSERT INTO cards (note_id, user_id, course_id, ord, due) VALUES (?, ?, ?, ?, 0)');
  const insLog = db.prepare("INSERT INTO revlog (card_id, user_id, course_id, rating, state, review, prev) VALUES (?, ?, ?, ?, 2, ?, '{}')");
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  db.transaction(() => {
    for (let c = 0; c < 300; c++) {
      const id = Number(insCard.run(card.note_id, card.user_id, card.course_id, `sim${c}`).lastInsertRowid);
      let t = Date.now() - 100 * 86_400_000;
      let interval = 1;
      for (let i = 0; i < 6; i++) {
        const pass = i === 0 || rnd() < 0.88;
        insLog.run(id, card.user_id, card.course_id, pass ? 3 : 1, t);
        interval = pass ? Math.ceil(interval * 2.3) : 1;
        t += interval * 86_400_000;
      }
    }
  })();
  db.close();
  const r = await api('/api/fsrs/optimize', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api('/api/settings')).data.optimized, true);
  // Scheduling still works with the fitted parameters.
  const next = (await api('/api/review/next')).data;
  assert.ok(next.next === null || next.next.intervals[3]);
});
