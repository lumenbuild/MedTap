import { describe, it, expect } from 'vitest';
import type { DailyHealth, Dose, FoodLog, Medication, Workout } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { illnessWatch, nightVitals } from '../src/logic/vitals';
import { countsAsSession, readiness, trainingCalendar } from '../src/logic/training';
import { daySuggestion, maxHeartRate, trainingLoad, vo2Trend, workoutLoad } from '../src/logic/trainingLoad';
import { medEffects } from '../src/logic/medEffects';
import { energyBalance } from '../src/logic/energy';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const day = (k: number, o: Partial<DailyHealth> = {}): DailyHealth => ({ id: `d${k}`, date: ymd(NOW - k * DAY), restingHr: 58, hrvMs: 50, respRate: 14, spo2Avg: 96.5, skinTempDelta: 0, sleepMin: 450, createdAt: '', updatedAt: '', ...o });
const month = (o: (k: number) => Partial<DailyHealth> = () => ({})) => Array.from({ length: 30 }, (_, i) => day(i + 1, o(i + 1)));

describe('overnight vitals and the illness watch', () => {
  it('last night against your usual', () => {
    const v = nightVitals([...month(), day(0, { restingHr: 64, respRate: 15.8 })], NOW, S)!;
    const rhr = v.stats.find((x) => x.key === 'restingHr')!;
    expect(rhr).toMatchObject({ value: 64, usual: 58, diff: 6, ok: false });
    expect(v.stats.find((x) => x.key === 'spo2Avg')).toMatchObject({ value: 96.5, ok: true });
  });
  it('several signals off together, and two nights running makes it likely', () => {
    expect(illnessWatch([...month(), day(0)], NOW, S)).toBeNull();
    const one = illnessWatch([...month(), day(0, { skinTempDelta: 0.7, restingHr: 65 })], NOW, S)!;
    expect(one.level).toBe('watch');
    expect(one.signals).toEqual(['Skin temperature +0.7 °C', 'Resting heart rate +7 bpm']);
    const two = illnessWatch([...month((k) => (k === 1 ? { skinTempDelta: 0.6, respRate: 16 } : {})), day(0, { skinTempDelta: 0.7, restingHr: 65 })], NOW, S)!;
    expect(two.level).toBe('likely');
  });
  it('readiness drops with a warm, fast-breathing night', () => {
    const calm = readiness([...month(), day(0)], [], NOW, S)!;
    const off = readiness([...month(), day(0, { skinTempDelta: 0.8, respRate: 16, spo2Avg: 93 })], [], NOW, S)!;
    expect(off.score).toBeLessThan(calm.score - 20);
    expect(off.parts.map((p) => p.what)).toEqual(expect.arrayContaining(['Breathing rate', 'Skin temperature', 'Blood oxygen']));
  });
});

