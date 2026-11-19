import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type Server } from './helpers.ts';

let srv: Server;
let coded: Server;
before(async () => {
  srv = await startServer(18083, { NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:18083' });
  coded = await startServer(18084, { NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:18084', SIGNUP_CODE: 'letmein' });
});
after(() => { srv.stop(); coded.stop(); });

function client(base: string) {
  const jar = new Map<string, string>();
  const call = async (p: string, opts: { method?: string; body?: unknown; origin?: string } = {}) => {
    const res = await fetch(base + p, {
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
  };
  return { call, jar };
}

const a = () => client(srv.url);
let main: ReturnType<typeof client>;

test('register with username, password and language, then log in', async () => {
  main = a();
  const { call, jar } = main;
  assert.deepEqual((await call('/auth/config')).data, { oidc: false, signup: true, signupCode: false, loggedIn: false });
  assert.equal((await call('/')).headers.get('location'), '/login');
  assert.equal((await call('/auth/register', { body: { username: 'jo', password: 'long enough password' } })).status, 400, 'username too short');
  assert.equal((await call('/auth/register', { body: { username: 'jonas', password: 'short' } })).status, 400);
  assert.equal((await call('/auth/register', { body: { username: 'Jonas', password: 'correct horse battery', language: 'en' } })).status, 200);
  const me = (await call('/api/me')).data;
  assert.equal(me.username, 'jonas');
  assert.equal(me.language, 'en', 'language chosen when creating the account');

  jar.clear();
  assert.equal((await call('/auth/register', { body: { username: 'JONAS', password: 'another long password' } })).status, 409, 'username taken');
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'wrong password!!' } })).status, 401);
  assert.equal((await call('/auth/password', { body: { username: 'JONAS', password: 'correct horse battery' } })).status, 200);
  assert.equal((await call('/api/me')).data.loginMethod, 'password');
});

test('accounts are separate', async () => {
  const other = a();
  assert.equal((await other.call('/auth/register', { body: { username: 'mia', password: 'correct horse battery' } })).status, 200);
  assert.equal((await other.call('/api/me')).data.language, 'de', 'German is the default');
  await main.call('/api/courses', { body: { name: 'Mine' } });
  assert.deepEqual((await other.call('/api/courses')).data, []);
});

test('requests from another site are blocked', async () => {
  assert.equal((await main.call('/api/courses', { body: { name: 'x' }, origin: 'https://evil.maidev.dk' })).status, 403);
  assert.equal((await main.call('/api/courses', { body: { name: 'ok' }, origin: 'http://127.0.0.1:18083' })).status, 200);
});

test('changing the password needs the current one and ends other sessions', async () => {
  const { call, jar } = main;
  assert.equal((await call('/api/account/password', { method: 'PUT', body: { username: 'jonas', password: 'another long password', currentPassword: 'nope' } })).status, 403);
  assert.equal((await call('/api/account/password', { method: 'PUT', body: { username: 'jonas', password: 'another long password', currentPassword: 'correct horse battery' } })).status, 200);
  jar.clear();
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'correct horse battery' } })).status, 401);
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'another long password' } })).status, 200);
});

test('at most 5 new accounts per address and hour', async () => {
  // 'jonas' and 'mia' already count; three more are allowed, then it stops.
  const results = [];
  for (const u of ['ann', 'ben', 'cleo', 'dora']) results.push((await a().call('/auth/register', { body: { username: u, password: 'correct horse battery' } })).status);
  assert.deepEqual(results, [200, 200, 200, 429]);
});

test('invitation code', async () => {
  const c = client(coded.url);
  assert.equal((await c.call('/auth/config')).data.signupCode, true);
  assert.equal((await c.call('/auth/register', { body: { username: 'eve', password: 'correct horse battery', code: 'guess' } })).status, 403);
  assert.equal((await c.call('/auth/register', { body: { username: 'eve', password: 'correct horse battery', code: 'letmein' } })).status, 200);
});

test('security headers and login rate limiting', async () => {
  const r = await fetch(srv.url + '/auth/config');
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-src https:\/\/feedback\.maidev\.dk;/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const { call } = a();
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call('/auth/password', { body: { username: 'jonas', password: `guess ${i}` } })).status;
  assert.equal(last, 429);
  assert.equal((await call('/auth/password', { body: { username: 'jonas', password: 'another long password' } })).status, 429, 'blocked even with the right password');
});
