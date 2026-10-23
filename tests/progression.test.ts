import { describe, it, expect } from 'vitest';
import type { Workout, WorkoutSet } from '../src/db/schema';
import { BUILT_IN } from '../src/logic/exercises';
import { adjustAfterSet, capacity, e1rmWithRpe, effortCheck, loadFor, progressionPlan, smartTarget, weakDayToday } from '../src/logic/progression';
import { sessionsOf } from '../src/logic/training';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-01T08:00:00Z');
let n = 0;
const set = (exerciseId: string, weightKg: number, reps: number, rpe?: number): WorkoutSet => ({ id: `s${++n}`, exerciseId, weightKg, reps, done: true, ...(rpe !== undefined ? { rpe } : {}) });
const wk = (daysAgo: number, sets: WorkoutSet[]): Workout => ({ id: `w${++n}`, startedAt: new Date(NOW - daysAgo * DAY).toISOString(), sets, source: 'manual', createdAt: '', updatedAt: '' });
const ex = (id: string) => BUILT_IN.find((e) => e.id === id)!;
const three = (id: string, kg: number, reps: number, rpe?: number) => [0, 1, 2].map(() => set(id, kg, reps, rpe));

describe('smart progression', () => {
  it('RPE-aware estimated max and the load for 2 in reserve', () => {
    expect(e1rmWithRpe({ weightKg: 100, reps: 5, rpe: 8 })).toBeCloseTo(100 * (1 + 7 / 30));
    expect(loadFor(130, 5)).toBeCloseTo(130 / (1 + 7 / 30));
  });

  it('pushes more than one step when heavy sets felt easy', () => {
    const ws = [wk(4, three('squat', 100, 5, 6))];
    const t = smartTarget(ex('squat'), ws, { now: NOW });
    expect(t.why).toBe('push');
    expect(t.weightKg).toBe(105); // RPE 6 at 5 reps ≈ 130 max → 105 for 5 with 2 in reserve (two steps, capped at 5%)
    expect(t.plain?.weightKg).toBe(102.5);
    expect(t.reason).toMatch(/felt easy/);
  });

  it('the usual step when it was about right, and asks for a calibrating last set when no RPE is logged', () => {
    const t = smartTarget(ex('squat'), [wk(4, three('squat', 100, 5))], { now: NOW });
    expect(t).toMatchObject({ why: 'up', weightKg: 102.5, lastSetMax: true });
    const rated = smartTarget(ex('squat'), [wk(4, three('squat', 100, 5, 8))], { now: NOW });
    expect(rated.lastSetMax).toBe(false);
  });

  it('holds when the reps came but at the limit, on low readiness, and on a usual weaker day', () => {
    expect(smartTarget(ex('squat'), [wk(4, three('squat', 100, 5, 10))], { now: NOW })).toMatchObject({ why: 'same', weightKg: 100, reason: expect.stringMatching(/close to your limit/) });
    expect(smartTarget(ex('squat'), [wk(4, three('squat', 100, 5, 8))], { now: NOW, readiness: 40 })).toMatchObject({ why: 'hold', weightKg: 100 });
    expect(smartTarget(ex('squat'), [wk(4, three('squat', 100, 5, 8))], { now: NOW, weakDay: true })).toMatchObject({ why: 'hold', weightKg: 100 });
  });

  it('timed and bodyweight: a bigger jump when it was easy', () => {
    expect(smartTarget(ex('plank'), [wk(3, [set('plank', 0, 60, 6), set('plank', 0, 60, 6)])], { now: NOW })).toMatchObject({ why: 'push', reps: 70 });
    expect(smartTarget(ex('push-up'), [wk(3, three('push-up', 0, 15, 7))], { now: NOW })).toMatchObject({ why: 'push', reps: 17 });
  });

  it('a trend from several sessions, capped to a realistic weekly pace', () => {
    const ws = [12, 9, 6, 3].map((d, i) => wk(d, three('bench', 70 + i * 10, 5, 8))); // +10 kg every 3 days: unrealistic
    const c = capacity(sessionsOf('bench', ws), NOW)!;
    expect(c.perWeek / c.level).toBeLessThanOrEqual(0.0151);
  });

  it('adjusts the rest of a session after a set', () => {
    expect(adjustAfterSet(ex('bench'), set('bench', 60, 8, 6.5), 8)).toEqual({ weightKg: 62.5, text: 'Felt easy' });
    expect(adjustAfterSet(ex('bench'), set('bench', 60, 8, 10), 8)).toEqual({ weightKg: 57.5, text: 'Close to your limit' });
    expect(adjustAfterSet(ex('bench'), set('bench', 60, 5), 8)).toEqual({ weightKg: 57.5, text: 'Well short of the reps' });
    expect(adjustAfterSet(ex('bench'), set('bench', 60, 8, 8), 8)).toBeNull();
    expect(adjustAfterSet(ex('plank'), set('plank', 0, 30, 6), 30)).toBeNull();
  });

  it('plans the next sessions, dated by how often the lift is done', () => {
    const ws = [9, 6, 3].map((d) => wk(d, three('bench', 60, 8)));
    const p = progressionPlan(ex('bench'), ws, NOW);
    expect(p.everyDays).toBe(3);
    expect(p.steps.map((x) => x.weightKg)).toEqual([62.5, 65, 67.5, 70]);
  });

  it('says when there is room to push, or progress has stalled', () => {
    const easy = [14, 10, 6, 2].map((d) => wk(d, three('row', 60, 10, 6.5)));
    expect(effortCheck('row', easy, NOW).status).toBe('room');
    const flat = [60, 55, 50, 45, 40, 35, 25, 18, 11, 4].map((d, i) => wk(d, three('ohp', i < 6 ? 40 + i * 2 : 50, 5, 8)));
    expect(effortCheck('ohp', flat, NOW)).toMatchObject({ status: 'stalled' });
  });

  it('a usual weaker day after the shot', () => {
    const byDay = [{ day: 0, pct: 2 }, { day: 1, pct: -6 }, { day: 2, pct: 1 }];
    expect(weakDayToday(byDay, NOW - 1.2 * DAY, NOW)).toBe(true);
    expect(weakDayToday(byDay, NOW - 2.2 * DAY, NOW)).toBe(false);
  });
});
