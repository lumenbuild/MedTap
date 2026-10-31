import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { goalOf, supplementAudit, verdictFor, verdicts } from '../src/logic/verdict';
import { doseDecision, earlyWarnings, todaysCalls, whatsWorking, type AllData } from '../src/logic/decisions';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (k: number, h = 8) => { const d = new Date(NOW - k * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'X', strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, archived: false, color: '', icon: '', createdAt: '', updatedAt: '', ...o } as Medication);
const dose = (m: string, k: number, o: Partial<Dose> = {}): Dose => ({ id: `${m}-${k}`, medicationId: m, takenAt: new Date(at(k)).toISOString(), amount: 1, source: 'manual', createdAt: '', updatedAt: '', ...o });
const empty = (): AllData => ({ meds: [], doses: [], checkIns: [], daily: [], body: [], experiments: [], workouts: [], foodLogs: [] });

describe('is it working?', () => {
  it('knows what each thing is for', () => {
    expect(goalOf(med({ name: 'Ritalin' }))).toBe('focus');
    expect(goalOf(med({ name: 'Retatrutide' }))).toBe('weight');
    expect(goalOf(med({ name: 'Magnesium glycinate' }))).toBe('deep');
    expect(goalOf(med({ name: 'Paracetamol' }))).toBeUndefined();
    expect(goalOf(med({ name: 'Paracetamol', judgeBy: 'soreness' }))).toBe('soreness');
  });
  it('a supplement taken some nights: deep sleep on nights after it against nights without', () => {
    const m = med({ id: 'mg', name: 'Magnesium', schedule: { type: 'prn' } as Medication['schedule'] });
    const d = empty(); d.meds = [m];
    for (let k = 1; k <= 40; k++) {
      const on = k % 2 === 0;
      if (on) d.doses.push(dose('mg', k, { takenAt: new Date(at(k, 20)).toISOString() }));
      // The night after a magnesium day has more deep sleep.
      d.daily.push({ id: `n${k}`, date: ymd(at(k - 1)), sleepDeepMin: (on ? 85 : 65) + (k % 3), createdAt: '', updatedAt: '' } as DailyHealth);
    }
    const v = verdictFor(m, d, NOW, S);
    expect(v).toMatchObject({ status: 'working', method: 'on-off', outcome: 'deep' });
    expect(v.evidence[0]).toMatch(/Deep sleep 1 h 2\d on days you do against 1 h 0\d/);
  });
  it('no measurable effect after enough days, with an on/off test to settle it', () => {
    const m = med({ id: 't', name: 'L-theanine', schedule: { type: 'prn' } as Medication['schedule'] });
    const d = empty(); d.meds = [m];
    for (let k = 1; k <= 50; k++) {
      if (k % 2) d.doses.push(dose('t', k));
      d.checkIns.push({ id: `c${k}`, at: new Date(at(k, 15)).toISOString(), chips: [], focus: 3 + (k % 3 === 0 ? 1 : 0), createdAt: '', updatedAt: '' } as CheckIn);
    }
    const v = verdictFor(m, d, NOW, S);
    expect(v.status).toBe('not-working');
    expect(v.experiment).toMatchObject({ a: 'L-theanine', metric: 'focus', blockDays: 7 });
    expect(supplementAudit(verdicts(d, NOW, S), d.doses, NOW).map((x) => x.med.id)).toEqual(['t']);
  });
  it('a weekly shot: judged by the weight trend since starting', () => {
    const m = med({ id: 'r', name: 'Retatrutide', unit: 'mg' });
    const d = empty(); d.meds = [m];
    for (let k = 60; k >= 0; k -= 7) d.doses.push(dose('r', k, { amount: 4 }));
    for (let k = 60; k >= 0; k -= 3) d.body.push({ id: `b${k}`, date: ymd(at(k)), weightKg: 100 - (60 - k) * 0.09, createdAt: '', updatedAt: '' } as BodyEntry);
    const v = verdictFor(m, d, NOW, S);
    expect(v).toMatchObject({ status: 'working', method: 'trend' });
    expect(v.evidence[0]).toMatch(/Losing 0\.6\d? kg a week/);
    expect(doseDecision(m, d, NOW, S)).toMatchObject({ call: 'stay' });
    // Flat for 4 weeks: stepping up becomes an option.
    d.body = d.body.map((b) => (new Date(`${b.date}T12:00`).getTime() > NOW - 30 * DAY ? { ...b, weightKg: 96 } : b));
    expect(doseDecision(m, d, NOW, S)?.call).toBe('step-up-option');
  });
  it('too early, and nothing to measure it by', () => {
    const d = empty();
    const m = med({ id: 'n', name: 'Ritalin' }); d.meds = [m]; d.doses = [dose('n', 3)];
    expect(verdictFor(m, d, NOW, S).status).toBe('too-early');
    const p = med({ id: 'p', name: 'Paracetamol' }); d.doses.push(dose('p', 30));
    expect(verdictFor(p, d, NOW, S).status).toBe('cant-measure');
  });
});

