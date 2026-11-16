import { computeParameters, FSRSBindingItem, FSRSBindingReview } from '@open-spaced-repetition/binding';
import { db } from './db.ts';
import { dayStart } from './scheduler.ts';

export const MIN_REVIEWS = 400;

/** Fit FSRS parameters to the user's own review history. */
export async function optimizeParameters(userId: number): Promise<{ params: number[]; reviews: number }> {
  const rows = db
    .prepare('SELECT card_id, rating, review FROM revlog WHERE user_id = ? ORDER BY card_id, review')
    .all(userId) as { card_id: number; rating: number; review: number }[];
  if (rows.length < MIN_REVIEWS) {
    throw new Error(`Need at least ${MIN_REVIEWS} reviews to optimise (you have ${rows.length}).`);
  }
  const items: FSRSBindingItem[] = [];
  let cardId = -1;
  let history: FSRSBindingReview[] = [];
  let lastDay = 0;
  for (const r of rows) {
    const day = Math.floor(dayStart(r.review) / 86_400_000);
    if (r.card_id !== cardId) {
      cardId = r.card_id;
      history = [];
      lastDay = day;
    }
    const deltaT = day - lastDay;
    lastDay = day;
    history.push(new FSRSBindingReview(r.rating, deltaT));
    // One training item per review that happened at least a day after the previous one.
    if (history.length > 1 && deltaT > 0) items.push(new FSRSBindingItem([...history]));
  }
  if (items.length < 100) {
    throw new Error('Not enough multi-day review history yet. Keep reviewing for a few more weeks.');
  }
  const params = await computeParameters(items, { enableShortTerm: true });
  return { params: Array.from(params), reviews: rows.length };
}
