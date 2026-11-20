import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { db } from './db.ts';

const ISSUER = process.env.OIDC_ISSUER || '';
const CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
export const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
const SECURE = APP_URL.startsWith('https://');
const OIDC_ENABLED = !!(ISSUER && CLIENT_ID);
/** Self-registration: on unless SIGNUP=off. With SIGNUP_CODE set, the code is needed to register. */
const SIGNUP_OPEN = (process.env.SIGNUP || 'open').toLowerCase() !== 'off';
const SIGNUP_CODE = (process.env.SIGNUP_CODE || '').trim();
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'md_session';
const LOGIN_COOKIE = 'md_login';

// Local development only. The Docker image runs with NODE_ENV=production, where this is ignored.
export const DEV_BYPASS = process.env.AUTH_DEV_BYPASS === '1' && process.env.NODE_ENV !== 'production';

export interface User {
  id: number; sub: string; name: string; email: string; settings: string; fsrs_params: string | null;
  username: string | null; password_hash: string | null;
}

declare module 'fastify' {
  interface FastifyRequest { user: User; sessionMethod: 'oidc' | 'password' | 'dev' }
}

// ---- Passwords ----------------------------------------------------------------------------
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const MIN_PASSWORD = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export const checkPassword = (password: string, stored: string) => verifyPassword(password, stored);

async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Without a stored hash, still do the work so a missing user takes as long as a wrong password.
  const [alg, salt, ref] = (stored ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 64);
  if (!stored || alg !== 'scrypt') return false;
  const expected = Buffer.from(ref, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export const USERNAME_RE = /^[a-zA-Z0-9._@-]{3,64}$/;

/**
 * Failed logins within 15 minutes: at most 10 per address, and 30 per username (higher, so a
 * stranger cannot easily lock someone out, but a distributed guesser is still slowed down).
 */
const failures = new Map<string, { count: number; until: number }>();
const WINDOW = 15 * 60_000;
const limitFor = (key: string) => (key.startsWith('user:') ? 30 : 10);
function blocked(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => { const f = failures.get(k); return !!f && f.until > now && f.count >= limitFor(k); });
}
function recordFailure(keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k);
    failures.set(k, f && f.until > now ? { count: f.count + 1, until: f.until } : { count: 1, until: now + WINDOW });
  }
  if (failures.size > 10_000) for (const [k, f] of failures) if (f.until <= now) failures.delete(k);
}

/** At most 5 new accounts per address and hour. */
const signups = new Map<string, number[]>();
function signupBlocked(key: string): boolean {
  const recent = (signups.get(key) ?? []).filter((t) => t > Date.now() - 3_600_000);
  signups.set(key, recent);
  return recent.length >= 5;
}
function recordSignup(key: string) {
  signups.set(key, [...(signups.get(key) ?? []), Date.now()]);
  if (signups.size > 10_000) signups.clear();
}

// ---- Sessions -----------------------------------------------------------------------------
const hashSid = (sid: string) => crypto.createHash('sha256').update(sid).digest('hex');
const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: SECURE };

function startSession(reply: FastifyReply, userId: number, method: 'oidc' | 'password') {
  const sid = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires, method) VALUES (?, ?, ?, ?)').run(
    hashSid(sid), userId, Date.now() + SESSION_DAYS * 86_400_000, method,
  );
  reply.setCookie(SESSION_COOKIE, sid, { ...cookieOpts, maxAge: SESSION_DAYS * 86_400 });
}

function upsertUser(sub: string, name: string, email: string): User {
  db.prepare(
    `INSERT INTO users (sub, name, email) VALUES (?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET name = excluded.name, email = excluded.email`,
  ).run(sub, name, email);
  return db.prepare('SELECT * FROM users WHERE sub = ?').get(sub) as User;
}

function sessionOf(req: FastifyRequest): { user: User; method: 'oidc' | 'password' | 'dev' } | null {
  if (DEV_BYPASS) return { user: upsertUser('dev', 'Developer', 'dev@localhost'), method: 'dev' };
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = db
    .prepare('SELECT u.*, s.method AS session_method FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires > ?')
    .get(hashSid(sid), Date.now()) as (User & { session_method: 'oidc' | 'password' }) | undefined;
  if (!row) return null;
  const { session_method, ...user } = row;
  return { user, method: session_method };
}

let configPromise: Promise<oidc.Configuration> | null = null;
function oidcConfig(): Promise<oidc.Configuration> {
  if (!OIDC_ENABLED) return Promise.reject(new Error('OIDC is not configured'));
  if (!configPromise) {
    const insecure = ISSUER.startsWith('http://');
    configPromise = oidc
      .discovery(new URL(ISSUER), CLIENT_ID, CLIENT_SECRET || undefined, undefined, {
        execute: insecure ? [oidc.allowInsecureRequests] : [],
      })
      .catch((err) => {
        configPromise = null; // retry on the next login, e.g. if Authentik was still starting
        throw err;
      });
  }
  return configPromise;
}

const hasUsers = () => !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

