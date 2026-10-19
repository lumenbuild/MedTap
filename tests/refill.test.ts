import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { forecastRunOut, medOn, splitDueChanges } from '../src/logic/plans';
import { getDosesToday, getExpectedAmount, getLastDose, getNextDue, getStatus, type ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';
import { db } from '../src/db/db';
import { addPlannedChange, applyDuePlannedChanges, createMed, restock } from '../src/db/repos/meds';
import { logDose, removeDose } from '../src/db/repos/doses';
import { eraseAll } from '../src/db/repos/backup';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const syd = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
let n = 0;
const dose = (ms: number, amount: number, o: Partial<Dose> = {}): Dose => ({
  id: `d${++n}`, medicationId: 'm', takenAt: new Date(ms).toISOString(), amount, source: 'tag', createdAt: '', updatedAt: '', ...o,
});
const ritalin = (o: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 20,
  schedule: { type: 'interval', intervalHours: 4, doseAmounts: [20, 20, 10] }, color: '', icon: '', archived: false,
  createdAt: '', updatedAt: '', stockCount: 100, ...o,
});

describe('skipped doses', () => {
  const day = '2026-07-15';
  it('hold their place in the plan but are not the last dose taken', () => {
    const d1 = dose(syd(day, '07:00'), 20);
    const skip = dose(syd(day, '11:00'), 20, { skipped: true, skipReason: 'Felt unwell' });
    const m = ritalin();
    expect(getLastDose([d1, skip], 'm')?.id).toBe(d1.id);
    expect(getDosesToday([d1, skip], 'm', syd(day, '12:00'), S)).toHaveLength(2);
    expect(getExpectedAmount(m, [d1, skip], syd(day, '15:00'), S)).toBe(10); // the 3rd dose is next
    expect(getNextDue(m, [d1, skip], syd(day, '12:00'), S)).toBe(syd(day, '15:00')); // rhythm continues from the skip
  });
  it('a skipped set time counts as handled', () => {
    const m = ritalin({ schedule: { type: 'fixed', slots: [{ time: '08:00' }, { time: '20:00' }] } });
    const skip = dose(syd(day, '08:00'), 20, { skipped: true });
    expect(getStatus(m, [skip], syd(day, '09:30'), S)).toBe('not-due');
    expect(getNextDue(m, [skip], syd(day, '09:30'), S)).toBe(syd(day, '20:00'));
  });
});

describe('planned changes', () => {
  const m = ritalin({ plannedChanges: [
    { id: 'a', from: '2026-08-01', schedule: { type: 'interval', intervalHours: 4, doseAmounts: [20, 20, 15] }, defaultAmount: 20 },
    { id: 'b', from: '2026-08-15', schedule: { type: 'interval', intervalHours: 4, doseAmounts: [20, 20, 20] }, defaultAmount: 20 },
  ] });
  it('gives the schedule in force on any date', () => {
    expect(medOn(m, '2026-07-31').schedule.doseAmounts).toEqual([20, 20, 10]);
    expect(medOn(m, '2026-08-01').schedule.doseAmounts).toEqual([20, 20, 15]);
    expect(medOn(m, '2026-09-01').schedule.doseAmounts).toEqual([20, 20, 20]);
  });
  it('splits due from future', () => {
    const r = splitDueChanges(m, '2026-08-05');
    expect(r.due.map((c) => c.id)).toEqual(['a']);
    expect(r.future.map((c) => c.id)).toEqual(['b']);
  });
});

