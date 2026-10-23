// More training smarts (MedTap): warm-up sets worked out to the working weight, a personal best within reach today,
// strength for body weight, when a lighter week is due, and which day after the shot to put the heaviest session.
// From the person's own logs. Pure.
import type { BodyEntry, Workout, WorkoutSet } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ExerciseDef } from './exercises';
import { e1rmSeries, personalBests, plateau, working } from './training';
import { fmtLoad, roundLoad } from './load';
import { ymdToMs } from './stats';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Warm-ups ramping to the working weight: the empty bar, then about 40%, 60% and 80% (barbell lifts), or about 50%
 *  and 75% (dumbbells, machines). Loadable weights only; none for light work or bodyweight. */
export function warmupSets(def: ExerciseDef, workKg: number, barKg: number, units: Units, newId: () => string): WorkoutSet[] {
  if (def.timed || def.bodyweight || workKg <= 0) return [];
  const barbell = def.equipment === 'barbell' || (!def.equipment && def.compound);
  if (barbell && workKg < barKg + 15) return [];
  if (!barbell && workKg < 10) return [];
  const steps: [number, number][] = barbell ? [[0, 10], [0.4, 5], [0.6, 3], [0.8, 1]] : [[0.5, 8], [0.75, 3]];
  const out: WorkoutSet[] = [];
  let lastKg = -1;
  for (const [pct, reps] of steps) {
    const kg = pct === 0 ? barKg : Math.max(barbell ? barKg : 0, roundLoad(workKg * pct, def, units));
    if (kg <= lastKg + 1e-6 || kg >= workKg - 1e-6) continue;
    out.push({ id: newId(), exerciseId: def.id, weightKg: kg, reps, done: false, warmup: true });
    lastKg = kg;
  }
  return out;
}

/** Before a set: what would be a personal best — a heavier weight than ever, or more reps than ever at this weight. */
export function pbWithinReach(exerciseId: string, workouts: Workout[], weightKg: number, reps: number, units: Units = 'metric'): string | null {
  const pb = personalBests(exerciseId, workouts);
  if (!pb.heaviest) return null;
  if (weightKg > pb.heaviest.kg + 1e-6) return `${fmtLoad(weightKg, units)} would be your heaviest (was ${fmtLoad(pb.heaviest.kg, units)}).`;
  const atOrAbove = pb.repsAt.filter((x) => x.kg >= weightKg - 1e-6);
  const best = atOrAbove.reduce((m, x) => Math.max(m, x.reps), 0);
  if (best && reps >= best - 1) return `${best + 1} reps at ${fmtLoad(weightKg, units)} would beat your best of ${best}.`;
  return null;
}

/** Estimated max as a multiple of body weight, now and 8 weeks ago (so progress shows while weight comes down). */
export function relativeStrength(exerciseId: string, workouts: Workout[], body: BodyEntry[], now: number): { now: number; then?: number } | null {
  const pts = e1rmSeries(exerciseId, workouts);
  const w = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: ymdToMs(b.date), kg: b.weightKg! })).sort((a, b) => a.t - b.t);
  if (!pts.length || !w.length || !workouts.some((x) => x.sets.some((s) => s.exerciseId === exerciseId && s.weightKg > 0))) return null;
  const weightAt = (t: number) => { const before = w.filter((x) => x.t <= t + DAY); return (before.length ? before[before.length - 1] : w[0]).kg; };
  const at = (t: number) => { const p = pts.filter((x) => x.t <= t); return p.length ? p[p.length - 1] : undefined; };
  const nowP = at(now)!;
  const thenP = at(now - 8 * WEEK);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { now: r2(nowP.v / weightAt(nowP.t)), then: thenP && thenP.t !== nowP.t ? r2(thenP.v / weightAt(thenP.t)) : undefined };
}

export interface LighterWeek { reason: string; lifts: string[] }

/** When a planned lighter week is due: 3+ lifts stalled at once, or 6+ weeks of 3+ sessions with no easier week. */
export function lighterWeekDue(workouts: Workout[], defs: ExerciseDef[], now: number, lastLighter?: number): LighterWeek | null {
  if (lastLighter && now - lastLighter < 4 * WEEK) return null;
  const ws = workouts.filter((w) => !w.deletedAt && !w.cardio && working(w.sets).length);
  const ids = [...new Set(ws.filter((w) => Date.parse(w.startedAt) > now - 3 * WEEK).flatMap((w) => working(w.sets).map((s) => s.exerciseId)))];
  const stalled = ids.filter((id) => plateau(id, ws, now));
  if (stalled.length >= 3) return { reason: `${stalled.length} lifts have stalled together, which usually means tiredness more than strength.`, lifts: stalled.map((id) => defs.find((d) => d.id === id)?.name ?? 'Exercise') };
  let hardWeeks = 0;
  for (let k = 0; k < 10; k++) {
    const a = now - (k + 1) * WEEK, b = now - k * WEEK;
    if (ws.filter((w) => Date.parse(w.startedAt) > a && Date.parse(w.startedAt) <= b).length >= 3) hardWeeks++; else break;
  }
  if (hardWeeks >= 6 && (!lastLighter || now - lastLighter > hardWeeks * WEEK)) return { reason: `${hardWeeks} weeks in a row of 3+ sessions with no lighter week.`, lifts: [] };
  return null;
}

/** During a lighter week: about 10% less weight and one set fewer (at least 2), same reps. */
export const lighten = (t: { sets: number; reps: number; weightKg: number }, def: ExerciseDef, units: Units) =>
  ({ sets: Math.max(2, t.sets - 1), reps: t.reps, weightKg: t.weightKg > 0 ? roundLoad(t.weightKg * 0.9, def, units) : 0 });

/** Which weekday the person's strongest day after a weekly shot falls on. */
export function strongestWeekday(shots: number[], bestDays: number[], tz: string): { weekday: string; day: number } | null {
  if (!bestDays.length || shots.length < 2) return null;
  const gaps = shots.slice(1).map((t, i) => (t - shots[i]) / DAY);
  if (gaps.some((g) => Math.abs(g - 7) > 1.5)) return null; // weekly shots only
  const day = bestDays.find((d) => d > 0) ?? bestDays[0];
  const t = shots[shots.length - 1] + day * DAY;
  return { weekday: new Date(t).toLocaleDateString('en-AU', { weekday: 'long', timeZone: tz }), day };
}

