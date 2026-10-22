import { describe, it, expect } from 'vitest';
import type { BodyEntry, DailyHealth, Dose, Medication, Vital } from '../src/db/schema';
import { shortcutItems, widgetData } from '../src/logic/widget';
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
});
