import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { client, startServer, type Server } from './helpers.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let normal: Server;
let lenient: Server;
const pics = http.createServer((req, res) => {
  if (req.url === '/dog.png') { res.setHeader('Content-Type', 'image/png'); return res.end(PNG); }
  if (req.url === '/page.html') { res.setHeader('Content-Type', 'text/html'); return res.end('<p>hi</p>'); }
  if (req.url === '/hop') { res.statusCode = 302; res.setHeader('Location', '/dog.png'); return res.end(); }
  res.statusCode = 404; res.end();
});
before(async () => {
  await new Promise<void>((r) => pics.listen(18095, r));
  normal = await startServer(18086, { AUTH_DEV_BYPASS: '1' });
  // Only for this test: allow downloads from 127.0.0.1, where the stub picture server runs.
  lenient = await startServer(18087, { AUTH_DEV_BYPASS: '1', IMPORT_ALLOW_PRIVATE: '1' });
});
after(() => { normal.stop(); lenient.stop(); pics.close(); });

const occlusion = (image: string) => JSON.stringify({ course: 'Pics', notes: [
  { type: 'occlusion', image, title: 'Gearbox', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1, label: 'Shaft' }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: 'Gear' }] },
  { type: 'basic', front: `What is this? ![](${image})`, back: 'A dog' },
  { type: 'vocab', word: 'en hund', meaning: 'der Hund', picture: image },
] });

test('pictures uploaded with the import are found by file name', async () => {
  const api = client(normal.url);
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'Folie 3.png');
  const { url } = (await api('/api/media', { form })).data;
  const r = await api('/api/import/text', { body: { text: occlusion('Folie 3.png'), files: { 'Folie 3.png': url } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.cards, 2 + 1 + 2, 'two boxes, one basic, two vocab directions');
  const notes = (await api(`/api/notes?course=${r.data.courseId}`)).data;
  assert.equal(notes.find((n: any) => n.type === 'occlusion').data.image, url);
  assert.equal(notes.find((n: any) => n.type === 'basic').data.front, `What is this? ![](${url})`);
  assert.equal(notes.find((n: any) => n.type === 'vocab').data.picture, url);
});

test('a missing picture and an emoji picture', async () => {
  const api = client(normal.url);
  const r = await api('/api/import/text', { body: { text: occlusion('missing.png') } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data.problems.map((p: any) => [p.index, p.code, p.field]), [[1, 'image-missing', 'missing.png'], [2, 'image-missing', 'missing.png'], [3, 'image-missing', 'missing.png']]);
  const emoji = await api('/api/import/text', { body: { text: '[{"type":"vocab","word":"en kat","meaning":"die Katze","picture":"🐈"}]', newCourse: 'Emoji' } });
  assert.equal(emoji.status, 200);
});

test('downloads never reach the local network', async () => {
  const api = client(normal.url);
  for (const link of ['http://127.0.0.1:18095/dog.png', 'http://localhost:18095/dog.png', 'http://[::1]:18095/dog.png', 'http://192.168.87.153/x.png', 'http://169.254.169.254/latest.png', 'file:///etc/passwd.png']) {
    const r = await api('/api/import/text', { body: { text: JSON.stringify([{ type: 'basic', front: `![](${link})`, back: 'x' }]), newCourse: 'Net' } });
    assert.equal(r.status, 400, link);
    assert.ok(['image-download', 'image-missing'].includes(r.data.problems[0].code), `${link}: ${JSON.stringify(r.data.problems)}`);
  }
});

test('web pictures are downloaded and stored locally; non-images are refused', async () => {
  const api = client(lenient.url);
  const ok = await api('/api/import/text', { body: { text: occlusion('http://127.0.0.1:18095/hop'), newCourse: 'Web' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.downloaded, 1, 'the same link is downloaded once');
  const notes = (await api(`/api/notes?course=${ok.data.courseId}`)).data;
  const local = notes.find((n: any) => n.type === 'occlusion').data.image;
  assert.match(local, /^\/media\/[0-9a-f]+\.png$/);
  assert.equal((await fetch(lenient.url + local)).status, 200);
  const html = await api('/api/import/text', { body: { text: occlusion('http://127.0.0.1:18095/page.html'), newCourse: 'Web' } });
  assert.equal(html.status, 400);
  assert.match(html.data.problems[0].field, /not an image/);
});
