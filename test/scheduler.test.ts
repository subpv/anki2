import test from 'node:test';
import assert from 'node:assert/strict';
import { capForExam, DEFAULT_SETTINGS, dayStart, makeScheduler, schedule, type CardRow } from '../server/scheduler.ts';

const DAY = 86_400_000;
const fresh = (id = 1): CardRow => ({
  id, note_id: 1, user_id: 1, course_id: 1, ord: 'f', state: 0, due: Date.now(), stability: 0, difficulty: 0,
  elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, last_review: null, suspended: 0,
});

test('new card: Again/Good stay in learning steps, Easy graduates to days', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  const now = Date.now();
  const again = schedule(f, fresh(), 1, null, now);
  const good = schedule(f, fresh(), 3, null, now);
  const easy = schedule(f, fresh(), 4, null, now);
  assert.equal(again.state, 1);
  assert.ok(again.due - now <= 2 * 60_000);
  assert.equal(good.state, 1);
  assert.ok(Math.abs(good.due - now - 10 * 60_000) < 60_000);
  assert.equal(easy.state, 2);
  assert.ok(easy.due - now >= DAY);
});

test('intervals grow with repeated Good answers', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  let row = fresh();
  let now = Date.now();
  const intervals: number[] = [];
  for (let i = 0; i < 6; i++) {
    const s = schedule(f, row, 3, null, now);
    if (s.state === 2) intervals.push(s.scheduled_days);
    row = { ...row, ...s };
    now = s.due;
  }
  assert.ok(intervals.length >= 3);
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], intervals.join(','));
});

test('higher desired retention gives shorter intervals', () => {
  const run = (retention: number) => {
    const f = makeScheduler({ ...DEFAULT_SETTINGS, retention });
    let row = fresh();
    let now = Date.now();
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const s = schedule(f, row, 3, null, now);
      row = { ...row, ...s }; now = s.due; last = s.scheduled_days;
    }
    return last;
  };
  assert.ok(run(0.95) < run(0.8));
});

test('exam mode never schedules past the exam', () => {
  const now = new Date('2026-11-16T12:00:00').getTime();
  const exam = new Date('2026-12-01T00:00:00').getTime();
  for (const id of [1, 2, 3]) {
    const due = capForExam(now + 90 * DAY, id, '2026-12-01', now);
    assert.ok(due < exam && due >= exam - 3 * DAY, new Date(due).toISOString());
  }
  // Due before the exam: untouched. Exam already past: untouched.
  assert.equal(capForExam(now + 3 * DAY, 1, '2026-12-01', now), now + 3 * DAY);
  assert.equal(capForExam(now + 90 * DAY, 1, '2026-11-01', now), now + 90 * DAY);
  // Exam tomorrow: the card comes back before it rather than in the past.
  const tight = capForExam(now + 90 * DAY, 3, '2026-11-17', now);
  assert.ok(tight > now && tight < new Date('2026-11-17T00:00:00').getTime());
});

test('study day rolls over at 04:00', () => {
  const at = (h: number) => new Date(2026, 10, 16, h, 30).getTime();
  assert.equal(dayStart(at(3)), new Date(2026, 10, 15, 4).getTime());
  assert.equal(dayStart(at(5)), new Date(2026, 10, 16, 4).getTime());
});
