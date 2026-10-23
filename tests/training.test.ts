import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout, WorkoutSet } from '../src/db/schema';
import {
  cardioBests, e1rm, fitnessGoalStatus, muscleWatch, newPBs, nextTarget, personalBests, plateau, platesFor, readiness,
  strengthForecast, trainingCalendar, trainingVsPeptide, weeklyBalance,
} from '../src/logic/training';
import { BUILT_IN, allExercises } from '../src/logic/exercises';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (date: string, time = '18:00') => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return zonedToUtc(y, m, d, h, mi, TZ); };
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const set = (exerciseId: string, weightKg: number, reps: number, o: Partial<WorkoutSet> = {}): WorkoutSet => ({ id: `s${++n}`, exerciseId, weightKg, reps, done: true, ...o });
const wk = (t: number, sets: WorkoutSet[], o: Partial<Workout> = {}): Workout => ({ id: `w${++n}`, startedAt: iso(t), sets, source: 'manual', createdAt: '', updatedAt: '', ...o });
const squat = BUILT_IN.find((e) => e.id === 'squat')!;
const pushup = BUILT_IN.find((e) => e.id === 'push-up')!;
const NOW = syd('2026-08-03', '12:00');

describe('personal bests', () => {
  const ws = [
    wk(syd('2026-07-20'), [set('squat', 100, 5), set('squat', 100, 5), set('squat', 60, 10, { warmup: true })]),
    wk(syd('2026-07-27'), [set('squat', 105, 5), set('squat', 105, 4)]),
  ];
  it('heaviest, estimated max, reps at each weight, volume (warm-ups left out)', () => {
    const p = personalBests('squat', ws);
    expect(p.heaviest).toMatchObject({ kg: 105, reps: 5 });
    expect(p.e1rm!.v).toBeCloseTo(e1rm(105, 5), 1);
    expect(p.repsAt.find((x) => x.kg === 100)!.reps).toBe(5);
    expect(p.volume!.kg).toBe(1000);
  });
  it('finds new bests in a workout', () => {
    const w3 = wk(syd('2026-08-02'), [set('squat', 105, 7), set('squat', 105, 6)]);
    const kinds = newPBs(w3, [...ws, w3], BUILT_IN).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['e1rm', 'reps', 'volume']));
    expect(newPBs(ws[0], ws, BUILT_IN)).toEqual([]); // first time isn't a best
  });
});

describe('next session', () => {
  it('goes up when every set hit the reps and none was very hard', () => {
    const ws = [wk(syd('2026-07-27'), [set('squat', 100, 5, { rpe: 8 }), set('squat', 100, 5, { rpe: 8 }), set('squat', 100, 5, { rpe: 8.5 })])];
    expect(nextTarget(squat, ws, { exerciseId: 'squat', sets: 3, reps: 5 })).toMatchObject({ weightKg: 102.5, reps: 5, why: 'up' });
  });
  it('stays when a set was short or very hard; eases off after two short sessions', () => {
    const short = (t: number) => wk(t, [set('squat', 100, 5), set('squat', 100, 3), set('squat', 100, 3)]);
    expect(nextTarget(squat, [short(syd('2026-07-27'))], { exerciseId: 'squat', sets: 3, reps: 5 }).why).toBe('same');
    expect(nextTarget(squat, [short(syd('2026-07-20')), short(syd('2026-07-27'))], { exerciseId: 'squat', sets: 3, reps: 5 })).toMatchObject({ weightKg: 90, why: 'deload' });
  });
  it('bodyweight with no increment: a rep more', () => {
    const ws = [wk(syd('2026-07-27'), [set('push-up', 0, 15), set('push-up', 0, 15)])];
    expect(nextTarget(pushup, ws)).toMatchObject({ reps: 16, why: 'reps' });
  });
});

describe('plateaus and forecasts', () => {
  it('a lift flat for 3 weeks', () => {
    const ws = Array.from({ length: 8 }, (_, i) => wk(NOW - (7 - i) * 6 * DAY, [set('bench', i < 3 ? 70 + i * 2.5 : 75, 5)]));
    expect(plateau('bench', ws, NOW)).not.toBeNull();
  });
  it('rising estimated max: no plateau, and a forecast date for the goal', () => {
    const ws = Array.from({ length: 10 }, (_, i) => wk(NOW - (9 - i) * 5 * DAY, [set('bench', 60 + i * 2.5, 5)]));
    expect(plateau('bench', ws, NOW)).toBeNull();
    const f = strengthForecast('bench', ws, 110, NOW);
    expect(f.status).toBe('on-track');
    expect(f.eta).toBeGreaterThan(NOW);
  });
});

