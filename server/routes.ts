import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Grade } from 'ts-fsrs';
import { db, MEDIA_DIR } from './db.ts';
import { checkPassword, endOtherSessions, hashPassword, MIN_PASSWORD, requireUser, USERNAME_RE, type User } from './auth.ts';
import {
  DEFAULT_SETTINGS, dayEnd, dayStart, makeScheduler, previewIntervals, retrievability, schedule, type CardRow,
} from './scheduler.ts';
import { createNote, rowToNote, updateNote, validateNote, type NoteInput } from './notes.ts';
import { importApkg } from './apkg.ts';
import { importWords, listDecks, loadDeck, parseWordList } from './decks.ts';
import { parseNotesJson } from './textImport.ts';
import { resolveImages } from './imageRefs.ts';
import { MIN_REVIEWS, optimizeParameters } from './optimize.ts';
import type { Settings } from '../shared/types.ts';

const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif',
};
const DAY = 86_400_000;

function settingsOf(user: User): Settings {
  return { ...DEFAULT_SETTINGS, ...JSON.parse(user.settings || '{}') };
}
function schedulerFor(user: User) {
  return makeScheduler(settingsOf(user), user.fsrs_params ? JSON.parse(user.fsrs_params) : null);
}

interface CourseRow { id: number; name: string; color: string; exam_date: string | null; new_per_day: number }

function courseOut(c: CourseRow) {
  return { id: c.id, name: c.name, color: c.color, examDate: c.exam_date, newPerDay: c.new_per_day };
}

/** How many new cards may still be introduced today in a course. */
function newRemaining(userId: number, c: CourseRow, now: number): number {
  const done = db
    .prepare('SELECT COUNT(*) AS n FROM revlog WHERE user_id = ? AND course_id = ? AND state = 0 AND review >= ?')
    .get(userId, c.id, dayStart(now)) as { n: number };
  return Math.max(0, c.new_per_day - done.n);
}

/**
 * Like Anki, a card whose sibling (another card of the same note) was studied today waits until
 * tomorrow, so e.g. both directions of a vocabulary word are not asked on the same day.
 */
const NOT_BURIED = `NOT EXISTS (SELECT 1 FROM cards s JOIN revlog r ON r.card_id = s.id
                    WHERE s.note_id = c.note_id AND s.id != c.id AND r.review >= :today)`;

