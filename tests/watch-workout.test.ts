import { describe, it, expect } from 'vitest';
import type { Workout } from '../src/db/schema';
import { watchWorkout } from '../src/logic/watchWorkout';
import { allExercises } from '../src/logic/exercises';

const defs = allExercises([]);
const defOf = (id: string) => defs.find((d) => d.id === id)!;
const NOW = Date.parse('2026-09-01T08:00:00Z');
const w = (o: Partial<Workout> = {}): Workout => ({
  id: 'w', startedAt: new Date(NOW - 600_000).toISOString(), name: 'Legs', source: 'manual', createdAt: '', updatedAt: '',
  sets: [
    { id: 'wu', exerciseId: 'squat', weightKg: 20, reps: 10, done: true, warmup: true },
    { id: 's1', exerciseId: 'squat', weightKg: 100, reps: 5, done: true },
    { id: 's2', exerciseId: 'squat', weightKg: 100, reps: 5, done: false },
    { id: 's3', exerciseId: 'squat', weightKg: 100, reps: 5, done: false },
  ], ...o,
});

describe('watch workout', () => {
  it('next set, its number among working sets, and the rest', () => {
    const s = watchWorkout(w(), defOf, 'metric', NOW + 90_000, NOW);
    expect(s).toMatchObject({ active: true, title: 'Legs', done: 2, total: 4, restUntil: NOW + 90_000 });
    expect(s.next).toEqual({ setId: 's2', exercise: 'Back squat', label: 'Set 2 of 3', load: '100 kg × 5' });
  });
  it('no rest once it has passed; inactive when finished', () => {
    expect(watchWorkout(w(), defOf, 'metric', NOW - 1, NOW).restUntil).toBe(0);
    expect(watchWorkout(w({ endedAt: new Date(NOW).toISOString() }), defOf, 'metric', 0, NOW).active).toBe(false);
    expect(watchWorkout(null, defOf, 'metric', 0, NOW).active).toBe(false);
    expect(watchWorkout(w({ sets: w().sets.map((x) => ({ ...x, done: true })) }), defOf, 'metric', 0, NOW).next).toBeUndefined();
  });
});
