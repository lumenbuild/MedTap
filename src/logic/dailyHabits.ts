// Trends, Daily habits: one series per day for each habit the person has records of (food energy, protein, water,
// caffeine, steps, sleep, resting heart rate, HRV, readiness), with the average, days at their own target (or, for
// caffeine, under their own limit) and the average over the same length of time before. Pure.
import type { CheckIn, DailyHealth, FoodLog } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { readinessTrend } from './fitnessInsights';
import { dayKey, ymdToMs } from './stats';
import { intakesOf } from './caffeine';

const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export type HabitKey = 'energy' | 'protein' | 'water' | 'caffeine' | 'steps' | 'sleep' | 'restingHr' | 'hrv' | 'readiness';
export interface HabitSeries {
  key: HabitKey; label: string;
  days: { t: number; v: number }[];
  avg: number;
  /** The person's own daily number, and how many logged days reached it (under it for nothing: none of these are limits). */
  target?: number; onTarget?: number;
  /** Caffeine: the person's own daily limit, and how many logged days stayed at or under it. */
  limit?: number; underLimit?: number;
  /** Average over the same length of time just before the range. */
  prevAvg?: number;
}
export interface HabitInput { daily: DailyHealth[]; foodLogs: FoodLog[]; checkIns: CheckIn[] }
export interface HabitOptions {
  food: boolean; intake: boolean; readiness: boolean;
  targets: { energy?: number | null; protein?: number | null; water?: number | null; caffeineLimit?: number | null; steps?: number | null };
}

export const HABIT_LABEL: Record<HabitKey, string> = {
  energy: 'Food', protein: 'Protein', water: 'Water', caffeine: 'Caffeine', steps: 'Steps', sleep: 'Sleep', restingHr: 'Resting heart rate', hrv: 'HRV', readiness: 'Ready to train',
};

/** Each habit's value by day (keyed by the day's local noon, as ymdToMs gives it). */
function byDay(key: HabitKey, x: HabitInput, s: ScheduleSettings, from: number, to: number): Map<number, number> {
  const out = new Map<number, number>();
  if (key === 'energy') {
    for (const l of x.foodLogs.filter(live)) {
      const t = Date.parse(l.at);
      if (t < from || t > to || !l.nutrients.kcal) continue;
      const k = ymdToMs(dayKey(t, s));
      out.set(k, (out.get(k) ?? 0) + l.nutrients.kcal);
    }
    return out;
  }
  if (key === 'caffeine') {
    for (const c of intakesOf(x.checkIns, x.foodLogs)) {
      if (c.t < from || c.t > to) continue;
      const k = ymdToMs(dayKey(c.t, s));
      out.set(k, (out.get(k) ?? 0) + c.mg);
    }
    return out;
  }
  if (key === 'readiness') {
    for (const r of readinessTrend(x.daily, x.checkIns, from, to, s)) out.set(r.t, r.score);
    return out;
  }
  const field = ({ protein: 'proteinG', water: 'waterMl', steps: 'steps', sleep: 'sleepMin', restingHr: 'restingHr', hrv: 'hrvMs' } as const)[key];
  for (const d of x.daily.filter(live)) {
    const t = ymdToMs(d.date);
    if (t < from || t > to) continue; // noon of each day, so a day counts when it starts in the range
    const v = d[field];
    if (typeof v === 'number' && v > 0) out.set(t, key === 'sleep' ? v / 60 : v);
  }
  // Sleep from check-ins on nights there's no imported sleep.
  if (key === 'sleep') {
    for (const c of x.checkIns.filter((c) => live(c) && c.sleepHours)) {
      const t = Date.parse(c.at);
      if (t < from || t > to) continue;
      const k = ymdToMs(dayKey(t, s));
      if (!out.has(k)) out.set(k, c.sleepHours!);
    }
  }
  return out;
}

const ORDER: HabitKey[] = ['energy', 'protein', 'water', 'caffeine', 'steps', 'sleep', 'restingHr', 'hrv', 'readiness'];

/** The habits with 3+ days logged in the range, in a fixed order. */
export function dailyHabits(x: HabitInput, start: number, end: number, prevStart: number | null, s: ScheduleSettings, o: HabitOptions): HabitSeries[] {
  const keys = ORDER.filter((k) => (k === 'energy' ? o.food : k === 'protein' || k === 'water' ? o.intake : k === 'readiness' ? o.readiness : true));
  const out: HabitSeries[] = [];
  for (const key of keys) {
    const m = byDay(key, x, s, start, end);
    if (m.size < 3) continue;
    const days = [...m.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
    const vs = days.map((d) => d.v);
    const target = key === 'energy' ? o.targets.energy : key === 'protein' ? o.targets.protein : key === 'water' ? o.targets.water : key === 'steps' ? o.targets.steps : null;
    const prev = prevStart === null ? [] : [...byDay(key, x, s, prevStart, start - 1).values()];
    out.push({
      key, label: HABIT_LABEL[key], days, avg: mean(vs),
      ...(target ? { target, onTarget: vs.filter((v) => v >= target).length } : {}),
      ...(key === 'caffeine' && o.targets.caffeineLimit ? { limit: o.targets.caffeineLimit, underLimit: vs.filter((v) => v <= o.targets.caffeineLimit!).length } : {}),
      ...(prev.length >= 3 ? { prevAvg: mean(prev) } : {}),
    });
  }
  return out;
}
