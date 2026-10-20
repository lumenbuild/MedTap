import { describe, it, expect } from 'vitest';
import { planReminders, reminderId } from '../src/logic/notify';
import type { ScheduleSettings } from '../src/logic/schedule';
import type { Dose, Medication } from '../src/db/schema';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const med = (o: Partial<Medication>): Medication => ({
  id: 'm', name: 'Med', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, color: '', icon: 'pill', archived: false,
  schedule: { type: 'fixed', slots: [{ time: '08:00', amount: 20 }, { time: '20:00' }] }, createdAt: '', updatedAt: '', ...o,
});
const dose = (takenAt: string, medicationId = 'm'): Dose => ({ id: takenAt, medicationId, takenAt, amount: 20, source: 'manual', createdAt: takenAt, updatedAt: takenAt });
// 9:00 am Sydney on Wed 15 Jul 2026.
const NOW = Date.parse('2026-07-14T23:00:00Z');

describe('planReminders', () => {
  it('set times for the week, skipping times already logged', () => {
    const r = planReminders([med({})], [dose('2026-07-14T22:05:00Z')], NOW, S);
    expect(r).toHaveLength(14); // 8 pm today, 8 am and 8 pm for 6 more days, and 8 am a week from now
    expect(new Date(r[0].at).toISOString()).toBe('2026-07-15T10:00:00.000Z');
    expect(r[0].amount).toBe(10);
    expect(r[1].amount).toBe(20);
  });
  it('only scheduled days, nothing for archived or as-needed medications', () => {
    const weekly = med({ id: 'w', schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [0] } });
    const r = planReminders([weekly, med({ archived: true }), med({ id: 'p', schedule: { type: 'prn' } })], [], NOW, S);
    expect(r.map((x) => new Date(x.at).toISOString())).toEqual(['2026-07-18T22:00:00.000Z']); // Sunday 8 am
  });
  it('the next dose of an every-few-hours medication', () => {
    const m = med({ id: 'i', schedule: { type: 'interval', intervalHours: 4 } });
    const r = planReminders([m], [dose('2026-07-14T22:00:00Z', 'i')], NOW, S);
    expect(r).toEqual([{ id: reminderId('i', Date.parse('2026-07-15T02:00:00Z')), at: Date.parse('2026-07-15T02:00:00Z'), medId: 'i', amount: 10 }]);
  });
  it('stays within the phone limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => med({ id: `m${i}` }));
    expect(planReminders(many, [], NOW, S)).toHaveLength(60);
  });
});
