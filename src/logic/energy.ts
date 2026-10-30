// Losing weight well (both apps with food and body): what the person actually burns, worked out from their own food
// logs and weight trend (the way a dietitian would: what went in, against what the scale did), a calorie target for
// the rate of loss they choose, and protein enough to keep muscle while losing. From their own records; estimates
// with their basis, updated as the records come in. Pure.
import type { BodyEntry, FoodLog } from '../db/schema';
import { robustFit } from './forecast';
import { dayKey } from './stats';
import { muscleWatch } from './training';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
/** Energy in a kilogram of body weight lost or gained (mostly fat, some lean and water): the usual working figure. */
export const KCAL_PER_KG = 7700;
/** A day with less than this logged is taken as only partly logged, and left out. */
const PARTIAL_DAY = 800;

export interface Expenditure {
  /** About what's burned a day (kcal), and the range from the weight trend's uncertainty. */
  kcal: number; low: number; high: number;
  /** The average logged a day, and the weight trend (kg a week, negative = losing). */
  intake: number; kgPerWeek: number;
  /** Days with food logged, and weigh-ins, over the window. */
  days: number; weighIns: number; windowDays: number;
}

/** What the person burns: average intake on fully logged days, plus the energy the weight change stands for. Needs
 *  two weeks of food logs and six weigh-ins in the last four weeks. */
export function expenditure(foodLogs: FoodLog[], body: BodyEntry[], now: number, s: ScheduleSettings, windowDays = 28): Expenditure | null {
  const from = now - windowDays * DAY;
  const today = dayKey(now, s);
  const byDay = new Map<string, number>();
  for (const l of foodLogs) {
    if (l.deletedAt || !l.nutrients.kcal) continue;
    const t = Date.parse(l.at);
    if (t < from || t > now) continue;
    const k = dayKey(t, s);
    if (k === today) continue; // today isn't over
    byDay.set(k, (byDay.get(k) ?? 0) + l.nutrients.kcal);
  }
  const full = [...byDay.values()].filter((v) => v >= PARTIAL_DAY);
  const pts = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }))
    .filter((p) => p.t >= from && p.t <= now).sort((a, b) => a.t - b.t);
  if (full.length < 14 || pts.length < 6) return null;
  const fit = robustFit(pts, now);
  if (!fit) return null;
  const intake = full.reduce((a, b) => a + b, 0) / full.length;
  const burn = (slope: number) => Math.round((intake - slope * KCAL_PER_KG) / 10) * 10;
  // A steeper loss means more burned: the low end of the range comes from the shallower slope.
  return { kcal: burn(fit.slope), low: burn(fit.slopeHigh), high: burn(fit.slopeLow), intake: Math.round(intake), kgPerWeek: Math.round(fit.slope * 7 * 100) / 100,
    days: full.length, weighIns: pts.length, windowDays };
}

/** A day's calories for losing `kgPerWeek`: what's burned less the deficit, never more than a quarter below it and
 *  never under 1,200. */
export function calorieTarget(e: Pick<Expenditure, 'kcal'>, kgPerWeek: number): { kcal: number; capped: boolean } {
  const want = e.kcal - (kgPerWeek * KCAL_PER_KG) / 7;
  const floor = Math.max(1200, e.kcal * 0.75);
  const kcal = Math.round(Math.max(want, floor) / 10) * 10;
  return { kcal, capped: want < floor };
}

/** Protein to keep muscle while losing: about 1.6 g a day for each kg of the weight being aimed for (the goal, when
 *  it's lower than now), to the nearest 5 g. */
export function proteinTarget(weightKg: number | undefined, goalKg?: number): number | undefined {
  if (!weightKg || weightKg <= 0) return undefined;
  const ref = goalKg && goalKg > 0 && goalKg < weightKg ? goalKg : weightKg;
  return Math.round((1.6 * ref) / 5) * 5;
}

export interface LeanAlert { share: number; weightLost: number; leanLost: number; from: number; to: number }

/** More than about a third of the weight lost has been lean mass (from body-composition readings). */
export function leanAlert(body: BodyEntry[], now: number): LeanAlert | null {
  const w = muscleWatch(body, undefined, [], now).overall;
  return w && w.share > 0.35 ? { share: w.share, weightLost: w.weightLost, leanLost: w.leanLost, from: w.from, to: w.to } : null;
}

/** The latest weight (kg), for working out targets. */
export const latestWeight = (body: BodyEntry[]) =>
  [...body].filter((b) => !b.deletedAt && typeof b.weightKg === 'number').sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg;
