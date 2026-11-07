// "Your week", day by day: for each day of the week reviewed, the doses taken against those planned, weight, sleep,
// steps and mood, with the week before's average of each to compare against. Pure; the person's day boundary (4 am by
// default) decides which day a dose or check-in belongs to.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { getDailyTarget, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';

export type WeekRowKey = 'doses' | 'weight' | 'sleep' | 'steps' | 'mood';
export interface WeekRow {
  key: WeekRowKey;
  /** One value per day of the week (null: nothing recorded). Doses: the share of planned doses taken, 0–1. */
  values: (number | null)[];
  /** Doses only: taken and planned for each day. */
  counts?: { taken: number; planned: number }[];
  /** This week's average of the days with records, and the week before's. */
  avg: number | null;
  prevAvg: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** 'YYYY-MM-DD' + n days, at local noon (safe across daylight saving). */
const plus = (d: string, n: number) => {
  const t = new Date(`${d}T12:00`); t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export function weekDays(x: { meds: Medication[]; doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; daily: DailyHealth[] }, from: string, s: ScheduleSettings): { days: string[]; rows: WeekRow[] } {
  const days = Array.from({ length: 7 }, (_, i) => plus(from, i));
  const prev = Array.from({ length: 7 }, (_, i) => plus(from, i - 7));
  const live = <T extends { deletedAt?: string }>(r: T) => !r.deletedAt;
  const rows: WeekRow[] = [];
  const row = (key: WeekRowKey, per: (d: string) => number | null, extra: Partial<WeekRow> = {}) => {
    const values = days.map(per);
    const a = mean(values.filter((v): v is number => v !== null));
    const b = mean(prev.map(per).filter((v): v is number => v !== null));
    if (values.some((v) => v !== null)) rows.push({ key, values, avg: a, prevAvg: b, ...extra });
  };

  // Doses: taken (not skipped) against the plan, for medicines with a daily number.
  const sched = x.meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  if (sched.length) {
    const taken = new Map<string, number>();
    for (const d of x.doses) if (live(d) && !d.skipped && sched.some((m) => m.id === d.medicationId)) {
      const k = dayKey(Date.parse(d.takenAt), s); taken.set(k, (taken.get(k) ?? 0) + 1);
    }
    const plannedOn = (d: string) => sched.reduce((n, m) => n + (Date.parse(m.createdAt) > Date.parse(`${d}T23:59`) ? 0 : getDailyTarget(m, Date.parse(`${d}T12:00`), s) ?? 0), 0);
    const counts = days.map((d) => ({ taken: taken.get(d) ?? 0, planned: plannedOn(d) }));
    row('doses', (d) => { const p = plannedOn(d); return p ? Math.min(1, (taken.get(d) ?? 0) / p) : null; }, { counts });
  }
  // Weight: the day's weigh-in (the last one if several).
  const w = new Map<string, number>();
  for (const b of x.body) if (live(b) && typeof b.weightKg === 'number') w.set(b.date, b.weightKg);
  row('weight', (d) => w.get(d) ?? null);
  // Sleep: the night ending that morning, from the watch, else the morning check-in.
  const sl = new Map<string, number>(), st = new Map<string, number>();
  for (const r of x.daily) if (live(r)) { if (typeof r.sleepMin === 'number') sl.set(r.date, r.sleepMin / 60); if (typeof r.steps === 'number') st.set(r.date, r.steps); }
  const ciSleep = new Map<string, number>(), mood = new Map<string, number[]>();
  for (const c of x.checkIns) if (live(c)) {
    const k = dayKey(Date.parse(c.at), s);
    if (typeof c.sleepHours === 'number' && !ciSleep.has(k)) ciSleep.set(k, c.sleepHours);
    if (typeof c.mood === 'number') mood.set(k, [...(mood.get(k) ?? []), c.mood]);
  }
  row('sleep', (d) => sl.get(d) ?? ciSleep.get(d) ?? null);
  row('steps', (d) => st.get(d) ?? null);
  row('mood', (d) => mean(mood.get(d) ?? []));
  return { days, rows };
}