function courseCounts(userId: number, c: CourseRow, now: number) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(c.state = 0 AND c.suspended = 0 AND ${NOT_BURIED}) AS new,
              SUM(c.state IN (1, 3) AND c.suspended = 0 AND c.due <= :end) AS learning,
              SUM(c.state = 2 AND c.suspended = 0 AND c.due <= :end AND ${NOT_BURIED}) AS due
       FROM cards c WHERE c.user_id = :u AND c.course_id = :c`,
    )
    .get({ u: userId, c: c.id, end: dayEnd(now), today: dayStart(now) }) as any;
  return {
    total: r.total ?? 0,
    new: Math.min(r.new ?? 0, newRemaining(userId, c, now)),
    learning: r.learning ?? 0,
    due: r.due ?? 0,
  };
}

type Candidate = CardRow & { type: string };

/**
 * Pick the next card. Learning steps that are due come first; otherwise due reviews and new
 * cards are interleaved, steering away from the note, card type and course just seen so a
 * session does not turn into a run of look-alike cards.
 */
function nextCard(userId: number, courses: CourseRow[], now: number): CardRow | null {
  if (!courses.length) return null;
  const ids = courses.map((c) => c.id).join(',');
  const base = `SELECT c.*, n.type FROM cards c JOIN notes n ON n.id = c.note_id
                WHERE c.user_id = :u AND c.suspended = 0 AND c.course_id IN (${ids})`;
  const today = dayStart(now);
  const last = db
    .prepare(
      `SELECT c.note_id, c.course_id, n.type FROM revlog r JOIN cards c ON c.id = r.card_id JOIN notes n ON n.id = c.note_id
       WHERE r.user_id = ? AND r.review >= ? ORDER BY r.review DESC, r.id DESC LIMIT 1`,
    )
    .get(userId, dayStart(now)) as { note_id: number; course_id: number; type: string } | undefined;

  const pick = (pool: Candidate[], jitter: number): Candidate | null => {
    let best: Candidate | null = null;
    let bestScore = Infinity;
    pool.forEach((c, i) => {
      let score = i * 0.1 + Math.random() * jitter; // earlier in the pool = more overdue
      if (last) {
        if (c.note_id === last.note_id) score += 100;
        if (c.type === last.type) score += 10;
        if (courses.length > 1 && c.course_id === last.course_id) score += 3;
      }
      if (score < bestScore) { best = c; bestScore = score; }
    });
    return best;
  };

  const learning = db.prepare(`${base} AND c.state IN (1, 3) AND c.due <= :t ORDER BY c.due LIMIT 5`).all({ u: userId, t: now }) as Candidate[];
  if (learning.length) return pick(learning, 0);

  const reviews = db
    .prepare(`${base} AND c.state = 2 AND c.due <= :t AND ${NOT_BURIED} ORDER BY c.due LIMIT 60`)
    .all({ u: userId, t: dayEnd(now), today }) as Candidate[];
  // New cards are introduced in order within a course: one candidate per course, skipping siblings of the last note.
  const fresh: Candidate[] = [];
  let newLeft = 0;
  for (const c of courses) {
    const remaining = newRemaining(userId, c, now);
    if (remaining <= 0) continue;
    const rows = db
      .prepare(
        `SELECT c.*, n.type FROM cards c JOIN notes n ON n.id = c.note_id
         WHERE c.user_id = :u AND c.suspended = 0 AND c.course_id = :c AND c.state = 0 AND ${NOT_BURIED}
         ORDER BY c.note_id, c.id LIMIT 8`,
      )
      .all({ u: userId, c: c.id, today }) as Candidate[];
    if (!rows.length) continue;
    fresh.push(rows.find((r) => r.note_id !== last?.note_id) ?? rows[0]);
    newLeft += Math.min(remaining, rows.length);
  }
  if (reviews.length && fresh.length) {
    // Spread the new cards through the reviews instead of leaving them all for the end.
    return Math.random() < newLeft / (newLeft + reviews.length) ? pick(fresh, 2) : pick(reviews, 2);
  }
  if (reviews.length) return pick(reviews, 2);
  if (fresh.length) return pick(fresh, 0);

  // Nothing else left: bring forward learning steps that are due later today.
  const ahead = db.prepare(`${base} AND c.state IN (1, 3) AND c.due <= :t ORDER BY c.due LIMIT 5`).all({ u: userId, t: dayEnd(now) }) as Candidate[];
  return pick(ahead, 0);
}

/** Consecutive study days ending today (or yesterday, if today is still open). */
function studyStreak(userId: number, courseFilter: string, now: number): number {
  const start = dayStart(now);
  const days = new Set(
    (db.prepare(`SELECT DISTINCT review FROM revlog WHERE user_id = ? ${courseFilter}`).all(userId) as { review: number }[])
      .map((r) => dayStart(r.review)),
  );
  let streak = 0;
  for (let d = days.has(start) ? start : start - DAY; days.has(dayStart(d + DAY / 2)); d = dayStart(d - DAY / 2)) streak++;
  return streak;
}

/** Reviews per study day for the last `n` days, oldest first. */
function reviewsPerDay(userId: number, courseFilter: string, n: number, now: number) {
  const start = dayStart(now);
  const out = Array.from({ length: n }, (_, i) => ({ day: dayStart(start - (n - 1 - i) * DAY + DAY / 2), count: 0 }));
  const index = new Map(out.map((d, i) => [d.day, i]));
  const logs = db
    .prepare(`SELECT review FROM revlog WHERE user_id = ? AND review >= ? ${courseFilter}`)
    .all(userId, out[0].day) as { review: number }[];
  for (const l of logs) {
    const i = index.get(dayStart(l.review));
    if (i !== undefined) out[i].count++;
  }
  return out;
}

export function registerRoutes(app: FastifyInstance, feedbackUrl = '') {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return requireUser(req, reply);
  });

  const userCourses = (userId: number, courseId?: number) =>
    (courseId
      ? db.prepare('SELECT * FROM courses WHERE user_id = ? AND id = ?').all(userId, courseId)
      : db.prepare('SELECT * FROM courses WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId)) as CourseRow[];

  app.get('/api/me', async (req) => ({
    name: req.user.name,
    email: req.user.email,
    username: req.user.username,
    hasPassword: !!req.user.password_hash,
    loginMethod: req.sessionMethod,
    language: JSON.parse(req.user.settings || '{}').language === 'en' ? 'en' : 'de',
    feedbackUrl,
  }));

  app.put('/api/me/language', async (req, reply) => {
    const language = (req.body as any)?.language;
    if (language !== 'de' && language !== 'en') return reply.code(400).send({ error: 'Unknown language' });
    const s = JSON.parse(req.user.settings || '{}');
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify({ ...s, language }), req.user.id);
    return { ok: true };
  });

  /** Set or change the username and password for logging in without Authentik. */
  app.put('/api/account/password', async (req, reply) => {
    const { username = '', password = '', currentPassword = '' } = (req.body ?? {}) as Record<string, string>;
    const name = String(username).trim().toLowerCase();
    if (!USERNAME_RE.test(name)) return reply.code(400).send({ error: 'Username: 3–64 letters, digits or . _ @ -' });
    if (String(password).length < MIN_PASSWORD) return reply.code(400).send({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    // Someone who only got in with the password must know the current one to change it.
    if (req.user.password_hash && req.sessionMethod === 'password') {
      const ok = await checkPassword(String(currentPassword), req.user.password_hash);
      if (!ok) return reply.code(403).send({ error: 'Current password is wrong' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, req.user.id);
    if (taken) return reply.code(409).send({ error: 'This username is taken' });
    db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(name, await hashPassword(String(password)), req.user.id);
    endOtherSessions(req);
    return { ok: true };
  });

  app.delete('/api/account/password', async (req, reply) => {
    if (req.sessionMethod === 'password') return reply.code(400).send({ error: 'Log in with Authentik to remove the password login' });
    db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(req.user.id);
    endOtherSessions(req);
    return { ok: true };
  });

  // ---- Courses -------------------------------------------------------------
  app.get('/api/courses', async (req) => {
    const now = Date.now();
    const w = req.user.fsrs_params ? (JSON.parse(req.user.fsrs_params) as number[]) : null;
    return userCourses(req.user.id).map((c) => {
      const cards = db
        .prepare('SELECT state, stability, last_review FROM cards WHERE user_id = ? AND course_id = ? AND suspended = 0')
        .all(req.user.id, c.id) as Pick<CardRow, 'state' | 'stability' | 'last_review'>[];
      const known = cards.length ? cards.reduce((sum, r) => sum + retrievability(r, w, now), 0) / cards.length : 0;
      return { ...courseOut(c), counts: courseCounts(req.user.id, c, now), known };
    });
  });

  const courseBody = (b: any) => ({
    name: String(b?.name ?? '').trim().slice(0, 80),
    color: /^#[0-9a-f]{6}$/i.test(b?.color) ? b.color : '#f26a2e',
    exam: /^\d{4}-\d{2}-\d{2}$/.test(b?.examDate) ? b.examDate : null,
    npd: Math.min(9999, Math.max(0, Math.round(Number(b?.newPerDay ?? 20)) || 0)),
  });

  app.post('/api/courses', async (req, reply) => {
    const b = courseBody(req.body);
    if (!b.name) return reply.code(400).send({ error: 'Give the course a name' });
    const r = db
      .prepare('INSERT INTO courses (user_id, name, color, exam_date, new_per_day) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, b.name, b.color, b.exam, b.npd);
    return { id: Number(r.lastInsertRowid) };
  });

  app.put('/api/courses/:id', async (req, reply) => {
    const b = courseBody(req.body);
    if (!b.name) return reply.code(400).send({ error: 'Give the course a name' });
    db.prepare('UPDATE courses SET name = ?, color = ?, exam_date = ?, new_per_day = ? WHERE id = ? AND user_id = ?')
      .run(b.name, b.color, b.exam, b.npd, (req.params as any).id, req.user.id);
    return { ok: true };
  });

  app.delete('/api/courses/:id', async (req) => {
    db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?').run((req.params as any).id, req.user.id);
    return { ok: true };
  });

  // ---- Notes ---------------------------------------------------------------
  app.get('/api/notes', async (req) => {
    const q = req.query as { course?: string; q?: string; type?: string; tag?: string; limit?: string };
    const where = ['n.user_id = @u'];
    const params: Record<string, unknown> = { u: req.user.id, limit: Math.min(500, Math.max(1, Math.floor(Number(q.limit)) || 200)) };
    if (q.course) { where.push('n.course_id = @course'); params.course = Number(q.course); }
    if (q.type) { where.push('n.type = @type'); params.type = q.type; }
    if (q.tag) { where.push("(' ' || n.tags || ' ') LIKE @tag ESCAPE '\\'"); params.tag = `% ${q.tag.replace(/[\\%_]/g, '\\$&')} %`; }
    if (q.q?.trim()) {
      where.push("(n.data LIKE @q ESCAPE '\\' OR n.tags LIKE @q ESCAPE '\\' OR n.source_text LIKE @q ESCAPE '\\')");
      params.q = `%${q.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    }
    const rows = db
      .prepare(
        `SELECT n.*, c.name AS course_name,
                (SELECT COUNT(*) FROM cards WHERE note_id = n.id) AS card_count,
                (SELECT MIN(due) FROM cards WHERE note_id = n.id AND state != 0 AND suspended = 0) AS next_due,
                (SELECT MAX(suspended) FROM cards WHERE note_id = n.id) AS suspended
         FROM notes n JOIN courses c ON c.id = n.course_id
         WHERE ${where.join(' AND ')} ORDER BY n.updated DESC LIMIT @limit`,
      )
      .all(params);
    return rows.map(rowToNote);
  });

  app.get('/api/notes/:id', async (req, reply) => {
    const row = db
      .prepare(
        `SELECT n.*, (SELECT COUNT(*) FROM cards WHERE note_id = n.id) AS card_count, NULL AS next_due,
                (SELECT MAX(suspended) FROM cards WHERE note_id = n.id) AS suspended
         FROM notes n WHERE n.id = ? AND n.user_id = ?`,
      )
      .get((req.params as any).id, req.user.id);
    if (!row) return reply.code(404).send({ error: 'Card not found' });
    return rowToNote(row);
  });

  const checkedNote = (userId: number, body: any): NoteInput | string => {
    const n = body as NoteInput;
    const err = validateNote(n);
    if (err) return err;
    if (!userCourses(userId, Number(n.courseId)).length) return 'Pick a course';
    return { ...n, courseId: Number(n.courseId) };
  };

  app.post('/api/notes', async (req, reply) => {
    const n = checkedNote(req.user.id, req.body);
    if (typeof n === 'string') return reply.code(400).send({ error: n });
    return { id: createNote(req.user.id, n) };
  });

  app.put('/api/notes/:id', async (req, reply) => {
    const n = checkedNote(req.user.id, req.body);
    if (typeof n === 'string') return reply.code(400).send({ error: n });
    const id = Number((req.params as any).id);
    if (!db.prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?').get(id, req.user.id)) {
      return reply.code(404).send({ error: 'Card not found' });
    }
    updateNote(req.user.id, id, n);
    return { ok: true };
  });

  app.delete('/api/notes/:id', async (req) => {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run((req.params as any).id, req.user.id);
    return { ok: true };
  });

  app.post('/api/notes/:id/suspend', async (req) => {
    db.prepare('UPDATE cards SET suspended = ? WHERE note_id = ? AND user_id = ?')
      .run((req.body as any)?.suspended ? 1 : 0, (req.params as any).id, req.user.id);
    return { ok: true };
  });

  app.get('/api/tags', async (req) => {
    const rows = db.prepare("SELECT tags FROM notes WHERE user_id = ? AND tags != ''").all(req.user.id) as { tags: string }[];
    return [...new Set(rows.flatMap((r) => r.tags.split(' ')))].sort();
  });

  // ---- Review --------------------------------------------------------------
  const cardPayload = (user: User, row: CardRow, now: number, withIntervals = true) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(row.note_id);
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id) as CourseRow;
    return {
      card: { id: row.id, ord: row.ord, state: row.state, due: row.due, reps: row.reps, lapses: row.lapses },
      note: rowToNote(note),
      course: { id: course.id, name: course.name, color: course.color },
      // Cram does not reschedule, so it does not need the intervals (costly for big courses).
      intervals: withIntervals ? previewIntervals(schedulerFor(user), row, course.exam_date, now) : { 1: '', 2: '', 3: '', 4: '' },
    };
  };

  app.get('/api/review/next', async (req) => {
    const now = Date.now();
    const courseId = Number((req.query as any).course) || undefined;
    const courses = userCourses(req.user.id, courseId);
    const counts = { new: 0, learning: 0, due: 0 };
    for (const c of courses) {
      const cc = courseCounts(req.user.id, c, now);
      counts.new += cc.new; counts.learning += cc.learning; counts.due += cc.due;
    }
    const row = nextCard(req.user.id, courses, now);
    const canUndo = !!lastUndoable(req.user.id, courseId, now);
    return { next: row ? cardPayload(req.user, row, now) : null, counts, canUndo };
  });

  app.post('/api/review/answer', async (req, reply) => {
    const { cardId, rating, durationMs } = req.body as { cardId: number; rating: number; durationMs?: number };
    if (![1, 2, 3, 4].includes(rating)) return reply.code(400).send({ error: 'Invalid rating' });
    const row = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(cardId, req.user.id) as CardRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Card not found' });
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id) as CourseRow;
    const now = Date.now();
    const s = schedule(schedulerFor(req.user), row, rating as Grade, course.exam_date, now);
    db.transaction(() => {
      db.prepare(
        `UPDATE cards SET state = @state, due = @due, stability = @stability, difficulty = @difficulty,
           elapsed_days = @elapsed_days, scheduled_days = @scheduled_days, learning_steps = @learning_steps,
           reps = @reps, lapses = @lapses, last_review = @last_review WHERE id = @id`,
      ).run({ ...s, id: row.id });
      db.prepare(
        'INSERT INTO revlog (card_id, user_id, course_id, rating, state, review, duration_ms, prev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(row.id, req.user.id, row.course_id, rating, row.state, now, Math.min(600_000, Math.max(0, Number(durationMs) || 0)), JSON.stringify(row));
    })();
    return { ok: true };
  });

  /** Undo only today's reviews, and in a course review only that course's. */
  const lastUndoable = (userId: number, courseId: number | undefined, now: number) =>
    db.prepare(
      `SELECT id, card_id, prev FROM revlog WHERE user_id = ? AND review >= ? ${courseId ? 'AND course_id = ?' : ''}
       ORDER BY review DESC, id DESC LIMIT 1`,
    ).get(...[userId, dayStart(now), ...(courseId ? [courseId] : [])]) as { id: number; card_id: number; prev: string } | undefined;

  app.post('/api/review/undo', async (req, reply) => {
    const log = lastUndoable(req.user.id, Number((req.query as any).course) || undefined, Date.now());
    if (!log) return reply.code(404).send({ error: 'Nothing to undo' });
    const p = JSON.parse(log.prev) as CardRow;
    db.transaction(() => {
      db.prepare(
        `UPDATE cards SET state = @state, due = @due, stability = @stability, difficulty = @difficulty,
           elapsed_days = @elapsed_days, scheduled_days = @scheduled_days, learning_steps = @learning_steps,
           reps = @reps, lapses = @lapses, last_review = @last_review WHERE id = @id`,
      ).run(p);
      db.prepare('DELETE FROM revlog WHERE id = ?').run(log.id);
    })();
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(log.card_id) as CardRow;
    return { card: cardPayload(req.user, row, Date.now()) };
  });

  /** Cram: every card of a course, shuffled. The client runs the session; nothing is rescheduled. */
  app.get('/api/courses/:id/cram', async (req) => {
    const rows = db
      .prepare('SELECT * FROM cards WHERE user_id = ? AND course_id = ? AND suspended = 0')
      .all(req.user.id, (req.params as any).id) as CardRow[];
    for (let i = rows.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const now = Date.now();
    return rows.map((r) => cardPayload(req.user, r, now, false));
  });

  // ---- Stats ---------------------------------------------------------------
  app.get('/api/summary', async (req) => {
    const now = Date.now();
    const settings = settingsOf(req.user);
    const year = reviewsPerDay(req.user.id, '', 53 * 7, now);
    return {
      today: year[year.length - 1].count,
      goal: settings.dailyGoal,
      streak: studyStreak(req.user.id, '', now),
      answerSeconds: settings.answerSeconds,
      year,
    };
  });

  app.get('/api/stats', async (req) => {
    const u = req.user.id;
    const courseId = Number((req.query as any).course) || null;
    const cf = courseId ? `AND course_id = ${courseId}` : '';
    const now = Date.now();
    const start = dayStart(now);
    const DAYS = 30;

    const states = db
      .prepare(
        `SELECT SUM(suspended = 0 AND state = 0) AS new,
                SUM(suspended = 0 AND state IN (1, 3)) AS learning,
                SUM(suspended = 0 AND state = 2 AND scheduled_days < 21) AS young,
                SUM(suspended = 0 AND state = 2 AND scheduled_days >= 21) AS mature,
                SUM(suspended) AS suspended, COUNT(*) AS total
         FROM cards WHERE user_id = ? ${cf}`,
      )
      .get(u) as Record<string, number | null>;

    // Study days start at 04:00 local time and are 23 or 25 hours long around DST changes,
    // so each review is put on the day dayStart() gives it.
    const dayOf = (offset: number) => dayStart(start + offset * DAY + DAY / 2);
    const reviews = Array.from({ length: DAYS }, (_, i) => ({ day: dayOf(i - (DAYS - 1)), count: 0, again: 0 }));
    const reviewIndex = new Map(reviews.map((r, i) => [r.day, i]));
    const logs = db
      .prepare(`SELECT review, rating, state FROM revlog WHERE user_id = ? AND review >= ? ${cf}`)
      .all(u, reviews[0].day) as { review: number; rating: number; state: number }[];
    let matureTotal = 0, maturePassed = 0;
    for (const l of logs) {
      const i = reviewIndex.get(dayStart(l.review));
      if (i === undefined) continue;
      reviews[i].count++;
      if (l.rating === 1) reviews[i].again++;
      if (l.state === 2) { matureTotal++; if (l.rating > 1) maturePassed++; }
    }

    const forecast = Array.from({ length: DAYS }, (_, i) => ({ day: dayOf(i), count: 0 }));
    const forecastIndex = new Map(forecast.map((f, i) => [f.day, i]));
    const dues = db
      .prepare(`SELECT due FROM cards WHERE user_id = ? AND suspended = 0 AND state != 0 AND due < ? ${cf}`)
      .all(u, dayOf(DAYS)) as { due: number }[];
    for (const d of dues) {
      const i = d.due < start ? 0 : forecastIndex.get(dayStart(d.due)); // overdue counts as today
      if (i !== undefined) forecast[i].count++;
    }

    const streak = studyStreak(u, cf, now);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM revlog WHERE user_id = ? ${cf}`).get(u) as { n: number }).n;
    return {
      states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v ?? 0])),
      reviews, forecast, streak, totalReviews: total,
      year: reviewsPerDay(u, cf, 53 * 7, now),
      today: reviews[DAYS - 1].count,
      retention: matureTotal ? maturePassed / matureTotal : null,
      retentionSample: matureTotal,
    };
  });

  // ---- Settings & FSRS -----------------------------------------------------
  app.get('/api/settings', async (req) => {
    const reviews = (db.prepare('SELECT COUNT(*) AS n FROM revlog WHERE user_id = ?').get(req.user.id) as { n: number }).n;
    return { settings: settingsOf(req.user), optimized: !!req.user.fsrs_params, reviews, minReviews: MIN_REVIEWS };
  });

  app.put('/api/settings', async (req, reply) => {
    const b = req.body as Partial<Settings>;
    const s: Settings = {
      retention: Number(b.retention),
      maxInterval: Math.round(Number(b.maxInterval)),
      learningSteps: String(b.learningSteps ?? '').trim(),
      relearningSteps: String(b.relearningSteps ?? '').trim(),
      dailyGoal: Math.round(Number(b.dailyGoal ?? DEFAULT_SETTINGS.dailyGoal)),
      answerSeconds: Math.round(Number(b.answerSeconds ?? DEFAULT_SETTINGS.answerSeconds)),
    };
    if (!(s.dailyGoal >= 1 && s.dailyGoal <= 9999)) return reply.code(400).send({ error: 'Daily goal must be at least 1 card' });
    if (!(s.answerSeconds >= 0 && s.answerSeconds <= 3600)) return reply.code(400).send({ error: 'Answer timer must be between 0 and 3600 seconds' });
    if (!(s.retention >= 0.7 && s.retention <= 0.97)) return reply.code(400).send({ error: 'Desired retention must be between 70 % and 97 %' });
    if (!(s.maxInterval >= 1)) return reply.code(400).send({ error: 'Maximum interval must be at least 1 day' });
    const stepRe = /^(\d+(\.\d+)?[mhd](\s+|$))*$/;
    if (!stepRe.test(s.learningSteps) || !stepRe.test(s.relearningSteps)) {
      return reply.code(400).send({ error: 'Steps look like "1m 10m" (m, h or d)' });
    }
    const old = JSON.parse(req.user.settings || '{}');
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify({ ...old, ...s }), req.user.id);
    return { ok: true };
  });

  app.post('/api/fsrs/optimize', async (req, reply) => {
    try {
      const { params, reviews } = await optimizeParameters(req.user.id);
      db.prepare('UPDATE users SET fsrs_params = ? WHERE id = ?').run(JSON.stringify(params), req.user.id);
      return { ok: true, reviews };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/fsrs/optimize', async (req) => {
    db.prepare('UPDATE users SET fsrs_params = NULL WHERE id = ?').run(req.user.id);
    return { ok: true };
  });

  // ---- Media & import ------------------------------------------------------
  app.post('/api/media', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) return reply.code(400).send({ error: 'Only PNG, JPEG, GIF, WebP and AVIF images are supported' });
    const name = crypto.randomBytes(12).toString('hex') + ext;
    fs.writeFileSync(path.join(MEDIA_DIR, name), await file.toBuffer());
    return { url: `/media/${name}` };
  });

  app.get('/api/decks', async () => listDecks());

  /** Add a ready-made deck. Without a course id it goes into a course named after the deck (created if needed). */
  app.post('/api/decks/:id/import', async (req, reply) => {
    const deck = loadDeck((req.params as any).id);
    if (!deck) return reply.code(404).send({ error: 'Deck not found' });
    let courseId = Number((req.body as any)?.courseId) || 0;
    if (courseId) {
      if (!userCourses(req.user.id, courseId).length) return reply.code(400).send({ error: 'Pick a course' });
    } else {
      const existing = db.prepare('SELECT id FROM courses WHERE user_id = ? AND name = ?').get(req.user.id, deck.course) as { id: number } | undefined;
      courseId = existing?.id ?? Number(
        db.prepare('INSERT INTO courses (user_id, name, color, new_per_day) VALUES (?, ?, ?, 20)').run(req.user.id, deck.course, '#c8102e').lastInsertRowid,
      );
    }
    return { courseId, ...importWords(req.user.id, courseId, deck.entries) };
  });

  /**
   * Paste or upload text: JSON notes (any card type) or a word list. Goes into an existing course,
   * or a course with the given name (created if needed; for JSON the file's "course" is the default).
   * JSON is all-or-nothing: with any problem, nothing is imported and every problem is listed.
   */
  app.post('/api/import/text', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const { text = '', courseId, newCourse = '', files = {} } = (req.body ?? {}) as { text?: string; courseId?: number; newCourse?: string; files?: Record<string, string> };
    const body = String(text).trim();
    if (!body) return reply.code(400).send({ error: 'Nothing to import' });
    const isJson = body.startsWith('{') || body.startsWith('[') || body.startsWith('```');
    const parsed = isJson ? parseNotesJson(body) : null;
    if (parsed?.problems.length) return reply.code(400).send({ error: 'The import has problems', problems: parsed.problems.slice(0, 50), repaired: parsed.repaired });
    const words = isJson ? null : parseWordList(body);
    if (words && !words.entries.length) return reply.code(400).send({ error: 'No words found. Each line needs a word and its meaning, separated by a tab, | or ;' });

    // Check the course before downloading any pictures.
    let target = Number(courseId) || 0;
    const name = (String(newCourse).trim() || parsed?.course || '').slice(0, 80);
    if (target ? !userCourses(req.user.id, target).length : !name) return reply.code(400).send({ error: 'Pick a course' });

    let downloaded = 0;
    let cleanupPictures = () => {};
    if (parsed) {
      const pics = await resolveImages(parsed.notes, files, parsed.problems);
      downloaded = pics.downloaded;
      cleanupPictures = pics.cleanup;
      if (parsed.problems.length) {
        pics.cleanup(); // nothing is imported, so drop the pictures downloaded for it
        return reply.code(400).send({ error: 'The import has problems', problems: parsed.problems.slice(0, 50), repaired: parsed.repaired });
      }
    }

    if (!target) {
      const existing = db.prepare('SELECT id FROM courses WHERE user_id = ? AND name = ?').get(req.user.id, name) as { id: number } | undefined;
      target = existing?.id ?? Number(
        db.prepare('INSERT INTO courses (user_id, name, color, new_per_day) VALUES (?, ?, ?, 20)').run(req.user.id, name, '#f26a2e').lastInsertRowid,
      );
    }
    if (words) return { kind: 'words', courseId: target, skipped: words.skipped, ...importWords(req.user.id, target, words.entries) };
    let cards = 0;
    try {
      db.transaction(() => {
        for (const n of parsed!.notes) {
          const noteId = createNote(req.user.id, { ...n, courseId: target });
          cards += (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE note_id = ?').get(noteId) as { n: number }).n;
        }
      })();
    } catch (err) {
      cleanupPictures();
      throw err;
    }
    return { kind: 'json', courseId: target, added: parsed!.notes.length, cards, repaired: parsed!.repaired, downloaded };
  });

  app.post('/api/import/words', async (req, reply) => {
    const courseId = Number((req.query as any).course);
    if (!userCourses(req.user.id, courseId).length) return reply.code(400).send({ error: 'Pick a course to import into' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    const list = parseWordList((await file.toBuffer()).toString('utf8'));
    if (!list.entries.length) return reply.code(400).send({ error: 'No words found. Each line needs a word and its meaning, separated by a tab, | or ;' });
    return { courseId, skipped: list.skipped, ...importWords(req.user.id, courseId, list.entries) };
  });

  app.post('/api/import/apkg', async (req, reply) => {
    const courseId = Number((req.query as any).course);
    if (!userCourses(req.user.id, courseId).length) return reply.code(400).send({ error: 'Pick a course to import into' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    try {
      return importApkg(await file.toBuffer(), req.user.id, courseId);
    } catch (err) {
      req.log.warn(err, 'apkg import failed');
      return reply.code(400).send({ error: `Import failed: ${(err as Error).message}` });
    }
  });
}
