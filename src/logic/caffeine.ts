// Caffeine: how much, when, and how much is likely still in the body. Each drink is a check-in with the Caffeine chip
// and its mg (older ones without an amount count as a usual cup). The level uses a standard one-compartment model:
// absorbed over the first hour or so (peak about 50 minutes after), then halving every few hours (about 5 on average;
// it varies a lot between people). Estimates, not measurements. Pure.
import type { CheckIn, FoodLog } from '../db/schema';
import { getDayBounds, timeInDay, type ScheduleSettings } from './schedule';

export const CAFFEINE = 'Caffeine';
const HOUR = 3_600_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

/** What a caffeine check-in without an amount (from before amounts, or a widget tap) counts as. */
export const UNKNOWN_MG = 95;
/** The "low by bedtime" line shown on Today and used to sort nights in Trends. */
export const LOW_MG = 50;
/** Half-life choices in Settings (hours). */
export const HALF_LIVES = [{ h: 3, label: 'Faster (about 3 hours)' }, { h: 5, label: 'Usual (about 5 hours)' }, { h: 8, label: 'Slower (about 8 hours)' }];

export interface Drink { name: string; mg: number; group: 'Coffee' | 'Tea' | 'Energy and soft drinks' | 'Other' }

/** Typical amounts, rounded. Café coffee varies widely by beans and shop, so the amount can be changed when logging. */
export const DRINKS: Drink[] = [
  { name: 'Espresso, 1 shot', mg: 80, group: 'Coffee' },
  { name: 'Flat white or latte, 1 shot', mg: 80, group: 'Coffee' },
  { name: 'Flat white or latte, 2 shots', mg: 160, group: 'Coffee' },
  { name: 'Instant coffee', mg: 70, group: 'Coffee' },
  { name: 'Filter or plunger coffee', mg: 120, group: 'Coffee' },
  { name: 'Cold brew', mg: 150, group: 'Coffee' },
  { name: 'Coffee pod', mg: 70, group: 'Coffee' },
  { name: 'Decaf', mg: 5, group: 'Coffee' },
  { name: 'Black tea', mg: 45, group: 'Tea' },
  { name: 'Green tea', mg: 30, group: 'Tea' },
  { name: 'Matcha', mg: 70, group: 'Tea' },
  { name: 'Chai latte', mg: 40, group: 'Tea' },
  { name: 'Energy drink, 250 mL', mg: 80, group: 'Energy and soft drinks' },
  { name: 'Energy drink, 500 mL', mg: 160, group: 'Energy and soft drinks' },
  { name: 'Cola, 375 mL can', mg: 40, group: 'Energy and soft drinks' },
  { name: 'Pre-workout, 1 scoop', mg: 200, group: 'Other' },
  { name: 'Caffeine tablet', mg: 100, group: 'Other' },
  { name: 'Dark chocolate, 50 g', mg: 40, group: 'Other' },
];

/** A check-in that is just a caffeine drink (logged on its own, not ticked in a fuller check-in). */
export const isDrink = (c: CheckIn) => c.chips.includes(CAFFEINE) && c.chips.length === 1 && c.mood === undefined && c.energy === undefined
  && c.focus === undefined && c.sleepHours === undefined && c.sleepQuality === undefined && c.appetite === undefined;

export interface Intake { id: string; t: number; mg: number; name?: string; personId?: string }

/** The caffeine drinks in check-ins. A drink logged from Food before amounts were kept takes its amount from the food. */
export function intakesOf(checkIns: CheckIn[], foodLogs: FoodLog[] = []): Intake[] {
  const fromFood = new Map(foodLogs.filter((l) => live(l) && l.caffeineCheckInId).map((l) => [l.caffeineCheckInId!, l.nutrients.caffeine]));
  return checkIns.filter((c) => live(c) && c.chips.includes(CAFFEINE))
    .map((c) => ({ id: c.id, t: Date.parse(c.at), mg: c.caffeineMg ?? fromFood.get(c.id) ?? UNKNOWN_MG, name: c.note, personId: c.personId }))
    .sort((a, b) => a.t - b.t);
}

const KA = Math.LN2 / (10 / 60); // absorption half-life about 10 minutes, per hour: the peak comes about 50 minutes after

/** Estimated mg in the body at time t from the intakes before it. */
export function level(intakes: Intake[], t: number, halfLifeH = 5): number {
  const ke = Math.LN2 / halfLifeH;
  let sum = 0;
  for (const x of intakes) {
    const h = (t - x.t) / HOUR;
    if (h <= 0) continue;
    sum += x.mg * (KA / (KA - ke)) * (Math.exp(-ke * h) - Math.exp(-KA * h));
  }
  return sum;
}

/** The level every `stepMin` minutes from `from` to `to`. */
export function curve(intakes: Intake[], from: number, to: number, halfLifeH = 5, stepMin = 10): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (let t = from; t <= to; t += stepMin * 60_000) out.push({ t, v: level(intakes, t, halfLifeH) });
  return out;
}

/** When the level next falls under `mg` (after the last drink has peaked), or null if it already is and will stay so. */
export function lowBy(intakes: Intake[], now: number, halfLifeH = 5, mg = LOW_MG): number | null {
  const last = intakes.filter((x) => x.t <= now).at(-1);
  if (!last) return null;
  const from = Math.max(now, last.t + HOUR);
  if (level(intakes, from, halfLifeH) < mg && level(intakes, now, halfLifeH) < mg) return null;
  for (let t = from; t < from + 72 * HOUR; t += 5 * 60_000) if (level(intakes, t, halfLifeH) < mg) return t;
  return null;
}

/** The bedtime that ends the day `now` is in (a bedtime after midnight falls on the next calendar date). */
export function bedtimeOf(now: number, bedtime: string, s: ScheduleSettings): number {
  return timeInDay(getDayBounds(now, s.dayStartsAt, s.tz).start, bedtime, s);
}

/** mg in the day `now` is in. */
export function dayTotal(intakes: Intake[], now: number, s: ScheduleSettings): number {
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  return intakes.filter((x) => x.t >= start && x.t < end).reduce((a, x) => a + x.mg, 0);
}

/** The drinks the person has most often (name and amount), most used first, then most recent: their usual ones. */
export function usualDrinks(intakes: Intake[], now: number, n = 4): { name: string; mg: number }[] {
  const by = new Map<string, { name: string; mg: number; count: number; last: number }>();
  for (const x of intakes) {
    if (!x.name || x.t < now - 90 * 24 * HOUR) continue;
    const k = `${x.name}|${x.mg}`;
    const e = by.get(k) ?? { name: x.name, mg: x.mg, count: 0, last: 0 };
    e.count++; e.last = Math.max(e.last, x.t);
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, n).map(({ name, mg }) => ({ name, mg }));
}

export interface CaffeineNight { day: string; bedtime: number; atBed: number; total: number }

/** Each day with caffeine or a sleep record: the day's total and the estimated level at that night's bedtime. */
export function nights(intakes: Intake[], days: string[], bedtime: string, s: ScheduleSettings, halfLifeH = 5): CaffeineNight[] {
  return days.map((day) => {
    const start = getDayBounds(Date.parse(`${day}T12:00`), s.dayStartsAt, s.tz).start;
    const bed = timeInDay(start, bedtime, s);
    const total = intakes.filter((x) => x.t >= start && x.t < bed).reduce((a, x) => a + x.mg, 0);
    return { day, bedtime: bed, atBed: Math.round(level(intakes, bed, halfLifeH)), total };
  });
}
