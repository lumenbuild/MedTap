import { describe, it, expect } from 'vitest';
import type { BodyEntry, CoachPlan, Workout, WorkoutSet } from '../src/db/schema';
import { allExercises } from '../src/logic/exercises';
import { assessLevel, fitToTime, ladderSteps, nextSession, readyToMoveOn, recommend, sessionMinutes, PROGRAMS } from '../src/logic/coach';

const DAY = 86_400_000, WEEK = 7 * DAY;
const NOW = Date.parse('2026-10-25T09:00:00Z');
const st = { createdAt: '', updatedAt: '' };
const defs = allExercises();
let n = 0;
const set = (exerciseId: string, weightKg: number, reps: number): WorkoutSet => ({ id: `s${n++}`, exerciseId, weightKg, reps, done: true });
const workout = (t: number, sets: WorkoutSet[], name?: string): Workout => ({ id: `w${n++}`, startedAt: new Date(t).toISOString(), endedAt: new Date(t + 3_600_000).toISOString(), sets, source: 'manual', name, ...st });
const body: BodyEntry[] = [{ id: 'b', date: '2026-10-20', weightKg: 80, ...st }];
const plan = (o: Partial<CoachPlan>): CoachPlan => ({ goal: 'strength', days: 3, minutes: 60, kit: 'gym', experience: 0, standards: 'm', programId: 'str-1', startedAt: '2026-01-01T00:00:00Z', ...o });

describe('level', () => {
  it('a new starter is a Beginner, with weeks of training the next step', () => {
    const l = assessLevel(plan({}), [], body, NOW);
    expect(l.level).toBe(1);
    expect(l.next!.level).toBe(2);
    expect(l.next!.needs[0].text).toMatch(/8 more weeks/);
  });
  it('the lowest of weeks trained and strength for body weight sets the level', () => {
    // 60 weeks of training; estimated maxes: squat 150 (1.88×), bench 100 (1.25×), deadlift 205 (2.56×), press 60 (0.75×).
    const ws: Workout[] = [];
    for (let i = 60; i >= 1; i--) ws.push(workout(NOW - i * WEEK, [set('squat', 150, 1), set('bench', 100, 1), set('deadlift', 205, 1), set('ohp', 60, 1)]));
    const l = assessLevel(plan({}), ws, body, NOW);
    expect(l.weeksLevel).toBe(4);
    expect(l.lifts.map((x) => x.level)).toEqual([3, 3, 4, 3]);
    expect(l.level).toBe(3);
    expect(l.next!.needs.some((x) => /Squat: about 160 kg/.test(x.text))).toBe(true);
    // Without comparing to standards, weeks alone.
    expect(assessLevel(plan({ standards: null }), ws, body, NOW).level).toBe(4);
  });
});

describe('programmes', () => {
  it('every programme has days for every option it offers, and its next one exists', () => {
    for (const p of PROGRAMS) {
      for (const d of p.days) expect(p.rotation(d).length).toBeGreaterThan(0);
      if (p.next) expect(PROGRAMS.some((x) => x.id === p.next)).toBe(true);
    }
  });
  it('recommends by goal, level, equipment and days', () => {
    expect(recommend('strength', 1, 'gym', 3).id).toBe('str-1');
    expect(recommend('strength', 4, 'gym', 4).id).toBe('str-4');
    expect(recommend('muscle', 3, 'gym', 6).id).toBe('mus-3');
    expect(recommend('bodyweight', 1, 'none', 3).id).toBe('bw-1');
    expect(recommend('fitness', 2, 'home', 3).id).toBe('fit-2');
  });
});

