import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer, type Server } from './helpers.ts';

/** A minimal OpenID Connect provider shaped like an Authentik application. */
const IDP_PORT = 18090;
const ISSUER = `http://127.0.0.1:${IDP_PORT}/application/o/card/`;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');
const codes = new Map<string, { nonce: string; challenge: string }>();
let pkceOk = false;

const idp = http.createServer(async (req, res) => {
  const url = new URL(req.url!, ISSUER);
  const json = (o: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname.endsWith('/.well-known/openid-configuration')) {
    return json({
      issuer: ISSUER, authorization_endpoint: `${ISSUER}authorize`, token_endpoint: `${ISSUER}token`,
      jwks_uri: `${ISSUER}jwks`, end_session_endpoint: `${ISSUER}end-session/`,
      response_types_supported: ['code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
    });
  }
  if (url.pathname.endsWith('/jwks')) return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
  if (url.pathname.endsWith('/authorize')) {
    const code = crypto.randomUUID();
    codes.set(code, { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')! });
    res.statusCode = 302;
    res.setHeader('Location', `${url.searchParams.get('redirect_uri')}?code=${code}&state=${url.searchParams.get('state')}`);
    return res.end();
  }
  if (url.pathname.endsWith('/token')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const p = new URLSearchParams(body);
    const c = codes.get(p.get('code')!);
    if (!c) { res.statusCode = 400; return json({ error: 'invalid_grant' }); }
    pkceOk = b64(crypto.createHash('sha256').update(p.get('code_verifier')!).digest()) === c.challenge;
    const now = Math.floor(Date.now() / 1000);
    const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const payload = b64(JSON.stringify({
      iss: ISSUER, sub: 'abc123', aud: 'card', exp: now + 300, iat: now, nonce: c.nonce,
      name: 'Test Engineer', email: 'test@example.com',
    }));
    const sig = b64(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), privateKey));
    return json({ access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: `${head}.${payload}.${sig}` });
  }
  res.statusCode = 404; res.end();
});

let srv: Server;
before(async () => {
  await new Promise<void>((r) => idp.listen(IDP_PORT, r));
  srv = await startServer(18082, {
    NODE_ENV: 'production', AUTH_DEV_BYPASS: '1', // the bypass must be ignored in production
    OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'card', OIDC_CLIENT_SECRET: 's3cret', APP_URL: 'http://127.0.0.1:18082',
  });
});
after(() => { srv.stop(); idp.close(); });

const jar = new Map<string, string>();
async function get(url: string, method = 'GET') {
  const res = await fetch(url, { method, redirect: 'manual', headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (v) jar.set(k, v); else jar.delete(k);
  }
  return res;
}

test('API and media need a session, even with the dev bypass variable set', async () => {
  assert.equal((await get(`${srv.url}/api/me`)).status, 401);
  assert.equal((await get(`${srv.url}/api/courses`)).status, 401);
  assert.equal((await get(`${srv.url}/media/anything.png`)).status, 401);
});

test('full login through the identity provider, then logout', async () => {
  const login = await get(`${srv.url}/auth/login`);
  assert.equal(login.status, 302);
  const authUrl = new URL(login.headers.get('location')!);
  assert.equal(authUrl.origin + authUrl.pathname, `${ISSUER}authorize`);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:18082/auth/callback');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');

  const back = await get(authUrl.href);
  const callback = await get(back.headers.get('location')!);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/');
  assert.ok(pkceOk, 'PKCE verifier matched the challenge');

  const me = await get(`${srv.url}/api/me`);
  assert.equal(me.status, 200);
  const meData = await me.json();
  assert.equal(meData.name, 'Test Engineer');
  assert.equal(meData.email, 'test@example.com');
  assert.equal(meData.loginMethod, 'oidc');

  const out = await get(`${srv.url}/auth/logout`, 'POST');
  assert.deepEqual(await out.json(), { redirect: `${ISSUER}end-session/` });
  assert.equal((await get(`${srv.url}/api/me`)).status, 401);
});

test('a callback with a forged state is rejected', async () => {
  const login = await get(`${srv.url}/auth/login`);
  const authUrl = new URL(login.headers.get('location')!);
  const back = await get(authUrl.href);
  const forged = new URL(back.headers.get('location')!);
  forged.searchParams.set('state', 'forged');
  const res = await get(forged.href);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login?error=oidc-failed');
  assert.equal((await get(`${srv.url}/api/me`)).status, 401);
});
