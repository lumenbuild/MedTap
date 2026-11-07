// Set times that passed with nothing logged: Today asks "was it taken?" so the record can be fixed in one tap.
import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { getStatus, unloggedSlots, type ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const syd = (time: string, date = '2026-07-15') => {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
const med = (o: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50,
  schedule: { type: 'fixed', slots: [{ time: '07:30' }] }, color: '', icon: 'pill', archived: false, createdAt: '', updatedAt: '', ...o,
});
let n = 0;
const dose = (ms: number, o: Partial<Dose> = {}): Dose => ({ id: `d${++n}`, medicationId: 'm1', takenAt: new Date(ms).toISOString(), amount: 50, source: 'tag', createdAt: '', updatedAt: '', ...o });

describe('unloggedSlots', () => {
  it('a morning time with nothing logged, once its hour-long window has closed', () => {
    expect(unloggedSlots(med(), [], syd('08:29'), S)).toEqual([]); // still in the window: Today shows it as due
    const out = unloggedSlots(med(), [], syd('15:00'), S);
    expect(out).toEqual([{ at: syd('07:30'), amount: 50 }]);
    expect(getStatus(med(), [], syd('15:00'), S)).toBe('past-latest-time');
  });
  it('nothing once a dose (taken or skipped) covers the time', () => {
    expect(unloggedSlots(med(), [dose(syd('07:40'))], syd('15:00'), S)).toEqual([]);
    expect(unloggedSlots(med(), [dose(syd('07:30'), { skipped: true })], syd('15:00'), S)).toEqual([]);
  });
  it('a deleted dose does not count', () => {
    expect(unloggedSlots(med(), [dose(syd('07:40'), { deletedAt: 'x' })], syd('15:00'), S)).toHaveLength(1);
  });
  it('each set time on its own, with its own amount', () => {
    const m = med({ schedule: { type: 'fixed', slots: [{ time: '07:30', amount: 50 }, { time: '12:00', amount: 20 }, { time: '18:00', amount: 10 }] } });
    expect(unloggedSlots(m, [dose(syd('07:35'))], syd('15:00'), S)).toEqual([{ at: syd('12:00'), amount: 20 }]);
  });
  it('a dose logged outside the window but the day already complete: nothing to ask', () => {
    expect(unloggedSlots(med(), [dose(syd('10:00'))], syd('15:00'), S)).toEqual([]);
  });
  it('not before the medicine was added, not on days it is not scheduled, and not for other schedule kinds', () => {
    expect(unloggedSlots(med({ createdAt: new Date(syd('09:00')).toISOString() }), [], syd('15:00'), S)).toEqual([]);
    const weekly = med({ schedule: { type: 'fixed', slots: [{ time: '07:30' }], days: [(new Date(syd('12:00')).getUTCDay() + 1) % 7] } });
    expect(unloggedSlots(weekly, [], syd('15:00'), S)).toEqual([]);
    expect(unloggedSlots(med({ schedule: { type: 'prn' } }), [], syd('15:00'), S)).toEqual([]);
    expect(unloggedSlots(med({ archived: true }), [], syd('15:00'), S)).toEqual([]);
  });
  it('the day boundary: yesterday evening’s time is not asked about the next morning', () => {
    const m = med({ schedule: { type: 'fixed', slots: [{ time: '21:30' }] } });
    expect(unloggedSlots(m, [], syd('06:00', '2026-07-16'), S)).toEqual([]);
  });
});
