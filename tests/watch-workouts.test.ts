import { describe, it, expect } from 'vitest';
import type { Workout } from '../src/db/schema';
import { planHealthImport } from '../src/logic/healthImport';

const T = Date.UTC(2026, 9, 30, 7, 0);
const MIN = 60_000;
const data = (workouts: NonNullable<Parameters<typeof planHealthImport>[0]['workouts']>) => ({ days: [], weights: [], bp: [], workouts });
const plan = (w: Parameters<typeof data>[0], existing: Workout[] = []) => planHealthImport(data(w), { daily: [], body: [], vitals: [], workouts: existing }, undefined, 'UTC', new Date(T).toISOString());

describe('workouts from the watch', () => {
  it('a run with heart rate and calories', () => {
    const p = plan([{ t: T, end: T + 30 * MIN, type: 'run', km: 5.2, avgHr: 151.4, maxHr: 178, kcal: 402.6 }]);
    expect(p.cardio).toEqual([{ at: new Date(T).toISOString(), activity: 'run', durationMin: 30, distanceKm: 5.2, avgHr: 151, maxHr: 178, kcal: 403 }]);
  });
  it('other kinds come in by name: HIIT, yoga, a strength session not logged here, or the watch’s own title', () => {
    const p = plan([
      { t: T, end: T + 20 * MIN, type: 'hiit', avgHr: 140 },
      { t: T + 3600_000, end: T + 3600_000 + 45 * MIN, type: 'yoga' },
      { t: T + 7200_000, end: T + 7200_000 + 50 * MIN, type: 'strength', kcal: 250 },
      { t: T + 10_800_000, end: T + 10_800_000 + 40 * MIN, type: 'sport', title: 'Tennis with Sam' },
    ]);
    expect(p.cardio.map((c) => [c.activity, c.title])).toEqual([['other', 'HIIT'], ['other', 'Yoga'], ['other', 'Strength training'], ['other', 'Tennis with Sam']]);
  });
  it('a strength session also logged in the app gets the watch’s heart rate and calories, not a second workout', () => {
    const logged = { id: 'w1', startedAt: new Date(T + 5 * MIN).toISOString(), sets: [], source: 'manual', createdAt: '', updatedAt: '' } as Workout;
    const p = plan([{ t: T, end: T + 60 * MIN, type: 'strength', avgHr: 118, maxHr: 160, kcal: 310 }], [logged]);
    expect(p.cardio).toEqual([]);
    expect(p.enrich).toEqual([{ id: 'w1', watch: { avgHr: 118, maxHr: 160, kcal: 310, minutes: 60 } }]);
  });
  it('a session imported before gets heart rate once; deleted ones stay deleted; short walks are skipped', () => {
    const before = { id: 'h1', startedAt: new Date(T).toISOString(), endedAt: new Date(T).toISOString(), sets: [], source: 'health', cardio: { activity: 'run', durationMin: 30 }, createdAt: '', updatedAt: '' } as Workout;
    const gone = { ...before, id: 'h2', startedAt: new Date(T + 3600_000).toISOString(), deletedAt: 'x' } as Workout;
    const p = plan([
      { t: T + MIN, end: T + 31 * MIN, type: 'run', avgHr: 150 },
      { t: T + 3600_000, end: T + 3600_000 + 30 * MIN, type: 'run', avgHr: 150 },
      { t: T + 7200_000, end: T + 7200_000 + 6 * MIN, type: 'walk' },
    ], [before, gone]);
    expect(p.cardio).toEqual([]);
    expect(p.enrich).toEqual([{ id: 'h1', cardio: { avgHr: 150 } }]);
  });
});
