// Real-world plans: different amounts within a day, specific weekdays, every N days.
import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import {
  getContextNotes, getDailyAmountTarget, getDailyTarget, getExpectedAmount, getNextDue, getStatus, isScheduledDay, type ScheduleSettings,
} from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';
import { stockUnitsFor } from '../src/logic/stock';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const syd = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
let n = 0;
const dose = (ms: number, amount: number, medicationId = 'm'): Dose => ({
  id: `d${++n}`, medicationId, takenAt: new Date(ms).toISOString(), amount, source: 'tag', createdAt: '', updatedAt: '',
});
const base = (over: Partial<Medication>): Medication => ({
  id: 'm', name: 'X', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'prn' },
  color: '', icon: '', archived: false, createdAt: '', updatedAt: '', ...over,
});

describe('Ritalin: 20 mg, then 20 mg 4 hours later, then 10 mg 4 hours after that (50 mg a day)', () => {
  const ritalin = base({ name: 'Ritalin', strength: 10, defaultAmount: 20, schedule: { type: 'interval', intervalHours: 4, doseAmounts: [20, 20, 10] } });
  const day = '2026-07-15'; // a Wednesday

  it('plans 3 doses and 50 mg a day', () => {
    expect(getDailyTarget(ritalin, syd(day, '08:00'), S)).toBe(3);
    expect(getDailyAmountTarget(ritalin, syd(day, '08:00'), S)).toBe(50);
  });

  it('prefills 20, 20, then 10 mg, and counts tablets', () => {
    const d1 = dose(syd(day, '07:00'), 20);
    const d2 = dose(syd(day, '11:00'), 20);
    expect(getExpectedAmount(ritalin, [], syd(day, '07:00'), S)).toBe(20);
    expect(getExpectedAmount(ritalin, [d1], syd(day, '11:00'), S)).toBe(20);
    expect(getExpectedAmount(ritalin, [d1, d2], syd(day, '15:00'), S)).toBe(10);
    expect(stockUnitsFor(ritalin, 20)).toBe(2);
    expect(stockUnitsFor(ritalin, 10)).toBe(1);
  });

  it('counts down every 4 hours and is done after the third', () => {
    const d1 = dose(syd(day, '07:00'), 20);
    const d2 = dose(syd(day, '11:00'), 20);
    const d3 = dose(syd(day, '15:00'), 10);
    expect(getNextDue(ritalin, [d1], syd(day, '08:00'), S)).toBe(syd(day, '11:00'));
    expect(getStatus(ritalin, [d1, d2], syd(day, '15:01'), S)).toBe('due');
    expect(getStatus(ritalin, [d1, d2, d3], syd(day, '15:05'), S)).toBe('done-today');
  });

  it('mentions a different amount from the plan, without blocking', () => {
    const d1 = dose(syd(day, '07:00'), 20);
    const d2 = dose(syd(day, '11:00'), 20);
    expect(getContextNotes(ritalin, [d1, d2], syd(day, '15:00'), S, 20)).toEqual([{ kind: 'amount', expected: 10 }]);
    expect(getContextNotes(ritalin, [d1, d2], syd(day, '15:00'), S, 10)).toEqual([]);
  });

  it('starts fresh the next day', () => {
    const doses = [dose(syd(day, '07:00'), 20), dose(syd(day, '11:00'), 20), dose(syd(day, '15:00'), 10)];
    expect(getExpectedAmount(ritalin, doses, syd('2026-07-16', '07:00'), S)).toBe(20);
    expect(getStatus(ritalin, doses, syd('2026-07-16', '06:00'), S)).toBe('none-today');
  });
});