describe('training load', () => {
  const run = (k: number, o: Partial<Workout['cardio']> = {}): Workout => ({ id: `w${k}`, startedAt: new Date(NOW - k * DAY).toISOString(), endedAt: new Date(NOW - k * DAY).toISOString(), sets: [], source: 'health',
    cardio: { activity: 'run', durationMin: 40, avgHr: 150, maxHr: 180, ...o }, createdAt: '', updatedAt: '' } as Workout);
  it('time in zones from the minute-by-minute heart rate', () => {
    const w = run(1, { hrMin: [100, 120, 130, 145, 155, 165, 175, null, 182], durationMin: 9 });
    const l = workoutLoad(w, 190)!;
    // 50/60/70/80/90% of 190: 95, 114, 133, 152, 171
    expect(l.minutesInZone).toEqual([1, 2, 1, 2, 2]);
    expect(l.load).toBe(1 + 4 + 3 + 8 + 10);
    expect(maxHeartRate([w], NOW)).toBe(182);
  });
  it('this week against the four before, and what today suits', () => {
    const steady = Array.from({ length: 35 }, (_, i) => i).filter((k) => k % 3 === 0).map((k) => run(k + 1));
    const t = trainingLoad(steady, NOW)!;
    expect(t.status).toBe('Steady');
    const spike = trainingLoad([...steady, ...[1, 2, 3, 4, 5].map((k) => run(k, { durationMin: 90 }))], NOW)!;
    expect(spike.status).toBe('Spiking');
    expect(daySuggestion({ score: 80, label: 'Ready', parts: [] }, spike, null)?.kind).toBe('easy');
    expect(daySuggestion({ score: 80, label: 'Ready', parts: [] }, t, null)?.kind).toBe('push');
    expect(daySuggestion({ score: 80, label: 'Ready', parts: [] }, t, { level: 'watch', signals: [], date: '' })?.kind).toBe('rest');
  });
  it('no comparison when the weeks before had training in only two of four (a few odd sessions are not "usual")', () => {
    const l = trainingLoad([run(19), run(18), run(10), run(9), run(8), ...[0, 1, 2, 3, 4, 5].map((k) => run(k, { durationMin: 60 }))], NOW);
    expect(l?.ratio).toBeUndefined();
    expect(l?.status).toBeUndefined();
  });
  it('walks the watch picks up are not training sessions', () => {
    const walk = run(1, { activity: 'walk', durationMin: 40 });
    const ride = run(2, { activity: 'ride', durationMin: 40 });
    expect(countsAsSession(walk)).toBe(false);
    expect(countsAsSession(ride)).toBe(true);
    expect(countsAsSession({ ...walk, source: 'manual' })).toBe(true); // a walk logged on purpose
    const cal = trainingCalendar([walk, { ...walk, id: 'w9', startedAt: new Date(NOW - 3_600_000).toISOString() }], NOW, S, 3, 2);
    expect(cal.thisWeek).toBe(0);
  });
  it('no comparison when watch workouts have only just started coming in', () => {
    // A few sessions logged in the app before; this week the watch's workouts arrive for the first time.
    const before = [8, 15, 22].map((k) => ({ ...run(k), source: 'manual' as const, cardio: undefined, sets: [{ exerciseId: 'squat', reps: 5, weightKg: 60 }] as Workout['sets'] }));
    const l = trainingLoad([...before, ...[1, 2, 3, 4, 5].map((k) => run(k, { durationMin: 60 }))], NOW);
    expect(l?.ratio).toBeUndefined();
    expect(daySuggestion(null, l, null)).toBeNull();
  });
  it('VO2 max now and two months ago', () => {
    const v = vo2Trend([day(60, { vo2max: 41 }), day(30, { vo2max: 42.5 }), day(1, { vo2max: 43.2 })], NOW)!;
    expect(v).toMatchObject({ value: 43.2, change: 2.2 });
  });
});

describe('medicine effects', () => {
  it('what moved after starting, against the usual spread', () => {
    const med = { id: 'm', name: 'Reta', unit: 'mg', schedule: { type: 'fixed' }, archived: false } as Medication;
    const start = NOW - 40 * DAY;
    const doses = [{ id: 'x', medicationId: 'm', takenAt: new Date(start).toISOString(), amount: 1, source: 'manual', createdAt: '', updatedAt: '' } as Dose];
    const daily = Array.from({ length: 70 }, (_, i) => {
      const t = NOW - (69 - i) * DAY, on = t >= start;
      return { id: `r${i}`, date: ymd(t), restingHr: (on ? 66 : 59) + (i % 3) - 1, hrvMs: 50 + (i % 4) - 2, steps: 8000 + (i % 5) * 100, createdAt: '', updatedAt: '' } as DailyHealth;
    });
    const e = medEffects(med, doses, daily, NOW)!;
    expect(e.checked).toBe(3);
    expect(e.effects).toEqual([expect.objectContaining({ key: 'restingHr', before: 59, after: 66, diff: 7, better: false })]);
  });
});

describe('energy balance', () => {
  it('burned by the watch against eaten, here or in another app', () => {
    const daily = Array.from({ length: 14 }, (_, i) => ({ date: ymd(NOW - (i + 1) * DAY), kcalTotal: 2500, ...(i % 2 ? { foodOtherKcal: 2000 } : {}) }));
    const logs: FoodLog[] = Array.from({ length: 14 }, (_, i) => i % 2 ? null : ({ id: `f${i}`, at: new Date(NOW - (i + 1) * DAY).toISOString(), nutrients: { kcal: 2100 }, createdAt: '', updatedAt: '' } as unknown as FoodLog)).filter(Boolean) as FoodLog[];
    const e = energyBalance(daily, logs, NOW, S)!;
    expect(e.balanceDays).toBe(14);
    expect(e.avgBurned).toBe(2500);
    expect(e.avgEaten).toBe(2050);
    expect(e.avgBalance).toBe(-450);
    expect(e.kgIn4Weeks).toBe(-1.6);
    expect(e.watchMaintenance).toBe(2500);
  });
});
