import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type Server } from './helpers.ts';

let srv: Server;
before(async () => { srv = await startServer(18083, { NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:18083' }); });
after(() => srv.stop());

const jar = new Map<string, string>();
async function call(p: string, opts: { method?: string; body?: unknown; origin?: string } = {}) {
  const res = await fetch(srv.url + p, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: {
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (v) jar.set(k, v); else jar.delete(k);
  }
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
}

test('without Authentik: first-run setup, then password login only', async () => {
  assert.deepEqual((await call('/auth/config')).data, { oidc: false, setup: true, loggedIn: false });
  assert.equal((await call('/')).headers.get('location'), '/login');
  assert.equal((await call('/auth/setup', { body: { username: 'jo', password: 'long enough password' } })).status, 400, 'username too short');
  assert.equal((await call('/auth/setup', { body: { username: 'jonas', password: 'short' } })).status, 400);
  assert.equal((await call('/auth/setup', { body: { username: 'Jonas', password: 'correct horse battery' } })).status, 200);
  assert.equal((await call('/api/me')).data.username, 'jonas');
  assert.equal((await call('/auth/config')).data.setup, false);

  // Setup is closed once an account exists.
  jar.clear();
  assert.equal((await call('/auth/setup', { body: { username: 'mallory', password: 'correct horse battery' } })).status, 403);
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'wrong password!!' } })).status, 401);
  assert.equal((await call('/auth/password', { body: { username: 'JONAS', password: 'correct horse battery' } })).status, 200);
  assert.equal((await call('/api/me')).status, 200);
  assert.equal((await call('/api/me')).data.loginMethod, 'password');
});

test('requests from another site are blocked', async () => {
  const r = await call('/api/courses', { body: { name: 'x' }, origin: 'https://evil.maidev.dk' });
  assert.equal(r.status, 403);
  assert.equal((await call('/api/courses', { body: { name: 'ok' }, origin: 'http://127.0.0.1:18083' })).status, 200);
});

test('changing the password needs the current one and ends other sessions', async () => {
  assert.equal((await call('/api/account/password', { method: 'PUT', body: { username: 'jonas', password: 'another long password', currentPassword: 'nope' } })).status, 403);
  assert.equal((await call('/api/account/password', { method: 'PUT', body: { username: 'jonas', password: 'another long password', currentPassword: 'correct horse battery' } })).status, 200);
  jar.clear();
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'correct horse battery' } })).status, 401);
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'another long password' } })).status, 200);
});

test('security headers and rate limiting', async () => {
  const r = await fetch(srv.url + '/auth/config');
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  jar.clear();
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call('/auth/password', { body: { username: 'jonas', password: `guess ${i}` } })).status;
  assert.equal(last, 429);
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'another long password' } })).status, 429, 'blocked even with the right password');
});
