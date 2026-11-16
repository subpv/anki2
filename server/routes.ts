import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Grade } from 'ts-fsrs';
import { db, MEDIA_DIR } from './db.ts';
import { requireUser, type User } from './auth.ts';
import {
  DEFAULT_SETTINGS, dayEnd, dayStart, makeScheduler, previewIntervals, schedule, type CardRow,
} from './scheduler.ts';
import { createNote, rowToNote, updateNote, validateNote, type NoteInput } from './notes.ts';
import { importApkg } from './apkg.ts';
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

function courseCounts(userId: number, c: CourseRow, now: number) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(state = 0 AND suspended = 0) AS new,
              SUM(state IN (1, 3) AND suspended = 0 AND due <= :end) AS learning,
              SUM(state = 2 AND suspended = 0 AND due <= :end) AS due
       FROM cards WHERE user_id = :u AND course_id = :c`,
    )
    .get({ u: userId, c: c.id, end: dayEnd(now) }) as any;
  return {
    total: r.total ?? 0,
    new: Math.min(r.new ?? 0, newRemaining(userId, c, now)),
    learning: r.learning ?? 0,
    due: r.due ?? 0,
  };
}

function nextCard(userId: number, courses: CourseRow[], now: number): CardRow | null {
  if (!courses.length) return null;
  const ids = courses.map((c) => c.id).join(',');
  const base = `SELECT * FROM cards WHERE user_id = ? AND suspended = 0 AND course_id IN (${ids})`;
  const learning = db.prepare(`${base} AND state IN (1, 3) AND due <= ? ORDER BY due LIMIT 1`).get(userId, now);
  if (learning) return learning as CardRow;
  const review = db.prepare(`${base} AND state = 2 AND due <= ? ORDER BY due LIMIT 1`).get(userId, dayEnd(now));
  if (review) return review as CardRow;
  for (const c of courses) {
    if (newRemaining(userId, c, now) <= 0) continue;
    const fresh = db
      .prepare('SELECT * FROM cards WHERE user_id = ? AND suspended = 0 AND course_id = ? AND state = 0 ORDER BY note_id, id LIMIT 1')
      .get(userId, c.id);
    if (fresh) return fresh as CardRow;
  }
  // Nothing else left: bring forward learning steps that are due later today.
  const ahead = db.prepare(`${base} AND state IN (1, 3) AND due <= ? ORDER BY due LIMIT 1`).get(userId, dayEnd(now));
  return (ahead as CardRow) ?? null;
}

export function registerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return requireUser(req, reply);
  });

  const userCourses = (userId: number, courseId?: number) =>
    (courseId
      ? db.prepare('SELECT * FROM courses WHERE user_id = ? AND id = ?').all(userId, courseId)
      : db.prepare('SELECT * FROM courses WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId)) as CourseRow[];

  app.get('/api/me', async (req) => ({ name: req.user.name, email: req.user.email }));

  // ---- Courses -------------------------------------------------------------
  app.get('/api/courses', async (req) => {
    const now = Date.now();
    return userCourses(req.user.id).map((c) => ({ ...courseOut(c), counts: courseCounts(req.user.id, c, now) }));
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
    const params: Record<string, unknown> = { u: req.user.id, limit: Math.min(500, Number(q.limit) || 200) };
    if (q.course) { where.push('n.course_id = @course'); params.course = Number(q.course); }
    if (q.type) { where.push('n.type = @type'); params.type = q.type; }
    if (q.tag) { where.push("(' ' || n.tags || ' ') LIKE @tag"); params.tag = `% ${q.tag} %`; }
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
    updateNote(req.user.id, Number((req.params as any).id), n);
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
  const cardPayload = (user: User, row: CardRow, now: number) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(row.note_id);
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id) as CourseRow;
    return {
      card: { id: row.id, ord: row.ord, state: row.state, due: row.due, reps: row.reps, lapses: row.lapses },
      note: rowToNote(note),
      course: { id: course.id, name: course.name, color: course.color },
      intervals: previewIntervals(schedulerFor(user), row, course.exam_date, now),
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
    const canUndo = !!db.prepare('SELECT 1 FROM revlog WHERE user_id = ? AND review >= ? LIMIT 1').get(req.user.id, dayStart(now));
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

  app.post('/api/review/undo', async (req, reply) => {
    const log = db
      .prepare('SELECT id, card_id, prev FROM revlog WHERE user_id = ? ORDER BY review DESC, id DESC LIMIT 1')
      .get(req.user.id) as { id: number; card_id: number; prev: string } | undefined;
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
    return rows.map((r) => cardPayload(req.user, r, now));
  });

  // ---- Stats ---------------------------------------------------------------
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

    const reviews = Array.from({ length: DAYS }, (_, i) => ({ day: start - (DAYS - 1 - i) * DAY, count: 0, again: 0 }));
    const logs = db
      .prepare(`SELECT review, rating, state FROM revlog WHERE user_id = ? AND review >= ? ${cf}`)
      .all(u, start - (DAYS - 1) * DAY) as { review: number; rating: number; state: number }[];
    let matureTotal = 0, maturePassed = 0;
    for (const l of logs) {
      const i = Math.floor((l.review - reviews[0].day) / DAY);
      if (!reviews[i]) continue;
      reviews[i].count++;
      if (l.rating === 1) reviews[i].again++;
      if (l.state === 2) { matureTotal++; if (l.rating > 1) maturePassed++; }
    }

    const forecast = Array.from({ length: DAYS }, (_, i) => ({ day: start + i * DAY, count: 0 }));
    const dues = db
      .prepare(`SELECT due FROM cards WHERE user_id = ? AND suspended = 0 AND state != 0 AND due < ? ${cf}`)
      .all(u, start + DAYS * DAY) as { due: number }[];
    for (const d of dues) forecast[Math.max(0, Math.floor((d.due - start) / DAY))].count++;

    // Streak: consecutive study days ending today (or yesterday, if today is still open).
    const days = new Set(
      (db.prepare(`SELECT DISTINCT review FROM revlog WHERE user_id = ? ${cf}`).all(u) as { review: number }[])
        .map((r) => dayStart(r.review)),
    );
    let streak = 0;
    for (let d = days.has(start) ? start : start - DAY; days.has(dayStart(d + DAY / 2)); d = dayStart(d - DAY / 2)) streak++;

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM revlog WHERE user_id = ? ${cf}`).get(u) as { n: number }).n;
    return {
      states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v ?? 0])),
      reviews, forecast, streak, totalReviews: total,
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
    };
    if (!(s.retention >= 0.7 && s.retention <= 0.97)) return reply.code(400).send({ error: 'Desired retention must be between 70 % and 97 %' });
    if (!(s.maxInterval >= 1)) return reply.code(400).send({ error: 'Maximum interval must be at least 1 day' });
    const stepRe = /^(\d+(\.\d+)?[mhd](\s+|$))*$/;
    if (!stepRe.test(s.learningSteps) || !stepRe.test(s.relearningSteps)) {
      return reply.code(400).send({ error: 'Steps look like "1m 10m" (m, h or d)' });
    }
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(s), req.user.id);
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
