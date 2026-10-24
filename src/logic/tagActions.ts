// Tags that aren't for a medication: what each one does when tapped, in words, and the training helpers they use.
import type { Routine, RoutineItem, TagAction, Workout, WorkoutSet } from '../db/schema';
import type { ExerciseDef } from './exercises';
import { nextTarget } from './training';
import { smartTarget } from './progression';
import type { Units } from '../db/repos/settings';

const SIX_HOURS = 6 * 3_600_000;

/** The workout in progress (started in the last 6 hours, not finished), if there is one. */
export const openWorkout = (workouts: Workout[], now: number): Workout | undefined =>
  workouts.filter((w) => !w.deletedAt && !w.endedAt && !w.cardio && now - Date.parse(w.startedAt) < SIX_HOURS && Date.parse(w.startedAt) <= now + 60_000)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

/** An exercise's sets laid out at the weight and reps to aim for (from last time, the routine's numbers, and with
 *  `today`, how hard recent sets felt and how ready the person is). */
export function plannedSets(def: ExerciseDef, workouts: Workout[], item?: RoutineItem, newId: () => string = () => crypto.randomUUID(), units: Units = 'metric',
  today?: { readiness: number | null; weakDay: boolean; now: number; lighter?: boolean }): WorkoutSet[] {
  // With today's context, the smart target (pushes when there's room, holds on a low day); otherwise the simple rule.
  const t = today ? smartTarget(def, workouts, { item, units, readiness: today.readiness, weakDay: today.weakDay, now: today.now, lighter: today.lighter }) : nextTarget(def, workouts, item, units);
  return Array.from({ length: t.sets }, () => ({ id: newId(), exerciseId: def.id, weightKg: t.weightKg || item?.weightKg || 0, reps: t.reps, done: false }));
}

export const ACTION_KINDS: { kind: TagAction['kind']; name: string; where: string; training?: boolean; body?: boolean; food?: boolean }[] = [
  { kind: 'exercise', name: 'An exercise or machine', where: 'On the machine, rack or bench', training: true },
  { kind: 'routine', name: 'A routine', where: 'On your gym bag or locker', training: true },
  { kind: 'cardio', name: 'Cardio', where: 'On the treadmill, bike or rower', training: true },
  { kind: 'water', name: 'Water bottle', where: 'Adds that much water to today', training: true },
  { kind: 'protein', name: 'Protein shaker', where: 'Adds that much protein to today', training: true },
  { kind: 'weight', name: 'Scales', where: 'Opens Log weight', body: true },
  { kind: 'measure', name: 'Tape measure', where: 'Opens Add measurements', body: true },
  { kind: 'food', name: 'A food or drink', where: 'On something you have often: logs one serving', food: true },
  { kind: 'bp', name: 'Blood pressure cuff', where: 'Opens Log blood pressure' },
  { kind: 'checkin', name: 'Check-in', where: 'Bedside or desk: opens a check-in' },
];

const CARDIO_NAMES: Record<string, string> = { run: 'Run', walk: 'Walk', ride: 'Ride', swim: 'Swim', row: 'Row', other: 'Cardio' };

/** "Bench press", "Water bottle · 500 mL" and so on: what the tag is, for lists and the tap screen. */
export function actionTitle(a: TagAction, defs: ExerciseDef[], routines: Routine[], foods: { id: string; name: string; deletedAt?: string }[] = []): string {
  switch (a.kind) {
    case 'exercise': return defs.find((d) => d.id === a.exerciseId)?.name ?? 'An exercise';
    case 'routine': return routines.find((r) => r.id === a.routineId && !r.deletedAt)?.name ?? 'A routine';
    case 'water': return `Water · ${a.ml} mL`;
    case 'protein': return `Protein · ${a.g} g`;
    case 'cardio': return CARDIO_NAMES[a.activity] ?? 'Cardio';
    case 'weight': return 'Log weight';
    case 'bp': return 'Log blood pressure';
    case 'checkin': return 'Check in';
    case 'measure': return 'Add measurements';
    case 'food': return foods.find((f) => f.id === a.foodId && !f.deletedAt)?.name ?? 'A food';
  }
}