describe('decisions', () => {
  it('what goes with better and worse sleep, and one thing to try', () => {
    const d = empty();
    for (let k = 1; k <= 60; k++) {
      const late = k % 3 === 0;
      if (late) d.checkIns.push({ id: `cf${k}`, at: new Date(at(k, 16)).toISOString(), chips: ['Caffeine'], createdAt: '', updatedAt: '' } as CheckIn);
      d.daily.push({ id: `d${k}`, date: ymd(at(k - 1)), sleepMin: (late ? 380 : 440) + (k % 4) * 5, createdAt: '', updatedAt: '' } as DailyHealth);
    }
    const w = whatsWorking(d, NOW, S);
    expect(w.hurts[0]).toMatchObject({ key: 'late-caffeine', outcome: 'sleep', helps: false });
  });
  it('early warnings: training more while recovering less, and resting heart rate up on a medicine', () => {
    const d = empty();
    for (let k = 0; k < 40; k++) d.daily.push({ id: `d${k}`, date: ymd(at(k)), hrvMs: k < 7 ? 38 : 50, restingHr: k < 7 ? 63 : 58, createdAt: '', updatedAt: '' } as DailyHealth);
    const run = (k: number, min: number): Workout => ({ id: `w${k}`, startedAt: new Date(at(k)).toISOString(), endedAt: new Date(at(k)).toISOString(), sets: [], source: 'health', cardio: { activity: 'run', durationMin: min, avgHr: 150, maxHr: 185 }, createdAt: '', updatedAt: '' } as Workout);
    d.workouts = [...[8, 11, 14, 17, 20, 23, 26, 29, 32].map((k) => run(k, 30)), ...[1, 2, 3, 4, 5].map((k) => run(k, 70))];
    expect(earlyWarnings(d, NOW, S).map((x) => x.key)).toContain('overtraining');
  });
  it('today’s calls: training and a caffeine cut-off', () => {
    const d = empty();
    for (let k = 1; k < 30; k++) d.daily.push({ id: `d${k}`, date: ymd(at(k)), hrvMs: 50, restingHr: 58, sleepMin: 450, createdAt: '', updatedAt: '' } as DailyHealth);
    d.daily.push({ id: 'd0', date: ymd(at(0)), hrvMs: 52, restingHr: 57, sleepMin: 460, createdAt: '', updatedAt: '' } as DailyHealth);
    const calls = todaysCalls(d, NOW, S, { bedtime: '22:30', caffeineCutoff: '13:00', caffeineHalfLifeH: 5, energyTargetKcal: 2000, proteinTargetG: 150, lossRateKgWeek: 0.5 });
    expect(calls.map((c) => c.key)).toEqual(['train', 'caffeine', 'food']);
    expect(calls[1].title).toMatch(/Last caffeine by 1:00/);
    expect(calls[2].title).toBe('Eat about 2000 kcal and 150 g protein');
  });
});
