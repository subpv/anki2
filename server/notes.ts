import { db } from './db.ts';
import { cardOrds, type Note, type NoteType } from '../shared/types.ts';

const TYPES: NoteType[] = ['basic', 'cloze', 'numeric', 'param', 'formula', 'code', 'derivation', 'occlusion', 'vocab'];

export interface NoteInput {
  courseId: number; type: NoteType; data: any; tags?: string; sourceText?: string; sourceUrl?: string;
}

export function validateNote(n: NoteInput): string | null {
  if (!TYPES.includes(n.type)) return 'Unknown card type';
  if (!n.data || typeof n.data !== 'object') return 'Missing card content';
  if (cardOrds(n.type, n.data).length === 0) {
    if (n.type === 'cloze') return 'Add at least one cloze deletion, e.g. {{c1::answer}}';
    if (n.type === 'occlusion') return 'Draw at least one box on the image';
    return 'This note would not create any cards';
  }
  if (n.type === 'vocab' && (!String(n.data.word ?? '').trim() || !String(n.data.meaning ?? '').trim())) {
    return 'Fill in both the word and its meaning';
  }
  if ((n.type === 'numeric') && !Number.isFinite(Number(n.data.value))) return 'The answer must be a number';
  if (n.sourceUrl && !/^https?:\/\//i.test(n.sourceUrl)) return 'The source link must start with http:// or https://';
  return null;
}

/** Create/remove cards so they match the note. Existing cards (and their schedule) are kept. */
export function syncCards(noteId: number, userId: number, courseId: number, type: NoteType, data: any) {
  const want = cardOrds(type, data);
  const have = db.prepare('SELECT id, ord FROM cards WHERE note_id = ?').all(noteId) as { id: number; ord: string }[];
  const now = Date.now();
  const ins = db.prepare('INSERT INTO cards (note_id, user_id, course_id, ord, due) VALUES (?, ?, ?, ?, ?)');
  for (const ord of want) if (!have.some((c) => c.ord === ord)) ins.run(noteId, userId, courseId, ord, now);
  for (const c of have) if (!want.includes(c.ord)) db.prepare('DELETE FROM cards WHERE id = ?').run(c.id);
  db.prepare('UPDATE cards SET course_id = ? WHERE note_id = ?').run(courseId, noteId);
  db.prepare('UPDATE revlog SET course_id = ? WHERE card_id IN (SELECT id FROM cards WHERE note_id = ?)').run(courseId, noteId);
}

export const createNote = db.transaction((userId: number, n: NoteInput): number => {
  const now = Date.now();
  const r = db
    .prepare(
      `INSERT INTO notes (user_id, course_id, type, data, tags, source_text, source_url, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, n.courseId, n.type, JSON.stringify(n.data), normTags(n.tags), n.sourceText ?? '', n.sourceUrl ?? '', now, now);
  const id = Number(r.lastInsertRowid);
  syncCards(id, userId, n.courseId, n.type, n.data);
  return id;
});

export const updateNote = db.transaction((userId: number, id: number, n: NoteInput) => {
  db.prepare(
    `UPDATE notes SET course_id = ?, type = ?, data = ?, tags = ?, source_text = ?, source_url = ?, updated = ?
     WHERE id = ? AND user_id = ?`,
  ).run(n.courseId, n.type, JSON.stringify(n.data), normTags(n.tags), n.sourceText ?? '', n.sourceUrl ?? '', Date.now(), id, userId);
  syncCards(id, userId, n.courseId, n.type, n.data);
});

export function normTags(tags?: string): string {
  return [...new Set((tags ?? '').split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean))].join(' ');
}

export function rowToNote(r: any): Note {
  return {
    id: r.id, courseId: r.course_id, type: r.type, data: JSON.parse(r.data), tags: r.tags,
    sourceText: r.source_text, sourceUrl: r.source_url, created: r.created, updated: r.updated,
    ...(r.card_count !== undefined ? { cardCount: r.card_count, nextDue: r.next_due, suspended: !!r.suspended } : {}),
    ...(r.course_name !== undefined ? { courseName: r.course_name } : {}),
  };
}