describe('the next session', () => {
  it('alternates A and B, with the exercises for the equipment', () => {
    const p = plan({});
    const a = nextSession(p, [], body, defs, NOW)!;
    expect(a.title).toBe('Strength A/B · A');
    expect(a.items.map((i) => i.exerciseId)).toEqual(['squat', 'bench', 'row', 'hanging-raise']);
    const b = nextSession(p, [workout(NOW - DAY, [set('squat', 60, 5)], 'Strength A/B · A')], body, defs, NOW)!;
    expect(b.title).toBe('Strength A/B · B');
    expect(b.items.find((i) => i.exerciseId === 'deadlift')).toMatchObject({ sets: 1, reps: 5 });
    // Home: dumbbell versions.
    expect(nextSession(plan({ kit: 'home', goal: 'muscle', programId: 'mus-1' }), [], body, defs, NOW)!.items.map((i) => i.exerciseId)).toContain('goblet-squat');
  });
  it('waves: 65/75/85% of the training max for 5s, then 70/80/90 for 3s; the max goes up each wave', () => {
    const p = plan({ programId: 'str-4', days: 4, maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 50 } });
    const w1 = nextSession(p, [], body, defs, NOW)!;
    expect(w1.phase).toBe('Week 1: fives');
    expect(w1.items[0]).toMatchObject({ exerciseId: 'squat', weights: [65, 75, 85], repsBySet: [5, 5, 5] });
    const four = Array.from({ length: 4 }, (_, i) => workout(NOW - (10 - i) * DAY, [], `Strength waves · x${i}`));
    const w2 = nextSession(p, four, body, defs, NOW)!;
    expect(w2.items[0]).toMatchObject({ weights: [70, 80, 90], repsBySet: [3, 3, 3] });
    const sixteen = Array.from({ length: 16 }, (_, i) => workout(NOW - (40 - i) * DAY, [], `Strength waves · x${i}`));
    expect(nextSession(p, sixteen, body, defs, NOW)!.items[0].weights![2]).toBe(90); // max 105 × 85% = 89.25, to the nearest 2.5
  });
  it('bodyweight: each move at the person’s step on its ladder, moving up after two sessions at the target', () => {
    const p = plan({ goal: 'bodyweight', kit: 'none', programId: 'bw-1', standards: null });
    expect(nextSession(p, [], body, defs, NOW)!.items.find((i) => i.exerciseId.includes('push'))!.exerciseId).toBe('incline-push-up');
    const ws = [1, 2].map((d) => workout(NOW - d * DAY, [set('push-up', 0, 12), set('push-up', 0, 12), set('push-up', 0, 13)]));
    expect(ladderSteps(ws, 0, 'none').push).toBe(3); // push-up was step 2, passed: decline next
    expect(nextSession(p, ws, body, defs, NOW)!.items.find((i) => i.exerciseId.includes('push'))!.exerciseId).toBe('decline-push-up');
    // A lot of experience starts each ladder at its first Novice step: push-ups, but still the easiest overhead push.
    expect(ladderSteps([], 2, 'none')).toMatchObject({ push: 2, vpush: 0, legs: 1, core: 1 });
    // Without a bar the pull ladder stays at table rows.
    expect(ladderSteps([], 2, 'none').pull).toBe(0);
  });
});

describe('the time there is', () => {
  it('cuts extras first, then sets of the main lifts, and says what went', () => {
    const p = plan({ programId: 'mus-1', goal: 'muscle', minutes: 60 });
    const full = nextSession(p, [], body, defs, NOW)!;
    expect(full.cut).toBeUndefined();
    const short = nextSession({ ...p, minutes: 30 }, [], body, defs, NOW)!;
    expect(short.minutes).toBeLessThanOrEqual(30);
    expect(short.items.length).toBeLessThan(full.items.length);
    expect(short.items.filter((i) => i.main).length).toBe(full.items.filter((i) => i.main).length);
    expect(short.cut).toMatch(/^Cut to fit 30 min: .+ left out/);
    // A wave's sets are set week by week: never cut.
    const wave = nextSession(plan({ programId: 'str-4', days: 4, minutes: 20, maxes: { squat: 100 } }), [], body, defs, NOW)!;
    expect(wave.items.find((i) => i.exerciseId === 'squat')!.sets).toBe(3);
  });
  it('weights stay one per set when sets are cut', () => {
    const items = [{ exerciseId: 'a', name: 'A', sets: 5, reps: 5, main: true, weights: [100, 100, 100, 100, 100] }];
    const r = fitToTime(items, undefined, 20);
    expect(r.items[0].sets).toBe(3);
    expect(r.items[0].weights).toHaveLength(3);
    expect(sessionMinutes(r.items)).toBeGreaterThan(0);
  });
});

describe('moving on', () => {
  it('suggests the next programme once the level has passed this one', () => {
    const ws: Workout[] = [];
    for (let i = 60; i >= 1; i--) ws.push(workout(NOW - i * WEEK, [set('squat', 150, 1), set('bench', 100, 1), set('deadlift', 180, 1), set('ohp', 60, 1)]));
    const p = plan({});
    const m = readyToMoveOn(p, assessLevel(p, ws, body, NOW), ws, defs, NOW)!;
    expect(m.to.id).toBe('str-2');
    expect(m.reasons[0]).toMatch(/Intermediate/);
    expect(readyToMoveOn(p, assessLevel(p, [], body, NOW), [], defs, NOW)).toBeNull();
  });
});
