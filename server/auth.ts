import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { db } from './db.ts';

const ISSUER = process.env.OIDC_ISSUER || '';
const CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const SECURE = APP_URL.startsWith('https://');
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'md_session';
const LOGIN_COOKIE = 'md_login';

// Local development only. The Docker image runs with NODE_ENV=production, where this is ignored.
export const DEV_BYPASS = process.env.AUTH_DEV_BYPASS === '1' && process.env.NODE_ENV !== 'production';

export interface User { id: number; sub: string; name: string; email: string; settings: string; fsrs_params: string | null }

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

let configPromise: Promise<oidc.Configuration> | null = null;
function oidcConfig(): Promise<oidc.Configuration> {
  if (!ISSUER || !CLIENT_ID) throw new Error('OIDC_ISSUER and OIDC_CLIENT_ID must be set');
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

function upsertUser(sub: string, name: string, email: string): User {
  db.prepare(
    `INSERT INTO users (sub, name, email) VALUES (?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET name = excluded.name, email = excluded.email`,
  ).run(sub, name, email);
  return db.prepare('SELECT * FROM users WHERE sub = ?').get(sub) as User;
}

function sessionUser(req: FastifyRequest): User | null {
  if (DEV_BYPASS) return upsertUser('dev', 'Developer', 'dev@localhost');
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const row = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires > ?')
    .get(sid, Date.now()) as User | undefined;
  return row ?? null;
}

const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: SECURE };

export function registerAuth(app: FastifyInstance) {
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());

  app.get('/auth/health', async () => ({ ok: true }));

  app.get('/auth/login', async (_req, reply) => {
    if (DEV_BYPASS) return reply.redirect('/');
    let config: oidc.Configuration;
    try {
      config = await oidcConfig();
    } catch (err) {
      app.log.error(err, 'OIDC discovery failed');
      return reply.code(503).type('text/plain').send('Login is unavailable: could not reach the identity provider.');
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
      return reply.redirect('/auth/login');
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
      const sid = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (id, user_id, expires) VALUES (?, ?, ?)').run(
        sid, user.id, Date.now() + SESSION_DAYS * 86_400_000,
      );
      reply.setCookie(SESSION_COOKIE, sid, { ...cookieOpts, maxAge: SESSION_DAYS * 86_400 });
      return reply.redirect('/');
    } catch (err) {
      app.log.warn(err, 'OIDC callback failed');
      return reply.code(401).type('text/html').send('<p>Login failed. <a href="/auth/login">Try again</a></p>');
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    let redirect = '/auth/login';
    try {
      const end = (await oidcConfig()).serverMetadata().end_session_endpoint;
      if (end) redirect = end;
    } catch { /* fall back to the login redirect */ }
    return { redirect };
  });
}

/** Guard for /api and /media: 401 without a session. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = sessionUser(req);
  if (!user) return reply.code(401).send({ error: 'unauthenticated' });
  req.user = user;
}

export function isLoggedIn(req: FastifyRequest): boolean {
  return sessionUser(req) !== null;
}
