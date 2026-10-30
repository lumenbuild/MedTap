// Workouts, routines, the person's own exercises and fitness goals (MedTap), and protein / water for the day.
import { db } from '../db';
import { DEFAULT_PERSON, type CardioEntry, type CoachPlan, type DailyHealth, type Exercise, type FitnessGoal, type Routine, type RoutineItem, type Workout, type WorkoutSet } from '../schema';

import type { ExerciseDef } from '../../logic/exercises';
import type { Units } from './settings';
import { openWorkout, plannedSets } from '../../logic/tagActions';

const nowIso = () => new Date().toISOString();
const who = (personId: string) => (personId === DEFAULT_PERSON ? undefined : personId);
export const newSetId = () => crypto.randomUUID();

/** Start a workout now, from a routine (its sets laid out, with the weights to aim for) or empty. */
export async function startWorkout(personId: string, opts: { routine?: Routine; sets?: WorkoutSet[]; name?: string } = {}): Promise<Workout> {
  const now = nowIso();
  const w: Workout = { id: crypto.randomUUID(), startedAt: now, routineId: opts.routine?.id, name: opts.name ?? opts.routine?.name, sets: opts.sets ?? [], source: 'manual', personId: who(personId), createdAt: now, updatedAt: now };
  await db.workouts.add(w);
  return w;
}
export async function saveWorkout(w: Workout) { await db.workouts.put({ ...w, updatedAt: nowIso() }); }
export async function finishWorkout(id: string) { await db.workouts.update(id, { endedAt: nowIso(), updatedAt: nowIso() }); }
export async function removeWorkout(id: string) { const now = nowIso(); await db.workouts.update(id, { deletedAt: now, updatedAt: now }); }
export async function restoreWorkout(id: string) { await db.workouts.update(id, { deletedAt: undefined, updatedAt: nowIso() }); }

export async function logCardio(personId: string, at: string, cardio: CardioEntry, note?: string): Promise<Workout> {
  const now = nowIso();
  const w: Workout = { id: crypto.randomUUID(), startedAt: at, endedAt: at, sets: [], cardio, note, source: 'manual', personId: who(personId), createdAt: now, updatedAt: now };
  await db.workouts.add(w);
  return w;
}

export async function saveRoutine(personId: string, r: { id?: string; name: string; items: RoutineItem[] }): Promise<Routine> {
  const now = nowIso();
  const old = r.id ? await db.routines.get(r.id) : undefined;
  const row: Routine = { ...(old ?? { id: crypto.randomUUID(), createdAt: now, personId: who(personId) }), name: r.name.trim() || 'Routine', items: r.items, updatedAt: now };
  await db.routines.put(row);
  return row;
}
export async function removeRoutine(id: string) { const now = nowIso(); await db.routines.update(id, { deletedAt: now, updatedAt: now }); }
export async function restoreRoutine(id: string) { await db.routines.update(id, { deletedAt: undefined, updatedAt: nowIso() }); }

export async function addExercise(personId: string, e: Pick<Exercise, 'name' | 'muscles' | 'pattern' | 'bodyweight' | 'increment' | 'equipment' | 'perHand' | 'timed'>): Promise<Exercise> {
  const now = nowIso();
  const row: Exercise = { id: crypto.randomUUID(), ...e, name: e.name.trim(), personId: who(personId), createdAt: now, updatedAt: now };
  await db.exercises.add(row);
  return row;
}

/** Add or replace (same id) a fitness goal; `remove` deletes it. Returns the goals before, for undo. */
export async function setFitnessGoal(personId: string, goal: FitnessGoal, remove = false): Promise<FitnessGoal[] | undefined> {
  const now = nowIso();
  const p = await db.people.get(personId);
  const base = p ?? { id: personId, name: 'Me', createdAt: now, updatedAt: now };
  const before = p?.fitnessGoals;
  const goals = [...(before ?? []).filter((g) => g.id !== goal.id), ...(remove ? [] : [goal])];
  await db.people.put({ ...base, fitnessGoals: goals.length ? goals : undefined, updatedAt: now });
  return before;
}
/** Set (or clear) the training plan the coach runs for this person. Returns the one before, for undo. */
export async function setCoach(personId: string, plan: CoachPlan | undefined): Promise<CoachPlan | undefined> {
  const now = nowIso();
  const p = await db.people.get(personId);
  const base = p ?? { id: personId, name: 'Me', createdAt: now, updatedAt: now };
  await db.people.put({ ...base, coach: plan, updatedAt: now });
  return p?.coach;
}
/** Set the person's height (cm), or clear it. */
export async function setHeight(personId: string, heightCm: number | undefined) {
  const now = nowIso();
  const p = await db.people.get(personId);
  const base = p ?? { id: personId, name: 'Me', createdAt: now, updatedAt: now };
  await db.people.put({ ...base, heightCm, updatedAt: now });
}
export async function restoreFitnessGoals(personId: string, goals: FitnessGoal[] | undefined) {
  const p = await db.people.get(personId);
  if (p) await db.people.put({ ...p, fitnessGoals: goals, updatedAt: nowIso() });
}

/** Add protein (g) or water (mL) to a day (negative takes it off). Returns the day's new total. */
export async function addIntake(personId: string, date: string, field: 'proteinG' | 'waterMl', amount: number): Promise<number> {
  return db.transaction('rw', db.daily, async () => {
    const pid = who(personId);
    const old = (await db.daily.where('date').equals(date).toArray()).find((d) => !d.deletedAt && (d.personId ?? undefined) === pid);
    const now = nowIso();
    const total = Math.max(0, (old?.[field] ?? 0) + amount);
    const row: DailyHealth = { ...(old ?? { id: crypto.randomUUID(), date, personId: pid, createdAt: now }), [field]: total, updatedAt: now };
    await db.daily.put(row);
    return total;
  });
}

/** From a tag on a machine: add the exercise to the workout in progress (unless it's already there), or start one with
 *  it. Returns the workout and whether it was started. */
export async function addExerciseNow(personId: string, def: ExerciseDef, workouts: Workout[], now: number, units: Units = 'metric', today?: { readiness: number | null; weakDay: boolean; lighter?: boolean }): Promise<{ workout: Workout; started: boolean; added: boolean }> {
  const open = openWorkout(workouts, now);
  if (open) {
    if (open.sets.some((s) => s.exerciseId === def.id)) return { workout: open, started: false, added: false };
    const next = { ...open, sets: [...open.sets, ...plannedSets(def, workouts, undefined, newSetId, units, today && { ...today, now })] };
    await saveWorkout(next);
    return { workout: next, started: false, added: true };
  }
  const workout = await startWorkout(personId, { sets: plannedSets(def, workouts, undefined, newSetId, units, today && { ...today, now }) });
  return { workout, started: true, added: true };
}

/** A cardio session timed by tapping its tag at the start and again at the end. */
export async function startCardio(personId: string, activity: CardioEntry['activity']): Promise<Workout> {
  const now = nowIso();
  const w: Workout = { id: crypto.randomUUID(), startedAt: now, sets: [], cardio: { activity, durationMin: 0 }, source: 'manual', personId: who(personId), createdAt: now, updatedAt: now };
  await db.workouts.add(w);
  return w;
}
export async function finishCardio(w: Workout, distanceKm?: number) {
  const end = Date.now();
  await db.workouts.put({ ...w, endedAt: new Date(end).toISOString(), updatedAt: nowIso(),
    cardio: { ...w.cardio!, durationMin: Math.max(1, Math.round((end - Date.parse(w.startedAt)) / 60_000)), ...(distanceKm ? { distanceKm } : {}) } });
}
