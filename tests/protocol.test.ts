import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, Dose, Medication, Supply } from '../src/db/schema';
import { lotStats, plannedDoses, projectedLevel, stepReport, stockPlan, supplyPlans, weekStrip } from '../src/logic/protocol';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (date: string, time = '12:00') => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
let n = 0;
const dose = (ms: number, amount: number, o: Partial<Dose> = {}): Dose => ({
  id: `d${++n}`, medicationId: 'p', takenAt: new Date(ms).toISOString(), amount, source: 'tag', createdAt: new Date(ms).toISOString(), updatedAt: '', ...o,
});
// A weekly injection on Wednesdays at 8 am: 10 mg vials mixed with 2 mL, 2.5 mg a dose.
const weekly = (over: Partial<Medication> = {}): Medication => ({
  id: 'p', name: 'Tirzepatide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 2.5,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [3] }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '',
  peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 100, halfLifeHours: 120 }, ...over,
});

describe('week strip', () => {
  const friday = syd('2026-07-17'); // Wed 15 July is the shot day
  it('Monday to Sunday, with the shot day taken', () => {
    const w = weekStrip(weekly(), [dose(syd('2026-07-15', '08:05'), 2.5)], friday, S);
    expect(w.map((d) => d.label).join('')).toBe('MTWTFSS');
    expect(w[2]).toMatchObject({ planned: 1, taken: 1, state: 'taken' });
    expect(w.filter((d) => d.state === 'off')).toHaveLength(6);
    expect(w[4].isToday).toBe(true);
  });
  it('a missed shot day, and one skipped on purpose', () => {
    expect(weekStrip(weekly(), [], friday, S)[2].state).toBe('missed');
    expect(weekStrip(weekly(), [dose(syd('2026-07-15', '08:00'), 2.5, { skipped: true })], friday, S)[2].state).toBe('skipped');
  });
  it('daily with 5 days on, 2 off: off days stay off, later days are upcoming', () => {
    const med = weekly({ schedule: { type: 'fixed', slots: [{ time: '08:00' }], cycle: { on: 5, off: 2, start: '2026-07-13' } } });
    const w = weekStrip(med, [], syd('2026-07-14'), S);
    expect(w.map((d) => d.state)).toEqual(['missed', 'today', 'upcoming', 'upcoming', 'upcoming', 'off', 'off']);
  });
});

describe('stock and supplies', () => {
  const now = syd('2026-07-13'); // Monday
  it('runs out following the plan, including a planned dose increase; order a week before', () => {
    // 2 vials of 10 mg = 20 mg. 2.5 mg for 2 weeks (5 mg), then 5 mg a week: 15 mg lasts 3 more weeks.
    const med = weekly({ stockCount: 2, plannedChanges: [{ id: 'c', from: '2026-07-27', schedule: weekly().schedule, defaultAmount: 5 }] });
    const p = stockPlan(med, [], now, S);
    expect(new Date(p.forecast!.runOutAt!).toISOString().slice(0, 10)).toBe('2026-08-18'); // Wed 19 Aug (Sydney) has no stock
    expect(p.orderBy).toBe(p.forecast!.runOutAt! - 7 * DAY);
    expect(stockPlan({ ...med, peptide: { ...med.peptide!, leadTimeDays: 14 } }, [], now, S).leadDays).toBe(14);
  });
  it('syringes run out and the sharps container fills, from the daily injections planned', () => {
    const daily = weekly({ schedule: { type: 'fixed', slots: [{ time: '08:00' }] } });
    const at = new Date(now - DAY).toISOString();
    const sup = (o: Partial<Supply>): Supply => ({ id: o.kind!, kind: 'syringes', base: { count: 3, at }, createdAt: '', updatedAt: '', ...o } as Supply);
    const [syringes, sharps, water] = supplyPlans([sup({ kind: 'syringes' }), sup({ kind: 'sharps', capacity: 10, base: { count: 8, at } }), sup({ kind: 'water', base: { count: 1, at } })], [daily], [], now, S);
    // Nothing is logged yet today, so today's dose still counts.
    expect(new Date(syringes.runOutAt!).toISOString().slice(0, 10)).toBe('2026-07-15'); // 3 last today, tomorrow and Wed: out on Thu (Sydney)
    expect(syringes.orderBy).toBe(syringes.runOutAt! - 7 * DAY);
    expect(sharps.runOutAt).not.toBeNull();
    expect(sharps.orderBy).toBeNull();
    // 0.5 mL of water a dose (a quarter of a 10 mg vial mixed with 2 mL): 1 mL covers today and tomorrow, out on Wed (Sydney).
    expect(new Date(water.runOutAt!).toISOString().slice(0, 10)).toBe('2026-07-14');
  });
});

