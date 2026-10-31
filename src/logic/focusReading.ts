// Focus from both kinds of check-in: the 1–5 rating, and brain and reaction tests put on the same personal scale. A test
// is placed by how it compares with your own other tests (a usual score reads as your usual focus, a good one higher),
// so the analyses that judge a dose (best dose and time, the effect window, wear-off) use every test as well as every
// rating. When a check-in has both, the rating is used. Pure.
import type { CheckIn } from '../db/schema';

/** 0–100: reaction time (250 ms or quicker is full marks, 450 ms or slower none), less 4 a lapse, and for the full test
 *  the working-memory share counting for 40%. */
export function brainScore(c: Pick<CheckIn, 'rtMs' | 'rtLapses' | 'nbackPct'>): number | undefined {
  if (typeof c.rtMs !== 'number') return undefined;
  const rt = Math.max(0, Math.min(100, ((450 - c.rtMs) / 200) * 100)) - 4 * (c.rtLapses ?? 0);
  const v = typeof c.nbackPct === 'number' ? 0.6 * rt + 0.4 * c.nbackPct : rt;
  return Math.round(Math.max(0, Math.min(100, v)));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A reader for one person's check-ins: focus 1–5 from the rating, else from a test (once there are 5 tests to compare
 *  against). Tests are placed with your ratings' own average and spread (3 and 1 without 5 ratings). */
export function focusReader(checkIns: CheckIn[]): (c: CheckIn) => number | undefined {
  const live = checkIns.filter((c) => !c.deletedAt);
  const tests = live.map(brainScore).filter((x): x is number => x !== undefined);
  const ratings = live.map((c) => c.focus).filter((x): x is number => typeof x === 'number');
  if (tests.length < 5) return (c) => (typeof c.focus === 'number' ? c.focus : undefined);
  const mT = mean(tests), sT = Math.max(5, sd(tests));
  const [mR, sR] = ratings.length >= 5 ? [mean(ratings), Math.max(0.5, sd(ratings))] : [3, 1];
  return (c) => {
    if (typeof c.focus === 'number') return c.focus;
    const b = brainScore(c);
    return b === undefined ? undefined : r1(Math.max(1, Math.min(5, mR + ((b - mT) / sT) * sR)));
  };
}

/** A focus answer of either kind: a rating, or a test. */
export const hasFocus = (c: CheckIn) => typeof c.focus === 'number' || typeof c.rtMs === 'number';