describe('Injection: 2.5 mg on Sunday morning and Wednesday morning', () => {
  const inj = base({ name: 'Injection', form: 'injection', strength: 2.5, defaultAmount: 2.5,
    schedule: { type: 'fixed', slots: [{ time: '08:00', amount: 2.5 }], days: [0, 3] } });
  // 2026-07-12 is a Sunday, 2026-07-13 Monday, 2026-07-15 Wednesday.

  it('knows which days are scheduled', () => {
    expect(isScheduledDay(inj, syd('2026-07-12', '09:00'), S)).toBe(true);
    expect(isScheduledDay(inj, syd('2026-07-13', '09:00'), S)).toBe(false);
    expect(isScheduledDay(inj, syd('2026-07-15', '09:00'), S)).toBe(true);
    // 2 am Monday still belongs to Sunday's day (day starts at 4 am).
    expect(isScheduledDay(inj, syd('2026-07-13', '02:00'), S)).toBe(true);
  });

  it('on a Monday, is not scheduled today and counts down to Wednesday 8 am', () => {
    const now = syd('2026-07-13', '10:00');
    expect(getStatus(inj, [], now, S)).toBe('not-today');
    expect(getNextDue(inj, [], now, S)).toBe(syd('2026-07-15', '08:00'));
    expect(getDailyTarget(inj, now, S)).toBe(0);
  });

  it('on Sunday: counts down, is due, then done once logged, then points to Wednesday', () => {
    expect(getStatus(inj, [], syd('2026-07-12', '07:00'), S)).toBe('none-today');
    expect(getNextDue(inj, [], syd('2026-07-12', '07:00'), S)).toBe(syd('2026-07-12', '08:00'));
    expect(getStatus(inj, [], syd('2026-07-12', '08:20'), S)).toBe('due');
    const d = dose(syd('2026-07-12', '08:10'), 2.5);
    expect(getStatus(inj, [d], syd('2026-07-12', '08:30'), S)).toBe('done-today');
    expect(getNextDue(inj, [d], syd('2026-07-12', '08:30'), S)).toBe(syd('2026-07-15', '08:00'));
    expect(getExpectedAmount(inj, [], syd('2026-07-12', '08:00'), S)).toBe(2.5);
  });

  it('notes when logging on a day that is not scheduled', () => {
    expect(getContextNotes(inj, [], syd('2026-07-13', '10:00'), S, 2.5)).toEqual([{ kind: 'not-scheduled-day' }]);
  });
});

describe('Set times with different amounts in one day', () => {
  const med = base({ defaultAmount: 5, schedule: { type: 'fixed', slots: [{ time: '08:00', amount: 10 }, { time: '13:00', amount: 5 }, { time: '20:00' }] } });
  const day = '2026-07-15';
  it('prefills each set time’s own amount', () => {
    expect(getExpectedAmount(med, [], syd(day, '07:50'), S)).toBe(10);
    const d1 = dose(syd(day, '08:05'), 10);
    expect(getExpectedAmount(med, [d1], syd(day, '12:50'), S)).toBe(5);
    expect(getExpectedAmount(med, [d1, dose(syd(day, '13:00'), 5)], syd(day, '19:00'), S)).toBe(5); // falls back to usual dose
    expect(getDailyAmountTarget(med, syd(day, '09:00'), S)).toBe(20);
  });
});

describe('Every 14 days from a start date', () => {
  const med = base({ schedule: { type: 'fixed', slots: [{ time: '09:00' }], everyNDays: 14, startDate: '2026-07-01' } });
  it('is scheduled on the start date and every 14 days after', () => {
    expect(isScheduledDay(med, syd('2026-07-01', '12:00'), S)).toBe(true);
    expect(isScheduledDay(med, syd('2026-07-08', '12:00'), S)).toBe(false);
    expect(isScheduledDay(med, syd('2026-07-15', '12:00'), S)).toBe(true);
    expect(isScheduledDay(med, syd('2026-06-17', '12:00'), S)).toBe(false); // before the start
    expect(getNextDue(med, [], syd('2026-07-02', '12:00'), S)).toBe(syd('2026-07-15', '09:00'));
  });
});

describe('Every few hours, weekdays only', () => {
  const med = base({ schedule: { type: 'interval', intervalHours: 4, maxPerDay: 3, days: [1, 2, 3, 4, 5] } });
  it('is not scheduled on Saturday', () => {
    expect(getStatus(med, [], syd('2026-07-18', '09:00'), S)).toBe('not-today'); // Saturday
    expect(getStatus(med, [], syd('2026-07-17', '09:00'), S)).toBe('none-today'); // Friday
  });
});
