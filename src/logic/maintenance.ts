// After the loss (both apps with body): weight creeping back, worked out from the 7-day average, and why it might be
// (a dose that came down or stopped, or the goal reached and eating back up); and noticing the goal is reached, to
// move the calorie target to maintenance. Most regain happens here, so catching it early matters. Pure.
import type { BodyEntry, BodyGoal, Dose, Medication } from '../db/schema';
import { rollingAverage } from './stats';

const DAY = 86_400_000;

export interface Regain {
  /** kg up from the lowest 7-day average, and when that was. */
  up: number; lowAt: number; low: number; now: number;
  /** What changed around it, if anything: a dose stepped down, stopped, or the goal reached. */
  why?: string;
}

const points = (body: BodyEntry[]) => body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! })).sort((a, b) => a.t - b.t);

/** Up at least 1.5 kg (or 2%) from the lowest 7-day average of the last four months, held for two weeks or more. */
export function regainWatch(body: BodyEntry[], meds: Medication[], doses: Dose[], goals: BodyGoal[], now: number, fmt: (kg: number) => string, name: (m: Medication) => string): Regain | null {
  const pts = points(body).filter((p) => p.t > now - 120 * DAY && p.t <= now);
  if (pts.length < 8) return null;
  const avg = rollingAverage(pts);
  const low = avg.reduce((m, p) => (p.v < m.v ? p : m), avg[0]);
  const cur = avg[avg.length - 1];
  const up = cur.v - low.v;
  if (up < Math.max(1.5, low.v * 0.02) || cur.t - low.t < 14 * DAY) return null;
  // Since the low: a medicine's dose stepped down, or stopped (no dose in twice its usual gap), or the goal reached.
  let why: string | undefined;
  for (const m of meds) {
    const ds = doses.filter((d) => d.medicationId === m.id && !d.deletedAt && !d.skipped).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    if (ds.length < 3) continue;
    const before = ds.filter((d) => Date.parse(d.takenAt) < low.t - 7 * DAY).at(-1), after = ds.at(-1)!;
    if (before && after.amount < before.amount - 1e-9 && Date.parse(after.takenAt) > low.t - 14 * DAY) { why = `Since ${name(m)} came down to ${after.amount} ${m.unit}`; break; }
    const gaps = ds.slice(1).map((d, i) => Date.parse(d.takenAt) - Date.parse(ds[i].takenAt)).sort((a, b) => a - b);
    const usual = gaps[gaps.length >> 1];
    if (usual && now - Date.parse(after.takenAt) > Math.max(2 * usual, 10 * DAY) && Date.parse(after.takenAt) > low.t - 21 * DAY) { why = `Since your last ${name(m)}`; break; }
  }
  const goal = goals.find((g) => g.metric === 'weightKg' && g.target < g.start);
  if (!why && goal && low.v <= goal.target + 0.5) why = `Since reaching your goal of ${fmt(goal.target)}`;
  return { up: Math.round(up * 10) / 10, lowAt: low.t, low: low.v, now: cur.v, why };
}

/** The weight goal is reached (7-day average at or below it): time to aim to keep it. */
export function goalReached(body: BodyEntry[], goals: BodyGoal[]): BodyGoal | null {
  const goal = goals.find((g) => g.metric === 'weightKg' && g.target < g.start);
  if (!goal) return null;
  const avg = rollingAverage(points(body));
  return avg.length >= 3 && avg[avg.length - 1].v <= goal.target ? goal : null;
}
