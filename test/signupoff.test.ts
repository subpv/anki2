import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type Server } from './helpers.ts';

let srv: Server;
before(async () => { srv = await startServer(18085, { NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:18085', SIGNUP: 'off' }); });
after(() => srv.stop());

const post = (p: string, body: unknown) => fetch(srv.url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('SIGNUP=off still allows the very first account without Authentik, then closes', async () => {
  assert.equal((await (await fetch(srv.url + '/auth/config')).json()).signup, true);
  assert.equal((await post('/auth/register', { username: 'owner', password: 'correct horse battery' })).status, 200);
  assert.equal((await (await fetch(srv.url + '/auth/config')).json()).signup, false);
  assert.equal((await post('/auth/register', { username: 'stranger', password: 'correct horse battery' })).status, 403);
});
