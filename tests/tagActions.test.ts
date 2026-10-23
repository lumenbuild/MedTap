import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import type { Workout, WorkoutSet } from '../src/db/schema';
import { db } from '../src/db/db';
import { addExerciseNow, finishCardio, startCardio } from '../src/db/repos/training';
import { linkActionTag, linkTag } from '../src/db/repos/tags';
import { BUILT_IN } from '../src/logic/exercises';
import { actionTitle, openWorkout, plannedSets } from '../src/logic/tagActions';

const HOUR = 3_600_000;
let n = 0;
const set = (exerciseId: string, weightKg: number, reps: number): WorkoutSet => ({ id: `s${++n}`, exerciseId, weightKg, reps, done: true });
const wk = (t: number, sets: WorkoutSet[], o: Partial<Workout> = {}): Workout => ({ id: `w${++n}`, startedAt: new Date(t).toISOString(), sets, source: 'manual', createdAt: '', updatedAt: '', ...o });
const bench = BUILT_IN.find((e) => e.id === 'bench')!;
const squat = BUILT_IN.find((e) => e.id === 'squat')!;

describe('tag actions', () => {
  beforeEach(async () => { await Promise.all([db.workouts.clear(), db.tags.clear()]); });

  it('finds the workout in progress, ignoring finished, old and cardio ones', () => {
    const now = Date.now();
    const ws = [wk(now - 8 * HOUR, []), wk(now - HOUR, [], { endedAt: new Date(now).toISOString() }), wk(now - 10 * 60_000, [], { cardio: { activity: 'run', durationMin: 0 } }), wk(now - 20 * 60_000, [])];
    expect(openWorkout(ws, now)?.id).toBe(ws[3].id);
    expect(openWorkout(ws.slice(0, 3), now)).toBeUndefined();
  });

  it('lays out sets at the weight to aim for', () => {
    const last = wk(Date.now() - 3 * 86_400_000, [set('bench', 60, 8), set('bench', 60, 8), set('bench', 60, 8)], { endedAt: 'x' });
    const sets = plannedSets(bench, [last]);
    expect(sets).toHaveLength(3);
    expect(sets.every((x) => x.weightKg === 62.5 && x.reps === 8 && !x.done)).toBe(true);
  });

  it('a machine tag starts a workout, then adds to it once', async () => {
    const now = Date.now();
    const a = await addExerciseNow('me', squat, [], now);
    expect(a).toMatchObject({ started: true, added: true });
    const ws = await db.workouts.toArray();
    const b = await addExerciseNow('me', bench, ws, now);
    expect(b).toMatchObject({ started: false, added: true });
    expect(b.workout.id).toBe(a.workout.id);
    const c = await addExerciseNow('me', bench, await db.workouts.toArray(), now);
    expect(c.added).toBe(false);
    expect((await db.workouts.get(a.workout.id))!.sets.map((x) => x.exerciseId)).toEqual(['squat', 'squat', 'squat', 'bench', 'bench', 'bench']);
  });

  it('a cardio tag times the session from tap to tap', async () => {
    const w = await startCardio('me', 'run');
    await db.workouts.update(w.id, { startedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
    await finishCardio((await db.workouts.get(w.id))!, 5);
    expect((await db.workouts.get(w.id))!.cardio).toEqual({ activity: 'run', durationMin: 31, distanceKm: 5 });
  });

  it('relinking a tag to a medication clears its action, and names read well', async () => {
    await linkActionTag('t1', { kind: 'water', ml: 750 }, 'me', 'Bottle');
    expect(await db.tags.get('t1')).toMatchObject({ medicationId: '', action: { kind: 'water', ml: 750 }, label: 'Bottle' });
    await linkTag('t1', 'med1');
    const t = (await db.tags.get('t1'))!;
    expect(t.action).toBeUndefined();
    expect(t.medicationId).toBe('med1');
    expect(actionTitle({ kind: 'exercise', exerciseId: 'bench' }, BUILT_IN, [])).toBe('Bench press');
    expect(actionTitle({ kind: 'protein', g: 30 }, BUILT_IN, [])).toBe('Protein · 30 g');
  });
});
