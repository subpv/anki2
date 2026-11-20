import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { MEDIA_DIR } from './db.ts';
import type { ImportProblem } from './textImport.ts';
import type { NoteInput } from './notes.ts';

/**
 * Pictures in imported cards. A note can refer to an image
 *  - by file name, for images uploaded together with the import ("folie3.png"),
 *  - by web link ("https://upload.wikimedia.org/…"), which is downloaded and stored locally,
 *  - by a /media/… path that already exists.
 * Web downloads only go to public internet addresses (never the local network), follow at most
 * three redirects, accept only PNG/JPEG/GIF/WebP/AVIF up to 10 MB and time out after 15 s.
 */

const TYPES: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif',
};
const MAX_BYTES = 10 * 1024 * 1024;
/** Per import: at most this many different web pictures and this many bytes in total. */
export const MAX_DOWNLOADS = 50;
const MAX_TOTAL = 200 * 1024 * 1024;
const PARALLEL = 4;
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif)$/i;
const MEDIA_PATH = /^\/media\/[0-9a-f]{8,64}\.(png|jpg|gif|webp|avif)$/;

// Addresses a download must never reach: loopback, private networks, link-local, CGNAT, multicast…
const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 96], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) {
  blocked.addSubnet(a, p, 'ipv6');
}
function isBlocked(address: string, family: number): boolean {
  if (process.env.IMPORT_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production') return false; // tests only
  const mapped = family === 6 && /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** DNS lookup that refuses non-public addresses; used for the actual connection, so rebinding cannot sneak past it. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: (options as dns.LookupOptions).family }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlocked(a.address, a.family))) {
      return (callback as any)(Object.assign(new Error('address not allowed'), { code: 'EBLOCKED' }));
    }
    if ((options as dns.LookupAllOptions).all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

function download(url: string, redirects = 3): Promise<Buffer & { type?: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { return reject(new Error('bad link')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad link'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isBlocked(u.hostname.replace(/^\[|\]$/g, ''), net.isIP(u.hostname.replace(/^\[|\]$/g, '')))) {
      return reject(new Error('address not allowed'));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: 15_000, headers: { 'User-Agent': 'Card-flashcards/1.0 (image import)', Accept: 'image/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('too many redirects'));
        return download(new URL(res.headers.location, u).href, redirects - 1).then(resolve, reject);
      }
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (status !== 200) { res.resume(); return reject(new Error(`HTTP ${status}`)); }
      if (!TYPES[type]) { res.resume(); return reject(new Error('not an image')); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error('image larger than 10 MB')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Object.assign(Buffer.concat(chunks), { type })));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Store downloaded bytes like an upload and return the /media URL. */
function store(bytes: Buffer, type: string): string {
  const name = crypto.randomBytes(12).toString('hex') + TYPES[type];
  fs.writeFileSync(path.join(MEDIA_DIR, name), bytes);
  return `/media/${name}`;
}

/** Fields that may hold a picture directly (not Markdown). */
const DIRECT: Record<string, string[]> = { occlusion: ['image'], vocab: ['picture'] };
// ![alt](ref) – the ref may contain spaces (file names like "Folie 3.png") and an optional "title".
const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^()<>"]+?)>?(?:\s+"[^"]*")?\s*\)/g;

/** Collect every picture reference of a note: direct fields and ![](…) in its texts. */
function refsOf(note: Omit<NoteInput, 'courseId'>): string[] {
  const d = note.data as Record<string, unknown>;
  const out: string[] = [];
  for (const field of DIRECT[note.type] ?? []) {
    const v = String(d[field] ?? '').trim();
    if (v && !(note.type === 'vocab' && !/^https?:\/\//i.test(v) && !IMAGE_NAME.test(v) && !MEDIA_PATH.test(v))) out.push(v);
  }
  const texts = Object.entries(d).filter(([k]) => k !== 'code').flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
  for (const t of texts) if (typeof t === 'string') for (const m of t.matchAll(MD_IMAGE)) out.push(m[2].trim());
  return out;
}

/**
 * Replace every picture reference in the notes by a local /media URL. Problems (unknown file
 * name, failed download, too many pictures) are added per note; the caller imports nothing if
 * there are any, and then calls the returned cleanup() to delete pictures downloaded on the way.
 */
export async function resolveImages(notes: Omit<NoteInput, 'courseId'>[], files: Record<string, string>, problems: ImportProblem[]):
  Promise<{ downloaded: number; cleanup: () => void }> {
  const byName = new Map<string, string>();
  for (const [name, url] of Object.entries(files ?? {})) {
    if (typeof url === 'string' && MEDIA_PATH.test(url)) byName.set(path.basename(name).toLowerCase(), url);
  }
  const stored: string[] = [];
  const cleanup = () => { for (const u of stored) fs.rmSync(path.join(MEDIA_DIR, path.basename(u)), { force: true }); };

  // Download all web pictures first, a few at a time, within the limits.
  const links = [...new Set(notes.flatMap(refsOf).filter((r) => /^https?:\/\//i.test(r)))];
  if (links.length > MAX_DOWNLOADS) {
    problems.push({ index: -1, type: '', code: 'too-many-images', field: String(MAX_DOWNLOADS) });
    return { downloaded: 0, cleanup };
  }
  const downloaded = new Map<string, string | Error>();
  let total = 0;
  const queue = [...links];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let link = queue.shift(); link; link = queue.shift()) {
      try {
        const bytes = await download(link);
        total += bytes.length;
        if (total > MAX_TOTAL) throw new Error('pictures larger than 200 MB in total');
        const url = store(bytes, bytes.type!);
        stored.push(url);
        downloaded.set(link, url);
      } catch (err) {
        downloaded.set(link, err as Error);
      }
    }
  }));

  const resolveRef = (ref: string, index: number, type: string): string | null => {
    const r = ref.trim();
    if (MEDIA_PATH.test(r)) return r;
    if (/^https?:\/\//i.test(r)) {
      const got = downloaded.get(r);
      if (typeof got === 'string') return got;
      problems.push({ index, type, code: 'image-download', field: `${r} (${got?.message ?? 'not downloaded'})` });
      return null;
    }
    const local = byName.get(path.basename(r).toLowerCase());
    if (local) return local;
    problems.push({ index, type, code: 'image-missing', field: r });
    return null;
  };
  // A replacer function, so "$&" or "$1" in alt text is not treated as a replacement pattern.
  const replaceMarkdown = (text: string, index: number, type: string): string =>
    text.replace(MD_IMAGE, (whole, alt: string, ref: string) => {
      const url = resolveRef(ref, index, type);
      return url ? `![${alt}](${url})` : whole;
    });

  for (const [i, note] of notes.entries()) {
    const index = i + 1;
    const d = note.data as Record<string, unknown>;
    for (const field of DIRECT[note.type] ?? []) {
      const v = String(d[field] ?? '').trim();
      // A vocab picture can also be an emoji: only treat links and file names as images.
      if (!v || (note.type === 'vocab' && !/^https?:\/\//i.test(v) && !IMAGE_NAME.test(v) && !MEDIA_PATH.test(v))) continue;
      const url = resolveRef(v, index, note.type);
      if (url) d[field] = url;
    }
    for (const [key, value] of Object.entries(d)) {
      if (key === 'code') continue;
      if (typeof value === 'string' && value.includes('![')) d[key] = replaceMarkdown(value, index, note.type);
      if (Array.isArray(value)) d[key] = value.map((v) => (typeof v === 'string' && v.includes('![') ? replaceMarkdown(v, index, note.type) : v));
    }
  }
  return { downloaded: stored.length, cleanup };
}
