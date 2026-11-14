// What moves this for you: for one result (sleep, resting heart rate, focus, the next morning's weigh-in, lean mass),
// the things done in a day that go with it being better or worse, from the person's own last 90 days. Each driver is
// the average with it against without, with how many days each side and how sure that is. Links in the person's data,
// not proof of cause. Pure.
import type { CheckIn, DailyHealth, Dose, FoodLog, Medication, Workout, BodyEntry } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';
import { fmtHM } from './sleep';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const variance = (xs: number[]) => { const m = mean(xs); return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1); };
const ymdMs = (k: string) => new Date(`${k}T12:00`).getTime();

export type Topic = 'sleep' | 'rhr' | 'focus' | 'weight' | 'hrv';
export interface DriverData { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; workouts: Workout[]; foodLogs: FoodLog[]; body: BodyEntry[]; proteinTarget?: number | null }
export interface Driver {
  key: string; label: string;
  /** Average with it and without, the difference (in the result's own unit) and its words ("+32 min"). */
  withIt: number; without: number; diff: number; text: string;
  nWith: number; nWithout: number;
  helps: boolean;
  sure: 'clear' | 'likely';
  /** The days (in the window) it happened. */
  on: string[];
}
export interface Drivers { topic: Topic; label: string; days: number; drivers: Driver[] }

const TOPIC: Record<Topic, { label: string; higherBetter: boolean; meaningful: number; fmt: (v: number) => string }> = {
  sleep: { label: 'Sleep', higherBetter: true, meaningful: 10, fmt: (v) => { const m = Math.abs(Math.round(v)); return `${v > 0 ? '+' : '−'}${m < 60 ? `${m} min` : fmtHM(m)}`; } },
  rhr: { label: 'Resting heart rate', higherBetter: false, meaningful: 1, fmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)} bpm` },
  hrv: { label: 'HRV', higherBetter: true, meaningful: 2, fmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} ms` },
  focus: { label: 'Focus', higherBetter: true, meaningful: 0.3, fmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)} of 5` },
  weight: { label: "Next morning's weight", higherBetter: false, meaningful: 0.15, fmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)} kg` },
};

interface FactorDef { key: string; label: string; on: Set<string>; /** Days it could have happened (the rest count as without). */ known?: Set<string> }

/** The things done each day: each medicine, caffeine after 2 pm, alcohol, a workout, a big step day, a late meal, a
 *  salty or a high-protein day, a short night before, mindfulness. */
function factorsOf(d: DriverData, s: ScheduleSettings, days: string[]): FactorDef[] {
  const out: FactorDef[] = [];
  const keyOf = (t: number) => dayKey(t, s);
  for (const m of d.meds.filter((x) => !x.archived && !x.peptide)) {
    const on = new Set(d.doses.filter((x) => x.medicationId === m.id && live(x) && !x.skipped).map((x) => keyOf(Date.parse(x.takenAt))));
    // Only days since it was added: before that, a day without a logged dose isn't a day without it.
    const tracked = new Set(days.filter((k) => !m.createdAt || k >= keyOf(Date.parse(m.createdAt))));
    const n = days.filter((k) => on.has(k)).length;
    if (n >= 5 && tracked.size - n >= 5) out.push({ key: `med-${m.id}`, label: `Taking ${m.nickname?.trim() || m.name}`, on, known: tracked });
  }
  const chip = (re: RegExp, after?: number) => new Set(d.checkIns.filter((c) => live(c) && c.chips.some((x) => re.test(x)) && (after === undefined || new Date(c.at).getHours() >= after)).map((c) => keyOf(Date.parse(c.at))));
  out.push({ key: 'late-caffeine', label: 'Caffeine after 2 pm', on: chip(/caffeine|coffee/i, 14) });
  out.push({ key: 'alcohol', label: 'Alcohol', on: chip(/alcohol/i) });
  out.push({ key: 'workout', label: 'A workout', on: new Set(d.workouts.filter(live).map((w) => keyOf(Date.parse(w.startedAt)))) });
  const steps = d.daily.filter(live).filter((x) => typeof x.steps === 'number' && x.steps > 500);
  if (steps.length >= 14) { const mid = median(steps.map((x) => x.steps!)); out.push({ key: 'steps', label: `Over ${Math.round(mid / 1000)}k steps`, on: new Set(steps.filter((x) => x.steps! > mid).map((x) => x.date)), known: new Set(steps.map((x) => x.date)) }); }
  // Food: only on days with food logged.
  const food = d.foodLogs.filter(live);
  const fed = new Set(food.map((l) => keyOf(Date.parse(l.at))));
  if (fed.size >= 10) {
    out.push({ key: 'late-meal', label: 'Eating after 8 pm', on: new Set(food.filter((l) => new Date(l.at).getHours() >= 20 && (l.nutrients.kcal ?? 0) >= 150).map((l) => keyOf(Date.parse(l.at)))), known: fed });
    const by = new Map<string, { na: number; p: number }>();
    for (const l of food) { const k = keyOf(Date.parse(l.at)); const x = by.get(k) ?? { na: 0, p: 0 }; x.na += l.nutrients.sodium ?? 0; x.p += l.nutrients.protein ?? 0; by.set(k, x); }
    out.push({ key: 'salty', label: 'A salty day (over 2,300 mg sodium)', on: new Set([...by].filter(([, x]) => x.na > 2300).map(([k]) => k)), known: fed });
    if (d.proteinTarget) out.push({ key: 'protein', label: 'Protein target met', on: new Set([...by].filter(([, x]) => x.p >= d.proteinTarget! * 0.9).map(([k]) => k)), known: fed });
  }
  // The night before (ending this morning) short: under the usual by an hour.
  const nights = d.daily.filter((x) => live(x) && (x.sleepMin ?? 0) > 60);
  if (nights.length >= 14) { const mid = median(nights.map((x) => x.sleepMin!)); out.push({ key: 'short-night', label: 'A short night before', on: new Set(nights.filter((x) => x.sleepMin! < mid - 60).map((x) => x.date)), known: new Set(nights.map((x) => x.date)) }); }
  out.push({ key: 'mindful', label: 'Mindfulness', on: new Set(d.daily.filter((x) => live(x) && (x.mindfulMin ?? 0) > 0).map((x) => x.date)) });
  return out;
}