describe('estimated level through the plan', () => {
  const now = syd('2026-07-13');
  it('the planned weekly doses, and a level carried forward', () => {
    const planned = plannedDoses(weekly(), [], now, now + 28 * DAY, S);
    expect(planned).toHaveLength(4);
    expect(planned[0].t).toBe(syd('2026-07-15', '08:00'));
    const lv = projectedLevel(weekly(), [dose(syd('2026-07-08', '08:00'), 2.5)], now, S, now - 14 * DAY, now + 28 * DAY);
    expect(lv.past.length).toBeGreaterThan(10);
    expect(lv.future.length).toBeGreaterThan(10);
    expect(Math.max(...lv.future.map((p) => p.v))).toBeGreaterThan(Math.max(...lv.past.map((p) => p.v)));
  });
});

describe('batches and dose steps', () => {
  const ci = (date: string, o: Partial<CheckIn>): CheckIn => ({ id: `c${++n}`, at: new Date(syd(date)).toISOString(), chips: [], createdAt: '', updatedAt: '', ...o });
  const w = (date: string, kg: number, waist?: number): BodyEntry => ({ id: `b${++n}`, date, weightKg: kg, waistCm: waist, createdAt: '', updatedAt: '' });
  const med = weekly({
    vials: [
      { id: 'v1', status: 'finished', amount: 10, waterMl: 2, lot: 'A1', supplier: 'Acme', addedAt: '', startedAt: new Date(syd('2026-06-01')).toISOString(), finishedAt: new Date(syd('2026-06-29')).toISOString() },
      { id: 'v2', status: 'in-use', amount: 10, waterMl: 2, lot: 'B7', addedAt: '', startedAt: new Date(syd('2026-06-29')).toISOString() },
    ],
    lotFlags: [{ lot: 'B7', note: 'Seemed weak', at: '' }],
  });
  const doses = [
    ...[3, 10, 17, 24].map((d) => dose(syd(`2026-06-${String(d).padStart(2, '0')}`, '08:00'), 2.5)),
    ...['2026-07-01', '2026-07-08'].map((d) => dose(syd(d, '08:00'), 5)),
  ];
  const body = [w('2026-06-02', 100, 110), w('2026-06-28', 98, 107), w('2026-07-12', 97.5, 106)];
  const checkIns = [ci('2026-06-05', { appetite: 2, chips: ['Nausea'] }), ci('2026-06-20', { appetite: 3, chips: [] }), ci('2026-07-03', { appetite: 1, chips: ['Nausea', 'Tired'] })];
  const now = syd('2026-07-13');

  it('per batch: doses, weight per week and check-ins while its vials were in use, and its flag', () => {
    const [b7, a1] = lotStats(med, doses, body, checkIns, now);
    expect(a1).toMatchObject({ lot: 'A1', supplier: 'Acme', vials: 1, doses: 4, appetite: 2.5, checkIns: 2 });
    expect(a1.perWeek).toBeCloseTo(-0.54, 1);
    expect(b7).toMatchObject({ lot: 'B7', doses: 2, appetite: 1, flag: { note: 'Seemed weak' } });
  });
  it('per dose step: weeks, weight and waist per week, appetite and side effects', () => {
    const [s1, s2] = stepReport(med, doses, body, checkIns, now);
    expect(s1).toMatchObject({ dose: 2.5, doses: 4, checkIns: 2, appetite: 2.5 });
    expect(s1.weeks).toBeCloseTo(4, 0);
    expect(s1.weightPerWeek).toBeLessThan(0);
    expect(s1.waistPerWeek).toBeLessThan(0);
    expect(s1.sideEffects).toEqual([{ chip: 'Nausea', n: 1, pct: 50 }]);
    expect(s2).toMatchObject({ dose: 5, doses: 2 });
    expect(s2.sideEffects.map((x) => x.chip)).toEqual(['Nausea', 'Tired']);
  });
});
