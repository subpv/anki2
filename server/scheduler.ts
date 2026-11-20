import { default_w, forgetting_curve, fsrs, GenSeedStrategyWithCardId, generatorParameters, State, StrategyMode, type Card, type Grade, type FSRS, type StepUnit } from 'ts-fsrs';
import type { Settings } from '../shared/types.ts';

export const DEFAULT_SETTINGS: Settings = {
  retention: 0.9,
  maxInterval: 36500,
  learningSteps: '1m 10m',
  relearningSteps: '10m',
  dailyGoal: 20,
  answerSeconds: 30,
};

const DAY = 86_400_000;
const ROLLOVER_HOUR = 4; // like Anki: a study day ends at 04:00 local time

export interface CardRow {
  id: number; note_id: number; user_id: number; course_id: number; ord: string;
  state: number; due: number; stability: number; difficulty: number;
  elapsed_days: number; scheduled_days: number; learning_steps: number;
  reps: number; lapses: number; last_review: number | null; suspended: number;
}

export function dayStart(now = Date.now()): number {
  const d = new Date(now);
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(ROLLOVER_HOUR, 0, 0, 0);
  return d.getTime();
}
export const dayEnd = (now = Date.now()) => dayStart(now) + DAY;

function steps(s: string): StepUnit[] {
  return s.split(/[\s,]+/).filter((x) => /^\d+(\.\d+)?[mhd]$/.test(x)) as StepUnit[];
}

export function makeScheduler(settings: Settings, w?: number[] | null): FSRS {
  return fsrs(generatorParameters({
    request_retention: Math.min(0.97, Math.max(0.7, settings.retention)),
    maximum_interval: Math.max(1, Math.round(settings.maxInterval)),
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: steps(settings.learningSteps),
    relearning_steps: steps(settings.relearningSteps),
    ...(w?.length ? { w } : {}),
  // Fuzz seeded by card id and repetitions (not the time), so the interval shown under a button
  // is exactly the one applied when it is pressed a few seconds later.
  })).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('card_id'));
}

export function toFsrsCard(r: CardRow): Card & { card_id: number } {
  return {
    card_id: r.id,
    due: new Date(r.due), stability: r.stability, difficulty: r.difficulty,
    elapsed_days: r.elapsed_days, scheduled_days: r.scheduled_days, learning_steps: r.learning_steps,
    reps: r.reps, lapses: r.lapses, state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  };
}

/**
 * Exam mode: a card that FSRS would push past the exam is pulled back so it comes up
 * once more in the last three days before it (spread by card id so they don't pile up).
 */
export function capForExam(due: number, cardId: number, examDate: string | null, now: number): number {
  if (!examDate) return due;
  const exam = new Date(`${examDate}T00:00:00`).getTime();
  if (!Number.isFinite(exam) || exam <= now || due < exam) return due;
  const capped = exam - (1 + (cardId % 3)) * DAY + 8 * 3_600_000;
  if (capped > now + DAY / 2) return capped;
  // Too close to the exam for that: come back halfway between now and the exam.
  return exam - now > 2 * 3_600_000 ? now + (exam - now) / 2 : due;
}

export interface Scheduled {
  state: number; due: number; stability: number; difficulty: number; elapsed_days: number;
  scheduled_days: number; learning_steps: number; reps: number; lapses: number; last_review: number;
}

export function schedule(f: FSRS, row: CardRow, rating: Grade, examDate: string | null, now = Date.now()): Scheduled {
  const { card } = f.next(toFsrsCard(row), new Date(now), rating);
  let due = card.due.getTime();
  let scheduled_days = card.scheduled_days;
  if (card.state === State.Review) {
    const capped = capForExam(due, row.id, examDate, now);
    if (capped !== due) {
      due = capped;
      scheduled_days = Math.max(1, Math.round((due - now) / DAY));
    }
  }
  return {
    state: card.state, due, stability: card.stability, difficulty: card.difficulty,
    elapsed_days: card.elapsed_days, scheduled_days, learning_steps: card.learning_steps,
    reps: card.reps, lapses: card.lapses, last_review: now,
  };
}

export function humanInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30.44).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(d / 365.25).toFixed(1).replace(/\.0$/, '')}y`;
}

export function previewIntervals(f: FSRS, row: CardRow, examDate: string | null, now = Date.now()) {
  const out = {} as Record<1 | 2 | 3 | 4, string>;
  for (const g of [1, 2, 3, 4] as const) {
    out[g] = humanInterval(schedule(f, row, g as Grade, examDate, now).due - now);
  }
  return out;
}

/** Chance (0..1) of recalling this card right now, from the FSRS forgetting curve. */
export function retrievability(row: Pick<CardRow, 'state' | 'stability' | 'last_review'>, w: number[] | null, now = Date.now()): number {
  if (row.state === 0 || !row.last_review || row.stability <= 0) return 0;
  const elapsed = Math.max(0, (now - row.last_review) / DAY);
  return forgetting_curve(w?.length ? w : default_w, elapsed, row.stability);
}
