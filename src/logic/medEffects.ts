// What changed in the watch's numbers after starting a medicine: the 4 weeks before the first dose against the latest
// 4 weeks on it (or the time since starting, once there's two weeks of it). Resting heart rate, HRV, sleep, deep
// sleep, breathing rate, skin temperature, blood oxygen, glucose, steps and calories burned. Only changes clear of the
// usual day-to-day spread are shown. Other things change over the same weeks too, so it's what moved, not proof of
// why. Pure.
import type { DailyHealth, Dose, Medication } from '../db/schema';

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

type Key = 'restingHr' | 'hrvMs' | 'sleepMin' | 'sleepDeepMin' | 'respRate' | 'skinTempDelta' | 'spo2Avg' | 'glucoseAvg' | 'steps' | 'kcalTotal';
const METRICS: { key: Key; label: string; unit: string; dp: number; better: 'up' | 'down' | 'none' }[] = [
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', dp: 0, better: 'down' },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', dp: 0, better: 'up' },
  { key: 'sleepMin', label: 'Sleep', unit: 'min', dp: 0, better: 'up' },
  { key: 'sleepDeepMin', label: 'Deep sleep', unit: 'min', dp: 0, better: 'up' },
  { key: 'respRate', label: 'Breathing rate', unit: 'a min', dp: 1, better: 'down' },
  { key: 'skinTempDelta', label: 'Skin temperature', unit: '°C', dp: 1, better: 'none' },
  { key: 'spo2Avg', label: 'Blood oxygen', unit: '%', dp: 1, better: 'up' },
  { key: 'glucoseAvg', label: 'Glucose', unit: 'mmol/L', dp: 1, better: 'down' },
  { key: 'steps', label: 'Steps', unit: '', dp: 0, better: 'up' },
  { key: 'kcalTotal', label: 'Calories burned', unit: 'kcal', dp: 0, better: 'none' },
];

export interface MedEffect { key: Key; label: string; unit: string; before: number; after: number; diff: number; better?: boolean; days: [number, number] }
export interface MedEffects { since: number; effects: MedEffect[]; checked: number }

/** When the medicine was started: its first dose taken. */
export function startedAt(med: Medication, doses: Dose[]): number | undefined {
  const t = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt));
  return t.length ? Math.min(...t) : undefined;
}

/** Needs 10+ days of a measure before starting and 10+ on it; a change counts when it's at least half the usual
 *  day-to-day spread (and more than a small floor for each measure). */
export function medEffects(med: Medication, doses: Dose[], daily: DailyHealth[], now: number): MedEffects | null {
  const since = startedAt(med, doses);
  if (since === undefined || now - since < 14 * DAY) return null;
  const at = (d: DailyHealth) => new Date(`${d.date}T12:00`).getTime();
  const rows = daily.filter((d) => !d.deletedAt);
  const before = rows.filter((d) => at(d) < since && at(d) >= since - 28 * DAY);
  // On it: the latest 4 weeks, skipping the first week of settling in when there's enough time.
  const afterFrom = Math.max(since + (now - since > 35 * DAY ? 7 * DAY : 0), now - 28 * DAY);
  const after = rows.filter((d) => at(d) >= afterFrom && at(d) <= now);
  const effects: MedEffect[] = [];
  let checked = 0;
  for (const m of METRICS) {
    const a = before.map((d) => d[m.key]).filter((x): x is number => typeof x === 'number');
    const b = after.map((d) => d[m.key]).filter((x): x is number => typeof x === 'number');
    if (a.length < 10 || b.length < 10) continue;
    checked++;
    const ma = median(a), mb = median(b), diff = mb - ma;
    const spread = sd([...a.map((x) => x - ma), ...b.map((x) => x - mb)]);
    const floor = { restingHr: 2, hrvMs: 3, sleepMin: 15, sleepDeepMin: 8, respRate: 0.5, skinTempDelta: 0.2, spo2Avg: 0.5, glucoseAvg: 0.3, steps: 800, kcalTotal: 100 }[m.key];
    if (Math.abs(diff) < Math.max(floor, spread * 0.5)) continue;
    const r = (v: number) => Math.round(v * 10 ** m.dp) / 10 ** m.dp;
    effects.push({ key: m.key, label: m.label, unit: m.unit, before: r(ma), after: r(mb), diff: r(diff), better: m.better === 'none' ? undefined : (m.better === 'up') === diff > 0, days: [a.length, b.length] });
  }
  return { since, effects, checked };
}
