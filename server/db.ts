import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// The app was briefly called MechDeck; carry an existing database over to the new file name.
const DB_FILE = path.join(DATA_DIR, 'card.db');
const OLD_DB_FILE = path.join(DATA_DIR, 'mechdeck.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(OLD_DB_FILE)) {
  const old = new Database(OLD_DB_FILE);
  old.pragma('wal_checkpoint(TRUNCATE)');
  old.close();
  fs.renameSync(OLD_DB_FILE, DB_FILE);
}

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  sub TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  fsrs_params TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f26a2e',
  exam_date TEXT,
  new_per_day INTEGER NOT NULL DEFAULT 20
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_course ON notes(user_id, course_id);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  ord TEXT NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  suspended INTEGER NOT NULL DEFAULT 0,
  UNIQUE(note_id, ord)
);
CREATE INDEX IF NOT EXISTS cards_queue ON cards(user_id, suspended, state, due);
CREATE TABLE IF NOT EXISTS revlog (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  review INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  prev TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS revlog_user ON revlog(user_id, review);
CREATE INDEX IF NOT EXISTS revlog_card ON revlog(card_id, review);
`);