/** What goes with a better or worse result, for one topic. */
/** Things to have less of, and more of. A link in the other direction (late caffeine going with longer sleep, more
 *  steps with worse focus) is almost always something else happening on the same days, and would contradict what the
 *  rest of the app says about them (the caffeine cut-off, the levers), so it isn't shown. */
export const LESS = new Set(['late-caffeine', 'alcohol', 'late-meal', 'salty']);
export const MORE = new Set(['steps', 'workout', 'mindful', 'protein']);

export function driversFor(topic: Topic, d: DriverData, now: number, s: ScheduleSettings, days = 90): Drivers {
  const keys: string[] = [];
  for (let t = now - days * DAY; t < now - DAY / 2; t += DAY) keys.push(dayKey(t, s));
  const next = (k: string) => dayKey(ymdMs(k) + DAY, s);
  const dailyBy = new Map(d.daily.filter(live).map((x) => [x.date, x]));
  let get: (k: string) => number | undefined;
  if (topic === 'sleep') get = (k) => { const v = dailyBy.get(next(k))?.sleepMin; return v && v > 60 ? v : undefined; };
  else if (topic === 'rhr') get = (k) => dailyBy.get(next(k))?.restingHr;
  else if (topic === 'hrv') get = (k) => dailyBy.get(next(k))?.hrvMs;
  else if (topic === 'focus') {
    const by = new Map<string, number[]>();
    for (const c of d.checkIns) if (live(c) && typeof c.focus === 'number') { const k = dayKey(Date.parse(c.at), s); by.set(k, [...(by.get(k) ?? []), c.focus]); }
    get = (k) => (by.has(k) ? mean(by.get(k)!) : undefined);
  } else {
    const w = new Map(d.body.filter((b) => live(b) && typeof b.weightKg === 'number').map((b) => [b.date, b.weightKg!]));
    get = (k) => { const a = w.get(k), b = w.get(next(k)); return a !== undefined && b !== undefined ? b - a : undefined; };
  }
  const T = TOPIC[topic];
  const found: (Driver & { z: number })[] = [];
  let measured = 0;
  for (const k of keys) if (get(k) !== undefined) measured++;
  for (const f of factorsOf(d, s, keys)) {
    // A short night before is already in last night's sleep; a workout lowers that night's HRV by design.
    if (topic === 'sleep' && f.key === 'short-night') continue;
    if (topic === 'hrv' && f.key === 'workout') continue;
    const a: number[] = [], b: number[] = [];
    for (const k of keys) {
      if (f.known && !f.known.has(k)) continue;
      const v = get(k); if (v === undefined) continue;
      (f.on.has(k) ? b : a).push(v);
    }
    if (a.length < 5 || b.length < 4) continue;
    const diff = mean(b) - mean(a);
    if (Math.abs(diff) < T.meaningful) continue;
    const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
    const z = se > 0 ? Math.abs(diff / se) : 0;
    if (z < 1.3) continue;
    const helps = T.higherBetter ? diff > 0 : diff < 0;
    if ((LESS.has(f.key) && helps) || (MORE.has(f.key) && !helps)) continue;
    found.push({ key: f.key, label: f.label, withIt: mean(b), without: mean(a), diff, text: T.fmt(diff), nWith: b.length, nWithout: a.length, helps, sure: z >= 2 ? 'clear' : 'likely', on: keys.filter((k) => f.on.has(k)), z });
  }
  found.sort((x, y) => y.z * Math.abs(y.diff) - x.z * Math.abs(x.diff));
  return { topic, label: T.label, days: measured, drivers: found.slice(0, 6).map(({ z: _z, ...x }) => x) };
}
