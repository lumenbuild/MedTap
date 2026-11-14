// Small marks along the bottom of every chart, so any line can be read with what kind of day it was: a weekly shot,
// a test's off day, a short night, a day with food logged. One set of colours everywhere. Pure.
import type { CheckIn, DailyHealth, Dose, Experiment, FoodLog, Medication } from '../db/schema';
import { inGroup } from './interactions';
import { conditionOn, testDayFor } from './experiments';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

export type DayLabel = 'shot' | 'off' | 'short' | 'food';
export const DAY_LABELS: { key: DayLabel; label: string; colour: string }[] = [
  { key: 'shot', label: 'Shot day', colour: 'var(--c-pep, #eb6834)' },
  { key: 'off', label: 'Test off day', colour: 'var(--caution, #b85c00)' },
  { key: 'short', label: 'Short night', colour: 'var(--c-sleep, #6250d6)' },
  { key: 'food', label: 'Food logged', colour: 'var(--c-act, #1baf7a)' },
];

export function dayLabels(d: { meds: Medication[]; doses: Dose[]; experiments: Experiment[]; daily: DailyHealth[]; foodLogs: FoodLog[]; checkIns?: CheckIn[] }, s: ScheduleSettings): Map<string, DayLabel[]> {
  const out = new Map<string, DayLabel[]>();
  const add = (k: string, l: DayLabel) => { const xs = out.get(k) ?? []; if (!xs.includes(l)) out.set(k, [...xs, l]); };
  // A weekly-type shot (a GLP-1 or similar long-acting injection).
  const weekly = new Set(d.meds.filter((m) => !m.archived && inGroup(m, 'glp1')).map((m) => m.id));
  for (const x of d.doses) if (!x.deletedAt && !x.skipped && weekly.has(x.medicationId)) add(dayKey(Date.parse(x.takenAt), s), 'shot');
  for (const e of d.experiments.filter((x) => !x.deletedAt)) {
    const med = d.meds.find((m) => testDayFor(m, [e], e.start) !== null);
    const last = new Date(`${e.start}T12:00`).getTime() + e.blocks.length * e.blockDays * 86_400_000;
    for (let t = new Date(`${e.start}T12:00`).getTime(); t < last; t += 86_400_000) {
      const k = dayKey(t, s);
      if (!conditionOn(e, k)) continue;
      if (med ? testDayFor(med, [e], k)?.on === false : conditionOn(e, k)?.arm === 'b') add(k, 'off');
    }
  }
  // The night before: the morning's row holds it, so it marks the day before.
  for (const r of d.daily) if (!r.deletedAt && typeof r.sleepMin === 'number' && r.sleepMin < 360) add(dayKey(new Date(`${r.date}T12:00`).getTime() - 86_400_000, s), 'short');
  for (const l of d.foodLogs) if (!l.deletedAt) add(dayKey(Date.parse(l.at), s), 'food');
  return out;
}
