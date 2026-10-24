// More patterns from the person's own records (both apps): a stock recount against the logs, days off a medicine
// against days on, caffeine and alcohol against sleep, steps against weight,
// and heart rate after a dose. Pure; each result says how much it rests on. Links, not causes.
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Vital } from '../db/schema';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey, ymdToMs } from './stats';
import { occurrences } from './habits';
import { stockUnitsFor } from './stock';
import { EFFECT_CHIPS } from './predict';
import { robustFit, seriesOf } from './forecast';
import { CAFFEINE, LOW_MG, intakesOf, nights } from './caffeine';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const r = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const avg = (xs: number[]) => (xs.length ? r(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);
const nums = <T>(xs: T[], f: (x: T) => number | undefined) => xs.map(f).filter((v): v is number => typeof v === 'number');
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const effect = (c: CheckIn) => c.chips.some((x) => EFFECT_CHIPS.includes(x));

// ── Stock recount ───────────────────────────────────────────────────────────────────────────────────

export interface CountCheck {
  expected: number; counted: number;
  /** Expected − counted, in stock units: more than 0 means fewer on hand than the logs say. */
  diff: number;
  /** About how many usual doses that is. */
  doses: number;
  /** Set times since the last count with nothing logged: the likely unlogged doses. */
  unlogged: { t: number; amount: number }[];
}

/** A recount against what the logs say should be left (since the stock was last set). */
export function countCheck(med: Medication, doses: Dose[], counted: number, now: number, s: ScheduleSettings): CountCheck | null {
  if (med.stockCount === undefined) return null;
  const expected = med.stockCount;
  const diff = r(expected - counted, 3);
  const per = stockUnitsFor(med, med.defaultAmount) || 1;
  const since = med.stockBase ? Date.parse(med.stockBase.at) : now - 30 * DAY;
  const days = Math.max(1, Math.ceil((now - since) / DAY));
  const unlogged = diff > 0
    ? occurrences(med, doses, now, s, Math.min(days, 90)).filter((o) => o.t >= since && !o.dose && !o.skipped).map((o) => ({ t: o.t, amount: med.defaultAmount }))
    : [];
  return { expected, counted, diff, doses: r(diff / per, 1), unlogged };
}

// ── Days on and off ─────────────────────────────────────────────────────────────────────────────────

export interface Side { days: number; focus?: number; mood?: number; appetite?: number; energy?: number; sleepHours?: number; sleepQuality?: number }
export interface OnOff { med: Medication; on: Side; off: Side }

/** Check-ins on days a medicine was taken against days it wasn't (planned breaks, weekends off, skipped days), since
 *  it was first taken. Sleep is the next morning's. Needs 4+ days each way with check-ins. */
export function onOffDays(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings, days = 90): OnOff | null {
  const mine = doses.filter((d) => d.medicationId === med.id && live(d) && !d.skipped);
  if (mine.length < 4) return null;
  const first = Math.max(Math.min(...mine.map((d) => Date.parse(d.takenAt))), now - days * DAY);
  const dosed = new Set(mine.map((d) => dayKey(Date.parse(d.takenAt), s)));
  const today = dayKey(now, s);
  const byDay = new Map<string, CheckIn[]>();
  for (const c of checkIns.filter(live)) {
    const t = Date.parse(c.at);
    if (t < first || t > now) continue;
    const k = dayKey(t, s);
    if (k === today) continue;
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  const nextMorning = (k: string) => {
    const end = getDayBounds(ymdToMs(k), s.dayStartsAt, s.tz).end;
    return checkIns.filter((c) => live(c) && Date.parse(c.at) >= end && Date.parse(c.at) < end + 10 * HOUR && (typeof c.sleepHours === 'number' || typeof c.sleepQuality === 'number'));
  };
  const side = (keys: string[]): Side => {
    const cis = keys.flatMap((k) => byDay.get(k) ?? []);
    const sleep = keys.flatMap(nextMorning);
    return {
      days: keys.length,
      focus: avg(nums(cis, (c) => c.focus)), mood: avg(nums(cis, (c) => c.mood)), appetite: avg(nums(cis, (c) => c.appetite)), energy: avg(nums(cis, (c) => c.energy)),
      sleepHours: avg(nums(sleep, (c) => c.sleepHours)), sleepQuality: avg(nums(sleep, (c) => c.sleepQuality)),
    };
  };
  const keys = [...byDay.keys()];
  const on = keys.filter((k) => dosed.has(k)), off = keys.filter((k) => !dosed.has(k));
  if (on.length < 4 || off.length < 4) return null;
  return { med, on: side(on), off: side(off) };
}

// ── Caffeine and alcohol ────────────────────────────────────────────────────────────────────────────

export { CAFFEINE };
export const ALCOHOL = 'Alcohol';
export interface SubstanceFinding { what: 'late-caffeine' | 'alcohol'; title: string; with: Side & { effectPct?: number }; without: Side & { effectPct?: number } }

/** Nights with caffeine likely still in the body at bedtime (50 mg or more, from what was had and when), and after
 *  alcohol, against the others: the next morning's sleep, and (alcohol) side effects the next day. Needs 3+ nights each
 *  way; only clear differences (0.5+ on sleep or 20+ points). */
export function substanceFindings(checkIns: CheckIn[], now: number, s: ScheduleSettings, days = 90,
  caffeine: { bedtime: string; halfLifeH: number; foodLogs?: FoodLog[] } = { bedtime: '22:30', halfLifeH: 5 }): SubstanceFinding[] {
  const cis = checkIns.filter((c) => live(c) && Date.parse(c.at) > now - days * DAY && Date.parse(c.at) <= now);
  const dayOf = new Map<string, CheckIn[]>();
  for (const c of cis) { const k = dayKey(Date.parse(c.at), s); dayOf.set(k, [...(dayOf.get(k) ?? []), c]); }
  const nextDay = (k: string) => {
    const end = getDayBounds(ymdToMs(k), s.dayStartsAt, s.tz).end;
    return cis.filter((c) => Date.parse(c.at) >= end && Date.parse(c.at) < getDayBounds(end, s.dayStartsAt, s.tz).end);
  };
  const morning = (k: string) => nextDay(k).filter((c) => Date.parse(c.at) < getDayBounds(ymdToMs(k), s.dayStartsAt, s.tz).end + 10 * HOUR);
  const side = (keys: string[]) => {
    const sl = keys.flatMap(morning);
    const nd = keys.flatMap(nextDay);
    return { days: keys.length, sleepHours: avg(nums(sl, (c) => c.sleepHours)), sleepQuality: avg(nums(sl, (c) => c.sleepQuality)), effectPct: nd.length ? Math.round((nd.filter(effect).length / nd.length) * 100) : undefined };
  };
  const keys = [...dayOf.keys()].filter((k) => k !== dayKey(now, s) && nextDay(k).length);
  const out: SubstanceFinding[] = [];
  const consider = (what: SubstanceFinding['what'], title: string, has: (k: string) => boolean) => {
    const a = keys.filter(has), b = keys.filter((k) => !has(k));
    if (a.length < 3 || b.length < 3) return;
    const w = side(a), wo = side(b);
    const d = (x?: number, y?: number) => (x !== undefined && y !== undefined ? Math.abs(x - y) : 0);
    if (d(w.sleepHours, wo.sleepHours) >= 0.5 || d(w.sleepQuality, wo.sleepQuality) >= 0.5 || (what === 'alcohol' && d(w.effectPct, wo.effectPct) >= 20)) out.push({ what, title, with: w, without: wo });
  };
  const atBed = new Map(nights(intakesOf(checkIns, caffeine.foodLogs), keys, caffeine.bedtime, s, caffeine.halfLifeH).map((n) => [n.day, n.atBed]));
  consider('late-caffeine', `Caffeine at bedtime (${LOW_MG} mg or more still in you)`, (k) => (atBed.get(k) ?? 0) >= LOW_MG);
  consider('alcohol', 'Alcohol', (k) => (dayOf.get(k) ?? []).some((c) => c.chips.includes(ALCOHOL)));
  return out;
}

// ── Steps and weight ────────────────────────────────────────────────────────────────────────────────

export interface StepsWeight { busier: { weeks: number; steps: number; perWeek: number }; quieter: { weeks: number; steps: number; perWeek: number } }

/** Weeks with more steps against weeks with fewer (split at the median), on weight change per week. Needs 6+ weeks
 *  with 4+ days of steps and 2+ weigh-ins. */
export function stepsVsWeight(daily: DailyHealth[], body: BodyEntry[], now: number): StepsWeight | null {
  const pts = seriesOf(body, 'weightKg');
  const weeks: { steps: number; perWeek: number }[] = [];
  for (let w = 1; w <= 26; w++) {
    const to = now - (w - 1) * 7 * DAY, from = to - 7 * DAY;
    const st = daily.filter((d) => live(d) && typeof d.steps === 'number' && ymdToMs(d.date) >= from && ymdToMs(d.date) < to).map((d) => d.steps!);
    const ws = pts.filter((p) => p.t >= from - DAY && p.t <= to + DAY);
    if (st.length < 4 || ws.length < 2 || ws[ws.length - 1].t - ws[0].t < 4 * DAY) continue;
    const f = robustFit(ws, to);
    if (!f) continue;
    weeks.push({ steps: Math.round(st.reduce((a, b) => a + b, 0) / st.length), perWeek: f.slope * 7 });
  }
  if (weeks.length < 6) return null;
  const sorted = [...weeks].sort((a, b) => a.steps - b.steps);
  const half = Math.floor(sorted.length / 2);
  const lo = sorted.slice(0, half), hi = sorted.slice(sorted.length - half);
  const sum = (xs: typeof weeks) => ({ weeks: xs.length, steps: Math.round(xs.reduce((a, b) => a + b.steps, 0) / xs.length), perWeek: r(xs.reduce((a, b) => a + b.perWeek, 0) / xs.length, 2) });
  return { busier: sum(hi), quieter: sum(lo) };
}

// ── Heart rate after a dose ─────────────────────────────────────────────────────────────────────────

export interface HeartAfter { byHour: { h: number; bpm?: number; n: number }[]; baseline?: number; peak?: { h: number; bpm: number }; weekly: { weekStart: number; bpm: number }[]; doses: number }

/** Heart rate in the hours after a dose (from imported hourly heart rate and logged readings), against the same hours
 *  on days without a dose; and the 1–6 hour average by week. */
export function heartAfterDose(med: Medication, doses: Dose[], daily: DailyHealth[], vitals: Vital[], now: number, s: ScheduleSettings): HeartAfter | null {
  const samples: { t: number; bpm: number }[] = [];
  for (const d of daily.filter(live)) {
    if (!d.hrByHour) continue;
    const start = new Date(`${d.date}T00:00`).getTime();
    d.hrByHour.forEach((b, h) => { if (typeof b === 'number') samples.push({ t: start + (h + 0.5) * HOUR, bpm: b }); });
  }
  for (const v of vitals.filter(live)) if (typeof v.heartRate === 'number') samples.push({ t: Date.parse(v.at), bpm: v.heartRate });
  if (samples.length < 20) return null;
  const mine = doses.filter((d) => d.medicationId === med.id && live(d) && !d.skipped && Date.parse(d.takenAt) > now - 90 * DAY).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  if (mine.length < 3) return null;
  const buckets = Array.from({ length: 10 }, () => [] as number[]);
  const used = new Set<number>();
  const dosedDays = new Set(mine.map((t) => dayKey(t, s)));
  const off: number[] = [];
  for (const x of samples) {
    const before = mine.filter((t) => t <= x.t).pop();
    const h = before !== undefined ? (x.t - before) / HOUR : Infinity;
    if (h < 9) { buckets[Math.floor(h) + 1].push(x.bpm); used.add(before!); continue; }
    const pre = mine.find((t) => t > x.t && t - x.t <= HOUR);
    if (pre !== undefined) { buckets[0].push(x.bpm); continue; }
    if (!dosedDays.has(dayKey(x.t, s))) off.push(x.bpm);
  }
  const byHour = buckets.map((b, i) => ({ h: i - 1, bpm: b.length ? Math.round(b.reduce((a, c) => a + c, 0) / b.length) : undefined, n: b.length }));
  const known = byHour.filter((x) => x.h >= 0 && x.bpm !== undefined && x.n >= 2);
  if (known.length < 3) return null;
  const peak = known.reduce((a, b) => (b.bpm! > a.bpm! ? b : a));
  const weekly: HeartAfter['weekly'] = [];
  for (let w = 7; w >= 0; w--) {
    const to = now - w * 7 * DAY, from = to - 7 * DAY;
    const xs = samples.filter((x) => x.t >= from && x.t < to && mine.some((t) => x.t - t >= HOUR && x.t - t <= 6 * HOUR)).map((x) => x.bpm);
    if (xs.length >= 3) weekly.push({ weekStart: from, bpm: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) });
  }
  return { byHour, baseline: off.length >= 5 ? Math.round(off.reduce((a, b) => a + b, 0) / off.length) : (byHour[0].bpm ?? undefined), peak: { h: peak.h, bpm: peak.bpm! }, weekly, doses: used.size };
}
