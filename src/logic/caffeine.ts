// Caffeine: how much, when, and how much is likely still in the body. Each drink is a check-in with the Caffeine chip
// and its mg (older ones without an amount count as a usual cup). The level uses a standard one-compartment model:
// absorbed over the first hour or so (peak about 50 minutes after), then halving every few hours (about 5 on average;
// it varies a lot between people). Estimates, not measurements. Pure.
import type { CheckIn, DailyHealth, FoodLog } from '../db/schema';
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

// ── Finding your own cut-off and limit ─────────────────────────────────────────────────────────────

/** How long a caffeine check runs. */
export const CHECK_DAYS = 14;

/** Check-in chips that count as feeling on edge (for the limit). */
export const EDGY = ['Jittery', 'Irritable', 'Anxious', 'Heart racing', 'Restless'];

export interface CaffeineDay {
  day: string; total: number;
  /** Clock time of the day's last drink, in hours (after midnight runs on past 24), if any. */
  last?: number;
  atBed: number;
  /** That night's sleep: hours (imported, else the next morning's check-in) and quality (1–5, from a check-in). */
  hours?: number; quality?: number;
  /** Whether any check-in that day noted feeling on edge, and whether there was a check-in at all to say. */
  edgy: boolean; checked: boolean;
}

/** Each of the last `days` days (not today): what was had and when, the night's sleep and how the day felt. */
export function caffeineDays(intakes: Intake[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings,
  bedtime: string, halfLifeH = 5, days = 60): CaffeineDay[] {
  const out: CaffeineDay[] = [];
  const cis = checkIns.filter((c) => live(c) && !isDrink(c));
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  for (let n = 1; n <= days; n++) {
    const { start, end } = getDayBounds(today - n * 24 * HOUR + HOUR, s.dayStartsAt, s.tz);
    const day = ymd(start + 12 * HOUR, s);
    const mine = intakes.filter((x) => x.t >= start && x.t < end);
    const bed = timeInDay(start, bedtime, s);
    const lastT = mine.at(-1)?.t;
    const wake = ymd(end + 4 * HOUR, s);
    const row = daily.find((d) => live(d) && d.date === wake && d.sleepMin);
    const morning = cis.filter((c) => { const t = Date.parse(c.at); return t >= end - 2 * HOUR && t < end + 10 * HOUR && (c.sleepHours !== undefined || c.sleepQuality !== undefined); })[0];
    const that = cis.filter((c) => { const t = Date.parse(c.at); return t >= start && t < end; });
    out.push({
      day, total: mine.reduce((a, x) => a + x.mg, 0),
      ...(lastT !== undefined ? { last: (lastT - start) / HOUR + hhmm(s.dayStartsAt) } : {}),
      atBed: Math.round(level(intakes, bed, halfLifeH)),
      hours: row ? row.sleepMin! / 60 : morning?.sleepHours, quality: morning?.sleepQuality,
      edgy: that.some((c) => c.chips.some((x) => EDGY.includes(x))), checked: that.length > 0,
    });
  }
  return out.reverse();
}

const hhmm = (v: string) => { const [h, m] = v.split(':').map(Number); return h + m / 60; };
const ymd = (t: number, s: ScheduleSettings) => new Intl.DateTimeFormat('en-CA', { timeZone: s.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export interface FinderBand { label: string; from: number; to: number; nights: number; hours?: number; quality?: number; edgyPct?: number; worse: boolean }
export interface Finding {
  bands: FinderBand[];
  /** found: the bands show where it starts to matter; clear: no difference up to the latest or most you've had;
   *  more: not enough to tell yet. */
  status: 'found' | 'clear' | 'more';
  /** The cut-off (clock hour) or limit (mg) found, or for 'clear' the latest or most tried so far. */
  value?: number;
  nights: number;
}

const sleepOf = (xs: CaffeineDay[]) => ({ hours: avg(xs.flatMap((x) => (x.hours !== undefined ? [x.hours] : []))), quality: avg(xs.flatMap((x) => (x.quality !== undefined ? [x.quality] : []))) });
const slept = (x: CaffeineDay) => x.hours !== undefined || x.quality !== undefined;
/** Clearly worse sleep than the baseline: 25+ minutes less, or half a point lower on quality. */
const worseSleep = (b: { hours?: number; quality?: number }, base: { hours?: number; quality?: number }) =>
  (b.hours !== undefined && base.hours !== undefined && base.hours - b.hours >= 0.4) || (b.quality !== undefined && base.quality !== undefined && base.quality - b.quality >= 0.5);

/** The earliest band (with 3+ nights) that's worse, when every later band with enough is worse too. */
function firstWorse(bands: FinderBand[]): FinderBand | undefined {
  const known = bands.filter((b) => b.nights >= 3);
  const i = known.findIndex((b, j) => b.worse && known.slice(j).every((x) => x.worse));
  return i >= 0 ? known[i] : undefined;
}

/** Your cut-off: sleep by the time of the day's last drink, against days with none or only before noon. */
export function findCutoff(days: CaffeineDay[]): Finding {
  const withSleep = days.filter(slept);
  const defs = [{ label: 'None, or before 12 pm', from: 0, to: 12 }, { label: '12 to 2 pm', from: 12, to: 14 }, { label: '2 to 4 pm', from: 14, to: 16 },
    { label: '4 to 6 pm', from: 16, to: 18 }, { label: 'After 6 pm', from: 18, to: 30 }];
  const inBand = (x: CaffeineDay, d: { from: number; to: number }) => (x.last === undefined ? d.from === 0 : x.last >= d.from && x.last < d.to);
  const base = sleepOf(withSleep.filter((x) => inBand(x, defs[0])));
  const bands = defs.map((d, i) => {
    const xs = withSleep.filter((x) => inBand(x, d));
    const sl = sleepOf(xs);
    return { ...d, nights: xs.length, ...sl, worse: i > 0 && xs.length >= 3 && worseSleep(sl, base) };
  });
  const known = bands.filter((b) => b.nights >= 3);
  if (withSleep.length < 10 || bands[0].nights < 3 || known.length < 2) return { bands, status: 'more', nights: withSleep.length };
  const w = firstWorse(bands);
  if (w) return { bands, status: 'found', value: w.from, nights: withSleep.length };
  return { bands, status: 'clear', value: known.at(-1)!.to, nights: withSleep.length };
}

/** Your limit: how often you felt on edge, and sleep on nights with little left at bedtime (so timing doesn't muddle
 *  it), by the day's total, against your lightest days. */
export function findLimit(days: CaffeineDay[]): Finding {
  const defs = [{ label: 'Under 100 mg', from: 0, to: 100 }, { label: '100 to 199 mg', from: 100, to: 200 }, { label: '200 to 299 mg', from: 200, to: 300 },
    { label: '300 to 399 mg', from: 300, to: 400 }, { label: '400 mg or more', from: 400, to: 10_000 }];
  const useful = days.filter((x) => x.checked || (slept(x) && x.atBed < LOW_MG));
  const pct = (xs: CaffeineDay[]) => { const c = xs.filter((x) => x.checked); return c.length >= 3 ? Math.round((c.filter((x) => x.edgy).length / c.length) * 100) : undefined; };
  const raw = defs.map((d) => {
    const xs = useful.filter((x) => x.total >= d.from && x.total < d.to);
    return { ...d, nights: xs.length, ...sleepOf(xs.filter((x) => slept(x) && x.atBed < LOW_MG)), edgyPct: pct(xs), xs };
  });
  const baseBand = raw.find((b) => b.nights >= 3);
  if (useful.length < 10 || !baseBand) return { bands: raw.map(({ xs: _xs, ...b }) => ({ ...b, worse: false })), status: 'more', nights: useful.length };
  const bands = raw.map(({ xs: _xs, ...b }) => ({
    ...b,
    worse: b !== baseBand && b.from > baseBand.from && b.nights >= 3
      && ((b.edgyPct !== undefined && baseBand.edgyPct !== undefined && b.edgyPct - baseBand.edgyPct >= 25) || worseSleep(b, baseBand)),
  }));
  const known = bands.filter((b) => b.nights >= 3);
  if (known.length < 2) return { bands, status: 'more', nights: useful.length };
  const w = firstWorse(bands);
  if (w) return { bands, status: 'found', value: w.from, nights: useful.length };
  return { bands, status: 'clear', value: Math.max(...useful.map((x) => x.total)), nights: useful.length };
}
