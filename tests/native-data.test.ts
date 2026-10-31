import { describe, it, expect } from 'vitest';
import type { BodyEntry, DailyHealth, Medication, Vital, Workout } from '../src/db/schema';
import { shortcutItems, widgetData } from '../src/logic/widgets';
import { planHealthImport } from '../src/logic/healthImport';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const syd = (date: string, time = '12:00') => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return zonedToUtc(y, m, d, h, mi, TZ); };
const med = (o: Partial<Medication>): Medication => ({
  id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, color: '', icon: 'pill', archived: false,
  schedule: { type: 'fixed', slots: [{ time: '07:30' }] }, createdAt: '', updatedAt: '', ...o,
});

describe('widget and shortcuts', () => {
  it('the next dose with a countdown, and as-needed buttons', () => {
    const meds = [med({}), med({ id: 'p', name: 'Panadol', schedule: { type: 'prn' } }), med({ id: 'n', name: 'Secret', nickname: 'Morning one', schedule: { type: 'fixed', slots: [{ time: '20:00' }] } })];
    const w = widgetData('MedTap', meds, [], syd('2026-08-03', '06:00'), S);
    expect(w).toMatchObject({ label: 'Next', title: 'Vyvanse', dueAt: syd('2026-08-03', '07:30'), logId: 'm' });
    expect(w.prn).toEqual([{ id: 'p', name: 'Panadol' }]);
    const due = widgetData('MedTap', meds, [], syd('2026-08-03', '07:40'), S);
    expect(due.label).toBe('Due now');
    expect(shortcutItems(meds).map((x) => x.label)).toEqual(['Log Vyvanse', 'Log Morning one', 'Log Panadol']);
  });
});

describe('health import', () => {
  it('updates daily rows, skips days with a weigh-in, and readings already logged', () => {
    const daily: DailyHealth[] = [{ id: 'x', date: '2026-08-01', steps: 100, sleepMin: 420, createdAt: '', updatedAt: '' }];
    const body: BodyEntry[] = [{ id: 'b', date: '2026-08-01', weightKg: 90, createdAt: '', updatedAt: '' }];
    const vitals: Vital[] = [{ id: 'v', at: new Date(syd('2026-08-02', '08:00')).toISOString(), systolic: 120, diastolic: 80, createdAt: '', updatedAt: '' }];
    const plan = planHealthImport({
      days: [{ date: '2026-08-01', steps: 8000 }, { date: '2026-08-02', steps: 5000, restingHr: 61, hrByHour: Array(24).fill(70) }],
      weights: [{ t: syd('2026-08-01', '07:00'), kg: 89.6 }, { t: syd('2026-08-02', '07:00'), kg: 89.44 }, { t: syd('2026-08-02', '19:00'), kg: 90.1 }],
      bp: [{ t: syd('2026-08-02', '08:02'), sys: 121, dia: 81 }, { t: syd('2026-08-02', '20:00'), sys: 118, dia: 79 }],
    }, { daily, body, vitals }, undefined, TZ, '2026-08-03T00:00:00Z');
    expect(plan.daily[0]).toMatchObject({ id: 'x', steps: 8000, sleepMin: 420 });
    expect(plan.daily[1]).toMatchObject({ steps: 5000, restingHr: 61 });
    expect(plan.body).toEqual([{ date: '2026-08-02', kg: 90.1 }]);
    expect(plan.vitals.map((v) => v.systolic)).toEqual([118]);
  });

  it('imports workouts once, body fat and lean mass where missing, and heart rate variability', () => {
    const body: BodyEntry[] = [{ id: 'b', date: '2026-08-02', weightKg: 90, bodyFatPct: 30, createdAt: '', updatedAt: '' }];
    const workouts: Workout[] = [{ id: 'w', startedAt: new Date(syd('2026-08-02', '06:02')).toISOString(), sets: [], cardio: { activity: 'run', durationMin: 30 }, source: 'health', deletedAt: 'x', createdAt: '', updatedAt: '' }];
    const daily: DailyHealth[] = [{ id: 'x', date: '2026-08-02', proteinG: 120, createdAt: '', updatedAt: '' }];
    const plan = planHealthImport({
      days: [{ date: '2026-08-02', hrvMs: 48 }], weights: [], bp: [],
      workouts: [
        { t: syd('2026-08-02', '06:00'), end: syd('2026-08-02', '06:30'), type: 'run', km: 5 }, // deleted before: stays deleted
        { t: syd('2026-08-03', '07:00'), end: syd('2026-08-03', '07:45'), type: 'ride', km: 20.123 },
        { t: syd('2026-08-03', '12:00'), end: syd('2026-08-03', '12:05'), type: 'walk' }, // too short
        { t: syd('2026-08-03', '18:00'), end: syd('2026-08-03', '19:00'), type: 'strength' },
      ],
      bodyFat: [{ t: syd('2026-08-02', '07:00'), pct: 29 }, { t: syd('2026-08-03', '07:00'), pct: 28.44 }],
      lean: [{ t: syd('2026-08-02', '07:00'), kg: 63.04 }],
    }, { daily, body, vitals: [], workouts }, undefined, TZ, 'now');
    expect(plan.cardio).toEqual([
      { at: new Date(syd('2026-08-03', '07:00')).toISOString(), activity: 'ride', durationMin: 45, distanceKm: 20.12 },
      // A strength session not logged in the app comes in by name.
      { at: new Date(syd('2026-08-03', '18:00')).toISOString(), activity: 'other', durationMin: 60, title: 'Strength training' },
    ]);
    expect(plan.comp).toEqual([{ date: '2026-08-02', leanKg: 63 }, { date: '2026-08-03', bodyFatPct: 28.4 }]);
    expect(plan.daily[0]).toMatchObject({ hrvMs: 48, proteinG: 120 });
  });
});