describe('weekly balance, calendar and goals', () => {
  it('sets per muscle, push/pull, upper/lower', () => {
    const ws = [wk(NOW - 2 * DAY, [set('bench', 60, 8), set('bench', 60, 8), set('row', 50, 8), set('squat', 80, 5)])];
    const b = weeklyBalance(ws, BUILT_IN, NOW);
    expect(b.byMuscle.find((m) => m.id === 'chest')!.sets).toBe(2);
    expect(b.byMuscle.find((m) => m.id === 'triceps')!.sets).toBe(1);
    expect(b).toMatchObject({ push: 2, pull: 1, upper: 3, lower: 1, sessions: 1 });
  });
  it('sessions a week and the streak', () => {
    const ws: Workout[] = [];
    for (let w = 0; w < 4; w++) for (let k = 0; k < 3; k++) ws.push(wk(syd('2026-07-06') + w * 7 * DAY + k * 2 * DAY, [set('squat', 80, 5)]));
    const c = trainingCalendar(ws, syd('2026-08-03', '09:00'), S, 3, 6);
    expect(c.weeks.slice(-5, -1).map((x) => x.sessions)).toEqual([3, 3, 3, 3]);
    expect(c.streak).toBe(4);
    expect(fitnessGoalStatus({ id: 'g', kind: 'sessions', perWeek: 3, setAt: '' }, ws, syd('2026-08-03', '09:00'), S, BUILT_IN).text).toMatch(/0 of 3 this week · 4 weeks in a row/);
  });
  it('a lift goal against the best estimated max', () => {
    const ws = [wk(NOW - DAY, [set('squat', 100, 3)])];
    const s = fitnessGoalStatus({ id: 'g', kind: 'lift', exerciseId: 'squat', targetKg: 100, reps: 1, setAt: '' }, ws, NOW, S, BUILT_IN);
    expect(s.done).toBe(true);
  });
});

describe('readiness, lean mass and the peptide', () => {
  it('readiness from sleep, resting heart rate and soreness against usual', () => {
    const daily: DailyHealth[] = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, date: new Date(NOW - (i + 1) * DAY + 10 * 3_600_000).toISOString().slice(0, 10), sleepMin: 450, restingHr: 58, createdAt: '', updatedAt: '' }));
    const today = new Date(NOW + 10 * 3_600_000).toISOString().slice(0, 10);
    const bad = readiness([...daily, { id: 't', date: today, sleepMin: 300, restingHr: 66, createdAt: '', updatedAt: '' }], [{ id: 'c', at: iso(NOW - 3_600_000), soreness: 4, chips: [], createdAt: '', updatedAt: '' } as CheckIn], NOW, S)!;
    const good = readiness([...daily, { id: 't', date: today, sleepMin: 480, restingHr: 56, createdAt: '', updatedAt: '' }], [], NOW, S)!;
    expect(bad.label).toBe('Take it easy');
    expect(good.label).toBe('Ready');
    expect(readiness([], [], NOW, S)).toBeNull();
  });
  it('how much of the weight lost was lean mass', () => {
    const body: BodyEntry[] = [
      { id: 'a', date: '2026-06-01', weightKg: 100, bodyFatPct: 35, createdAt: '', updatedAt: '' },
      { id: 'b', date: '2026-08-01', weightKg: 92, leanKg: 62, createdAt: '', updatedAt: '' },
    ];
    const w = muscleWatch(body);
    expect(w.overall).toMatchObject({ weightLost: 8, leanLost: 3, share: 0.38 });
  });
  it('strength by day after the shot', () => {
    const med: Medication = { id: 'p', name: 'Tirz', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 5, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [3] }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 100 } };
    const doses: Dose[] = []; const ws: Workout[] = [];
    for (let w = 0; w < 8; w++) {
      const shot = syd('2026-06-03', '08:00') + w * 7 * DAY;
      doses.push({ id: `d${w}`, medicationId: 'p', takenAt: iso(shot), amount: 5, source: 'tag', createdAt: '', updatedAt: '' });
      ws.push(wk(shot + 1 * DAY + 10 * 3_600_000, [set('squat', 92, 5)])); // day 1: weaker
      ws.push(wk(shot + 4 * DAY + 10 * 3_600_000, [set('squat', 100, 5)])); // day 4
    }
    const r = trainingVsPeptide(med, doses, ws)!;
    expect(r.byDay[1].pct!).toBeLessThan(0);
    expect(r.byDay[4].pct!).toBeGreaterThan(0);
    expect(r.bestDays).toEqual([4]);
  });
});

describe('plates and cardio', () => {
  it('plates for each side', () => {
    expect(platesFor(102.5)).toEqual({ perSide: [25, 15, 1.25], leftover: 0 });
    expect(platesFor(21, 20).leftover).toBe(1);
  });
  it('fastest 5 km from longer runs at their pace', () => {
    const ws = [wk(NOW - 3 * DAY, [], { cardio: { activity: 'run', distanceKm: 6, durationMin: 33 } }), wk(NOW - DAY, [], { cardio: { activity: 'run', distanceKm: 5, durationMin: 29 } })];
    const b = cardioBests(ws, 'run').find((x) => x.km === 5)!;
    expect(b.best!.min).toBeCloseTo(27.5, 1);
    expect(allExercises([{ id: 'x', name: 'Sled push', muscles: ['quads'], createdAt: '', updatedAt: '' }]).some((e) => e.name === 'Sled push')).toBe(true);
  });
});