describe('refill forecast', () => {
  const day = '2026-07-15';
  it('follows the 20/20/10 plan: 5 tablets a day', () => {
    // 100 tablets at 6 am before any dose: today + 19 more days covered, runs out on day 20.
    const f = forecastRunOut(ritalin(), [], syd(day, '06:00'), S)!;
    expect(f.basis).toBe('plan');
    expect(f.daysLeft).toBe(20);
    expect(f.runOutAt).toBe(syd('2026-08-04', '04:00'));
  });
  it('counts only the rest of today once doses are taken', () => {
    const doses = [dose(syd(day, '07:00'), 20), dose(syd(day, '11:00'), 20)];
    const f = forecastRunOut(ritalin({ stockCount: 11 }), doses, syd(day, '12:00'), S)!;
    // 1 left today, then 5 + 5 = 10 → exactly 2 more days; the 3rd day runs short.
    expect(f.daysLeft).toBe(3);
  });
  it('uses planned changes', () => {
    const tapered = ritalin({ stockCount: 30, plannedChanges: [
      { id: 'x', from: '2026-07-17', schedule: { type: 'interval', intervalHours: 4, doseAmounts: [10] }, defaultAmount: 10 },
    ] });
    // 15th: 5, 16th: 5 (20 left), then 1 a day → 20 more days.
    expect(forecastRunOut(tapered, [], syd(day, '06:00'), S)!.daysLeft).toBe(22);
  });
  it('weekly injection: 2 a week', () => {
    const inj = ritalin({ strength: 2.5, defaultAmount: 2.5, stockCount: 4,
      schedule: { type: 'fixed', slots: [{ time: '08:00', amount: 2.5 }], days: [0, 3] } });
    // From Mon 13 Jul: Wed 15, Sun 19, Wed 22, Sun 26 → out on Wed 29 Jul.
    const f = forecastRunOut(inj, [], syd('2026-07-13', '10:00'), S)!;
    expect(f.runOutAt).toBe(syd('2026-07-29', '04:00'));
  });
  it('as needed: uses the last 30 days', () => {
    const prn = ritalin({ schedule: { type: 'prn' }, strength: 500, defaultAmount: 1000, stockCount: 20 });
    const doses = Array.from({ length: 14 }, (_, i) => dose(syd(day, '09:00') - i * 86_400_000, 1000));
    const f = forecastRunOut(prn, doses, syd(day, '12:00'), S)!;
    expect(f.basis).toBe('recent-use');
    expect(f.daysLeft).toBe(10); // 2 tablets a day
  });
  it('is null without a stock count', () => {
    expect(forecastRunOut(ritalin({ stockCount: undefined }), [], syd(day, '06:00'), S)).toBeNull();
  });
});

describe('database: planned changes, restock and skipping', () => {
  beforeEach(async () => { await eraseAll(); });
  const base = { name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 20, color: '', icon: 'pill',
    schedule: { type: 'interval' as const, intervalHours: 4, doseAmounts: [20, 20, 10] } };

  it('applies a planned change on its date and records it', async () => {
    const med = await createMed(base);
    await addPlannedChange(med.id, { from: '2026-08-01', schedule: { type: 'interval', intervalHours: 4, doseAmounts: [20, 20, 15] }, defaultAmount: 20 });
    expect(await applyDuePlannedChanges('2026-07-31', '04:00')).toBe(0);
    expect(await applyDuePlannedChanges('2026-08-01', '04:00')).toBe(1);
    const after = (await db.medications.get(med.id))!;
    expect(after.schedule.doseAmounts).toEqual([20, 20, 15]);
    expect(after.plannedChanges).toBeUndefined();
    const ev = (await db.medEvents.where('medicationId').equals(med.id).toArray()).find((e) => e.kind === 'changed')!;
    expect(ev.summary).toContain('20, 20, 10 mg → Every 4 hours: 20, 20, 15 mg');
  });

  it('restock adds stock and uses a repeat', async () => {
    const med = await createMed({ ...base, stockCount: 3, repeatsLeft: 2 });
    await restock(med.id, 100, true);
    const after = (await db.medications.get(med.id))!;
    expect(after.stockCount).toBe(103);
    expect(after.repeatsLeft).toBe(1);
  });

  it('skipping never changes stock, and undoing a skip neither', async () => {
    const med = await createMed({ ...base, stockCount: 50 });
    const d = await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 20, source: 'manual', skipped: true, skipReason: 'Drug holiday' });
    expect((await db.medications.get(med.id))!.stockCount).toBe(50);
    await removeDose(d.id);
    expect((await db.medications.get(med.id))!.stockCount).toBe(50);
  });
});

import { refillAlerts } from '../src/logic/reminders';

describe('refill alerts', () => {
  const now = syd('2026-07-15', '06:00');
  it('warns when the plan runs out within the warning window', () => {
    expect(refillAlerts([ritalin({ stockCount: 30 })], [], now, S, 7, {})[0]?.runningOut).toBe(true); // 6 days
    expect(refillAlerts([ritalin({ stockCount: 100 })], [], now, S, 7, {})).toHaveLength(0);
  });
  it('warns about a script expiring within 30 days, and respects dismiss until stock changes', () => {
    const m = ritalin({ stockCount: 100, scriptExpiry: '2026-08-01' });
    expect(refillAlerts([m], [], now, S, 7, {})[0]?.scriptExpiring).toBe(true);
    expect(refillAlerts([m], [], now, S, 7, { m: 100 })).toHaveLength(0);
    expect(refillAlerts([{ ...m, stockCount: 95 }], [], now, S, 7, { m: 100 })).toHaveLength(1);
  });
});