export function registerAuth(app: FastifyInstance) {
  const purge = () => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  purge();
  setInterval(purge, 6 * 3_600_000).unref(); // expired sessions are removed every 6 hours

  // Requests that change something must come from this app's own pages (defence against
  // cross-site request forgery, also from other sites on the same parent domain).
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || DEV_BYPASS) return;
    const origin = req.headers.origin;
    if (origin && origin !== APP_ORIGIN) return reply.code(403).send({ error: 'Request from another site was blocked' });
  });

  app.get('/auth/health', async () => ({ ok: true }));

  /** What the login page should offer. */
  app.get('/auth/config', async (req) => ({
    oidc: OIDC_ENABLED,
    // Without Authentik and without any account, registering is always possible (first account).
    signup: SIGNUP_OPEN || (!OIDC_ENABLED && !hasUsers()),
    signupCode: !!SIGNUP_CODE,
    loggedIn: !!sessionOf(req),
  }));

  app.post('/auth/password', async (req, reply) => {
    const { username = '', password = '' } = (req.body ?? {}) as { username?: string; password?: string };
    const name = String(username).trim().toLowerCase();
    const keys = [`ip:${req.ip}`, `user:${name}`];
    if (blocked(keys)) return reply.code(429).send({ error: 'Too many attempts. Try again in a few minutes.' });
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) as User | undefined;
    const ok = await verifyPassword(String(password), user?.password_hash ?? null);
    if (!user || !ok) {
      recordFailure(keys);
      return reply.code(401).send({ error: 'Wrong username or password' });
    }
    startSession(reply, user.id, 'password');
    return { ok: true };
  });

  /** Create an account with username and password. */
  app.post('/auth/register', async (req, reply) => {
    if (!(SIGNUP_OPEN || (!OIDC_ENABLED && !hasUsers()))) return reply.code(403).send({ error: 'Registration is turned off' });
    const keys = [`signup:${req.ip}`];
    if (signupBlocked(keys[0])) return reply.code(429).send({ error: 'Too many new accounts from this address. Try again later.' });
    const { username = '', password = '', language = 'de', code = '' } = (req.body ?? {}) as Record<string, string>;
    if (SIGNUP_CODE) {
      const a = Buffer.from(String(code)), b = Buffer.from(SIGNUP_CODE);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        recordFailure([`ip:${req.ip}`]);
        return reply.code(403).send({ error: 'Wrong invitation code' });
      }
    }
    const name = String(username).trim().toLowerCase();
    if (!USERNAME_RE.test(name)) return reply.code(400).send({ error: 'Username: 3–64 letters, digits or . _ @ -' });
    if (String(password).length < MIN_PASSWORD) return reply.code(400).send({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    const lang = language === 'en' ? 'en' : 'de';
    const hash = await hashPassword(String(password));
    const id = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) return null;
      // A random subject, so a username freed by renaming can be registered again.
      return Number(db.prepare('INSERT INTO users (sub, name, email, username, password_hash, settings) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`local:${crypto.randomUUID()}`, String(username).trim(), '', name, hash, JSON.stringify({ language: lang })).lastInsertRowid);
    }).immediate();
    if (id === null) return reply.code(409).send({ error: 'This username is taken' });
    recordSignup(keys[0]);
    startSession(reply, id, 'password');
    return { ok: true };
  });

  app.get('/auth/login', async (_req, reply) => {
    if (DEV_BYPASS) return reply.redirect('/');
    if (!OIDC_ENABLED) return reply.redirect('/login');
    let config: oidc.Configuration;
    try {
      config = await oidcConfig();
    } catch (err) {
      app.log.error(err, 'OIDC discovery failed');
      return reply.redirect('/login?error=oidc-unavailable');
    }
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${APP_URL}/auth/callback`,
      scope: 'openid profile email',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    reply.setCookie(LOGIN_COOKIE, JSON.stringify({ verifier, state, nonce }), { ...cookieOpts, maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/auth/callback', async (req, reply) => {
    let pending: { verifier: string; state: string; nonce: string };
    try {
      pending = JSON.parse(req.cookies[LOGIN_COOKIE] || '');
    } catch {
      return reply.redirect('/login');
    }
    reply.clearCookie(LOGIN_COOKIE, cookieOpts);
    try {
      const config = await oidcConfig();
      const tokens = await oidc.authorizationCodeGrant(config, new URL(APP_URL + req.url), {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('ID token has no subject');
      const name = String(claims.name || claims.preferred_username || claims.email || 'User');
      const user = upsertUser(claims.sub, name, String(claims.email || ''));
      startSession(reply, user.id, 'oidc');
      return reply.redirect('/');
    } catch (err) {
      app.log.warn(err, 'OIDC callback failed');
      return reply.redirect('/login?error=oidc-failed');
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    const method = sessionOf(req)?.method;
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(hashSid(sid));
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    let redirect = '/login';
    if (method === 'oidc') {
      try {
        const end = (await oidcConfig()).serverMetadata().end_session_endpoint;
        if (end) redirect = end;
      } catch { /* fall back to the login page */ }
    }
    return { redirect };
  });
}

/** Guard for /api and /media: 401 without a session. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const s = sessionOf(req);
  if (!s) return reply.code(401).send({ error: 'unauthenticated' });
  req.user = s.user;
  req.sessionMethod = s.method;
}

export function isLoggedIn(req: FastifyRequest): boolean {
  return sessionOf(req) !== null;
}

/** Drop all of a user's sessions except the current one (after a password change). */
export function endOtherSessions(req: FastifyRequest) {
  const sid = req.cookies[SESSION_COOKIE];
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ? AND method = 'password'").run(req.user.id, sid ? hashSid(sid) : '');
}
