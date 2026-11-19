import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.ts';
import { createNote } from './notes.ts';
import type { VocabData } from '../shared/types.ts';

/**
 * Word lists are plain text, one word per line:
 *
 *   # title: Danish → German
 *   # course: Danish
 *   word | meaning | picture | note
 *
 * Columns are separated by a tab, "|" or ";". Picture and note are optional; the picture is
 * an emoji or an image URL. Other lines starting with "#" are comments.
 */
export interface WordList {
  title: string; description: string; course: string; entries: VocabData[]; skipped: number;
  /** German title/description from "# title_de:" / "# description_de:" lines. */
  titleDe: string; descriptionDe: string;
}

export function parseWordList(text: string, fallbackTitle = 'Word list'): WordList {
  const meta: Record<string, string> = {};
  const rows: string[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*((?:title|description)(?:_de)?|course)\s*:\s*(.*)$/i);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    rows.push(raw);
  }
  const sep = rows.some((r) => r.includes('\t')) ? '\t' : rows.some((r) => r.includes('|')) ? '|' : ';';
  const entries: VocabData[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    const [word = '', meaning = '', picture = '', ...note] = row.split(sep).map((c) => c.trim());
    if (i === 0 && /^(word|wort|ord)$/i.test(word) && /^(meaning|bedeutung|translation|betydning)$/i.test(meaning)) return;
    if (!word || !meaning) { skipped++; return; }
    entries.push({ word, meaning, ...(picture ? { picture } : {}), ...(note.join(sep).trim() ? { note: note.join(sep).trim() } : {}) });
  });
  return {
    title: meta.title || fallbackTitle,
    description: meta.description || '',
    course: meta.course || meta.title || fallbackTitle,
    titleDe: meta.title_de || '',
    descriptionDe: meta.description_de || '',
    entries,
    skipped,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
// ../decks from both server/ (development) and dist/ (Docker image).
const DECKS_DIR = path.join(here, '..', 'decks');

export interface DeckInfo {
  id: string; title: string; description: string; titleDe: string; descriptionDe: string; course: string; words: number; pictures: number;
}

export function loadDeck(id: string): WordList | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const file = path.join(DECKS_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) return null;
  return parseWordList(fs.readFileSync(file, 'utf8'), id);
}

export function listDecks(): DeckInfo[] {
  if (!fs.existsSync(DECKS_DIR)) return [];
  return fs
    .readdirSync(DECKS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => {
      const id = f.slice(0, -4);
      const d = loadDeck(id)!;
      return {
        id, title: d.title, description: d.description, titleDe: d.titleDe, descriptionDe: d.descriptionDe, course: d.course,
        words: d.entries.length, pictures: d.entries.filter((e) => e.picture).length,
      };
    });
}

/** Add vocabulary notes to a course, skipping words that are already in it. Keeps the list order. */
export function importWords(userId: number, courseId: number, entries: VocabData[]): { added: number; existing: number } {
  const have = new Set(
    (db.prepare("SELECT data FROM notes WHERE user_id = ? AND course_id = ? AND type = 'vocab'").all(userId, courseId) as { data: string }[])
      .map((r) => { const d = JSON.parse(r.data) as VocabData; return `${d.word}\u0000${d.meaning}`; }),
  );
  let added = 0, existing = 0;
  db.transaction(() => {
    for (const e of entries) {
      const key = `${e.word}\u0000${e.meaning}`;
      if (have.has(key)) { existing++; continue; }
      have.add(key);
      createNote(userId, { courseId, type: 'vocab', data: e });
      added++;
    }
  })();
  return { added, existing };
}
