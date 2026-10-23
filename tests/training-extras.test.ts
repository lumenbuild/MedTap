import { describe, it, expect } from 'vitest';
import type { BodyEntry, Workout, WorkoutSet } from '../src/db/schema';
import { BUILT_IN } from '../src/logic/exercises';
import { lighterWeekDue, pbWithinReach, relativeStrength, strongestWeekday, warmupSets } from '../src/logic/trainingExtras';
import { nextTarget } from '../src/logic/training';
import { smartTarget } from '../src/logic/progression';
import { fromLoad } from '../src/logic/load';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-01T08:00:00Z');
let n = 0;
const id = () => `x${++n}`;
const set = (e: string, kg: number, reps: number): WorkoutSet => ({ id: id(), exerciseId: e, weightKg: kg, reps, done: true });
const wk = (daysAgo: number, sets: WorkoutSet[]): Workout => ({ id: id(), startedAt: new Date(NOW - daysAgo * DAY).toISOString(), sets, source: 'manual', createdAt: '', updatedAt: '' });
const ex = (x: string) => BUILT_IN.find((e) => e.id === x)!;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

describe('training extras', () => {
  it('warm-ups ramp to the working weight on loadable weights', () => {
    expect(warmupSets(ex('squat'), 100, 20, 'metric', id).map((s) => [s.weightKg, s.reps])).toEqual([[20, 10], [40, 5], [60, 3], [80, 1]]);
    expect(warmupSets(ex('squat'), fromLoad(225, 'imperial'), fromLoad(45, 'imperial'), 'imperial', id).every((s) => s.warmup)).toBe(true);
    expect(warmupSets(ex('db-bench'), 30, 20, 'metric', id).map((s) => s.weightKg)).toEqual([16, 22]);
    expect(warmupSets(ex('squat'), 30, 20, 'metric', id)).toEqual([]);
    expect(warmupSets(ex('plank'), 0, 20, 'metric', id)).toEqual([]);
  });

  it('a personal best in reach', () => {
    const ws = [wk(10, [set('bench', 70, 8)]), wk(5, [set('bench', 72.5, 6)])];
    expect(pbWithinReach('bench', ws, 75, 5)).toBe('75 kg would be your heaviest (was 72.5 kg).');
    expect(pbWithinReach('bench', ws, 72.5, 6)).toBe('7 reps at 72.5 kg would beat your best of 6.');
    expect(pbWithinReach('bench', ws, 60, 5)).toBeNull();
  });

  it('strength for body weight, now and 8 weeks ago', () => {
    const ws = [wk(60, [set('squat', 100, 5)]), wk(2, [set('squat', 100, 5)])];
    const body: BodyEntry[] = [{ id: 'a', date: ymd(NOW - 61 * DAY), weightKg: 100, createdAt: '', updatedAt: '' }, { id: 'b', date: ymd(NOW - 3 * DAY), weightKg: 90, createdAt: '', updatedAt: '' }];
    expect(relativeStrength('squat', ws, body, NOW)).toEqual({ now: 1.3, then: 1.17 });
  });

  it('rep ranges: a rep at a time to the top, then weight', () => {
    const item = { exerciseId: 'curl', sets: 3, reps: 8, repsMax: 12 };
    expect(nextTarget(ex('curl'), [wk(3, [set('curl', 12, 9), set('curl', 12, 9), set('curl', 12, 9)])], item)).toMatchObject({ reps: 10, weightKg: 12, why: 'reps' });
    expect(nextTarget(ex('curl'), [wk(3, [set('curl', 12, 12), set('curl', 12, 12), set('curl', 12, 12)])], item)).toMatchObject({ reps: 8, weightKg: 13, why: 'up' });
    expect(nextTarget(ex('curl'), [wk(3, [set('curl', 12, 10), set('curl', 12, 9), set('curl', 12, 7)])], item)).toMatchObject({ reps: 8, weightKg: 12, why: 'same' });
  });

  it('a lighter week when 6+ hard weeks in a row, and it lightens targets', () => {
    const ws: Workout[] = [];
    for (let w = 0; w < 7; w++) for (const d of [1, 3, 5]) ws.push(wk(w * 7 + d, [set('bench', 60 + w, 8)]));
    expect(lighterWeekDue(ws, BUILT_IN, NOW)?.reason).toMatch(/weeks in a row/);
    expect(lighterWeekDue(ws, BUILT_IN, NOW, NOW - 7 * DAY)).toBeNull();
    const t = smartTarget(ex('bench'), [wk(2, [set('bench', 100, 5), set('bench', 100, 5), set('bench', 100, 5)])], { now: NOW, lighter: true });
    expect(t).toMatchObject({ sets: 2, weightKg: 92.5, why: 'hold' });
  });

  it('which weekday the strongest day after a weekly shot falls on', () => {
    const wed = Date.parse('2026-08-26T22:00:00Z'); // Thu 8 am Sydney
    const shots = [wed - 14 * DAY, wed - 7 * DAY, wed];
    expect(strongestWeekday(shots, [0, 2], 'Australia/Sydney')).toEqual({ weekday: 'Saturday', day: 2 });
    expect(strongestWeekday([wed - 3 * DAY, wed], [2], 'Australia/Sydney')).toBeNull();
  });
});
