import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA_DIR } from './db.ts';
import { DEV_BYPASS, isLoggedIn, registerAuth } from './auth.ts';
import { registerRoutes } from './routes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = [path.join(here, 'client'), path.join(here, '../dist/client')].find((p) => fs.existsSync(p));

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: true });

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
});

registerAuth(app);
registerRoutes(app);

await app.register(fastifyStatic, { root: MEDIA_DIR, prefix: '/media/', decorateReply: false, maxAge: '30d', immutable: true });

if (CLIENT_DIR) {
  await app.register(fastifyStatic, { root: CLIENT_DIR, index: false, wildcard: false });
  const index = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');
  // Every other path is the single-page app. Without a session, go straight to Authentik.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/media/') || req.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!isLoggedIn(req)) return reply.redirect('/auth/login');
    return reply.type('text/html').header('Cache-Control', 'no-cache').send(index);
  });
}

if (DEV_BYPASS) app.log.warn('AUTH_DEV_BYPASS is on: everyone is logged in as a local dev user.');

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT) || 8080 });
