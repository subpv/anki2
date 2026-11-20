import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, MEDIA_DIR } from './db.ts';
import { createNote } from './notes.ts';

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

/** Minimal protobuf reader for Anki's MediaEntries message (repeated entry { 1: name }). */
function parseMediaEntries(buf: Buffer): string[] {
  const names: string[] = [];
  let pos = 0;
  const varint = () => {
    let v = 0, shift = 0, b: number;
    do { b = buf[pos++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return v;
  };
  const skip = (wire: number) => {
    if (wire === 0) varint();
    else if (wire === 2) pos += varint();
    else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else throw new Error('Unsupported media index');
  };
  while (pos < buf.length) {
    const tag = varint();
    if (tag >> 3 === 1 && (tag & 7) === 2) {
      const end = pos + varint();
      let name = '';
      while (pos < end) {
        const t = varint();
        if (t >> 3 === 1 && (t & 7) === 2) {
          const len = varint();
          name = buf.subarray(pos, pos + len).toString('utf8');
          pos += len;
        } else skip(t & 7);
      }
      names.push(name);
    } else skip(tag & 7);
  }
  return names;
}

/** Refuse packages that unpack to absurd sizes (zip bombs). */
const MAX_UNPACKED = 512 * 1024 * 1024;
const isZstd = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0xfd2fb528;
const unzstd = (b: Buffer) => (isZstd(b) ? zlib.zstdDecompressSync(b, { maxOutputLength: MAX_UNPACKED }) : b);

/** Anki field HTML -> our Markdown-with-HTML: MathJax delimiters, media paths, [sound:] tags. */
function convertField(html: string, media: Map<string, string>): string {
  return html
    .replace(/\\\((.+?)\\\)/gs, (_m, tex) => `$${tex.trim()}$`)
    .replace(/\\\[(.+?)\\\]/gs, (_m, tex) => `\n\n$$${tex.trim()}$$\n\n`)
    .replace(/\[latex\](.+?)\[\/latex\]/gs, '$1')
    .replace(/\[\$\](.+?)\[\/\$\]/gs, (_m, tex) => `$${tex.trim()}$`)
    .replace(/\[\$\$\](.+?)\[\/\$\$\]/gs, (_m, tex) => `\n\n$$${tex.trim()}$$\n\n`)
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/(<img[^>]*\ssrc=)(["']?)([^"'>\s]+)\2/gi, (m, pre, q, src) => {
      let name = src;
      try { name = decodeURIComponent(src); } catch { /* keep raw */ }
      const url = media.get(name);
      return url ? `${pre}"${url}"` : m;
    })
    .trim();
}

export interface ImportResult { notes: number; cards: number; media: number; skipped: number }

export function importApkg(file: Buffer, userId: number, courseId: number): ImportResult {
  const zip = new AdmZip(file);
  for (const e of zip.getEntries()) {
    if (e.header.size > MAX_UNPACKED) throw new Error('The package is too large.');
  }
  // Count what is actually unpacked, not only what the entries claim.
  let unpacked = 0;
  const entry = (name: string) => {
    const data = zip.getEntry(name)?.getData();
    unpacked += data?.length ?? 0;
    if (unpacked > MAX_UNPACKED * 2) throw new Error('The package is too large.');
    return data;
  };
  const collection = entry('collection.anki21b') ?? entry('collection.anki21') ?? entry('collection.anki2');
  if (!collection) throw new Error('This file does not look like an Anki deck package (.apkg).');

  // Media: copy referenced images into our media folder and remember the new URLs.
  const media = new Map<string, string>();
  const mediaIndex = entry('media');
  if (mediaIndex) {
    let names: [string, string][] = []; // [zip entry name, original filename]
    const raw = unzstd(mediaIndex);
    if (raw[0] === 0x7b /* { */) {
      names = Object.entries(JSON.parse(raw.toString('utf8')) as Record<string, string>);
    } else {
      names = parseMediaEntries(raw).map((n, i) => [String(i), n]);
    }
    for (const [zipName, original] of names) {
      const ext = original.match(MEDIA_EXT)?.[0].toLowerCase();
      const data = ext && entry(zipName);
      if (!ext || !data) continue;
      const stored = crypto.randomBytes(12).toString('hex') + ext;
      fs.writeFileSync(path.join(MEDIA_DIR, stored), unzstd(data));
      media.set(original, `/media/${stored}`);
    }
  }

  const tmp = path.join(os.tmpdir(), `apkg-${crypto.randomBytes(8).toString('hex')}.db`);
  fs.writeFileSync(tmp, unzstd(collection));
  const result: ImportResult = { notes: 0, cards: 0, media: media.size, skipped: 0 };
  try {
    const src = new Database(tmp, { readonly: true });
    const rows = src.prepare('SELECT flds, tags FROM notes').all() as { flds: string; tags: string }[];
    src.close();
    db.transaction(() => {
      for (const row of rows) {
        const fields = row.flds.split('\x1f').map((f) => convertField(f, media));
        const first = fields[0] ?? '';
        const rest = fields.slice(1).filter(Boolean).join('\n\n');
        if (!first) { result.skipped++; continue; }
        const isCloze = /\{\{c\d+::/.test(first);
        const id = createNote(userId, {
          courseId,
          type: isCloze ? 'cloze' : 'basic',
          data: isCloze ? { text: first, extra: rest } : { front: first, back: rest },
          tags: row.tags,
        });
        result.notes++;
        result.cards += (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE note_id = ?').get(id) as { n: number }).n;
      }
    })();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return result;
}
