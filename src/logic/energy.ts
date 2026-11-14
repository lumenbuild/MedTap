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

// ── Energy balance with the watch ──────────────────────────────────────────────────────────────────────

export interface EnergyDay { date: string; burned?: number; eaten?: number; from?: 'app' | 'other app' }
export interface EnergyBalance {
  days: EnergyDay[];
  /** Over complete days with both burned and eaten (the last 14): the averages and the difference (− = deficit). */
  avgBurned?: number; avgEaten?: number; avgBalance?: number; balanceDays: number;
  /** What the watch says is burned on an average day (all days with it, last 28). */
  watchMaintenance?: number;
  /** What that balance means for weight in 4 weeks (kg, − = losing), if it holds. */
  kgIn4Weeks?: number;
  /** Today so far. */
  today: EnergyDay;
}

/** Calories burned (the watch, via Health Connect) against calories eaten: this app's food log, or another app's on
 *  days with none logged here. Only fully logged days (800+ kcal) count towards the balance; today isn't over. */
export function energyBalance(daily: { date: string; kcalTotal?: number; foodOtherKcal?: number; deletedAt?: string }[], foodLogs: FoodLog[], now: number, s: ScheduleSettings): EnergyBalance | null {
  const todayK = dayKey(now, s);
  const eatenHere = new Map<string, number>();
  for (const l of foodLogs) {
    if (l.deletedAt || !l.nutrients.kcal) continue;
    const t = Date.parse(l.at);
    if (t > now || t < now - 29 * DAY) continue;
    const k = dayKey(t, s);
    eatenHere.set(k, (eatenHere.get(k) ?? 0) + l.nutrients.kcal);
  }
  const rows = new Map(daily.filter((d) => !d.deletedAt).map((d) => [d.date, d]));
  const keys = [...new Set([...rows.keys(), ...eatenHere.keys()])].filter((k) => k <= todayK && new Date(`${k}T12:00`).getTime() > now - 29 * DAY).sort();
  const days: EnergyDay[] = keys.map((k) => {
    const here = eatenHere.get(k), other = rows.get(k)?.foodOtherKcal;
    return { date: k, burned: rows.get(k)?.kcalTotal, eaten: here !== undefined ? Math.round(here) : other, from: here !== undefined ? 'app' : other !== undefined ? 'other app' : undefined };
  });
  if (!days.some((d) => d.burned !== undefined)) return null;
  const done = days.filter((d) => d.date < todayK);
  const both = done.filter((d) => d.burned !== undefined && d.eaten !== undefined && d.eaten >= PARTIAL_DAY).slice(-14);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const burnedAll = done.filter((d) => d.burned !== undefined).map((d) => d.burned!);
  const out: EnergyBalance = { days: days.slice(-14), balanceDays: both.length, today: days.find((d) => d.date === todayK) ?? { date: todayK },
    watchMaintenance: burnedAll.length >= 7 ? Math.round(avg(burnedAll) / 10) * 10 : undefined };
  if (both.length >= 5) {
    out.avgBurned = avg(both.map((d) => d.burned!)); out.avgEaten = avg(both.map((d) => d.eaten!));
    out.avgBalance = out.avgEaten - out.avgBurned;
    out.kgIn4Weeks = Math.round(((out.avgBalance * 28) / KCAL_PER_KG) * 10) / 10;
  }
  return out;
}

/** What you burn on a usual day: one figure for the whole app (Food, Body, the calorie target). From food logs against
 *  the weight trend when there are enough (the most reliable), else the watch's average. */
export function usualBurn(foodLogs: FoodLog[], body: BodyEntry[], daily: Parameters<typeof energyBalance>[0], now: number, s: ScheduleSettings): { kcal: number; from: 'food and weight' | 'watch' } | null {
  const e = expenditure(foodLogs, body, now, s);
  if (e) return { kcal: e.kcal, from: 'food and weight' };
  const w = energyBalance(daily, foodLogs, now, s)?.watchMaintenance;
  return w ? { kcal: w, from: 'watch' } : null;
}

// ── A watch that reports only the resting burn ─────────────────────────────────────────────────────────
// Some watch and Health Connect set-ups write the same "total calories" every day (the resting burn alone): 2,007 on
// a 2,000-step day and on a 12,000-step day. Taken as the whole day, it puts what's eaten ~600 Cal too low and the
// weight's levelling-off point absurdly low. When the total doesn't move with the steps, the day's walking and the
// energy of digesting food are added to it, and the day is marked as estimated.

/** Calories a step costs, per kg of body weight (about 0.04 Cal a step at 80 kg). */
export const KCAL_PER_STEP_KG = 0.0005;

/** The watch's totals don't move with activity: 7+ days, under 40 Cal apart, while steps vary by 3,000+. */
export function burnIsRestingOnly(daily: { kcalTotal?: number; kcalActive?: number; steps?: number; deletedAt?: string }[]): boolean {
  const rows = daily.filter((d) => !d.deletedAt && typeof d.kcalTotal === 'number' && typeof d.steps === 'number').slice(-28);
  if (rows.length < 7 || rows.some((d) => (d.kcalActive ?? 0) > 50)) return false;
  const k = rows.map((d) => d.kcalTotal!), st = rows.map((d) => d.steps!);
  return Math.max(...k) - Math.min(...k) < 40 && Math.max(...st) - Math.min(...st) >= 3000;
}

/** The daily rows with a full day's burn where the watch gave only the resting one (kcalEstimated marks them). */
export function withFullBurn<T extends { date: string; kcalTotal?: number; kcalActive?: number; steps?: number; deletedAt?: string }>(daily: T[], weightKg: number | undefined): (T & { kcalEstimated?: boolean })[] {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (!weightKg || !burnIsRestingOnly(sorted)) return daily;
  return daily.map((d) => {
    if (typeof d.kcalTotal !== 'number') return d;
    const walking = (d.steps ?? 0) * KCAL_PER_STEP_KG * weightKg;
    const digesting = d.kcalTotal * 0.1;
    return { ...d, kcalTotal: Math.round((d.kcalTotal + walking + digesting) / 10) * 10, kcalEstimated: true };
  });
}
