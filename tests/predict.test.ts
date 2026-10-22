import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, Dose, Medication, Supply } from '../src/db/schema';
import {
  appetiteCurve, bestShotDay, changeFlags, lateShots, needsByDate, sideEffectForecast, vialRest, weekFindings, weekRecords,
  weeklySummary, weightPath, basisText,
} from '../src/logic/predict';
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
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const dose = (ms: number, amount: number, o: Partial<Dose> = {}): Dose => ({
  id: `d${++n}`, medicationId: 'p', takenAt: iso(ms), amount, source: 'tag', createdAt: iso(ms), updatedAt: '', ...o,
});
const ci = (ms: number, o: Partial<CheckIn> = {}): CheckIn => ({ id: `c${++n}`, at: iso(ms), chips: [], createdAt: '', updatedAt: '', ...o });
const weigh = (ms: number, kg: number): BodyEntry => {
  const d = new Date(ms + 10 * 3_600_000).toISOString().slice(0, 10);
  return { id: `b${++n}`, date: d, weightKg: kg, createdAt: '', updatedAt: '' };
};
// Weekly on Wednesdays at 8 am; 10 mg vials with 2 mL.
const weekly = (over: Partial<Medication> = {}): Medication => ({
  id: 'p', name: 'Tirzepatide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 5,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [3] }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '',
  peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 100, halfLifeHours: 120, useWithinDays: 28 }, ...over,
});

// Ten Wednesdays: 1 Apr … 3 Jun 2026. 2.5 mg for four, then 5 mg.
const wednesdays = Array.from({ length: 10 }, (_, i) => syd('2026-04-01', '08:00') + i * 7 * DAY);
const shots = wednesdays.map((t, i) => dose(t, i < 4 ? 2.5 : 5));
// Check-ins on days 0–4 after each shot: nausea on days 1 and 2, appetite low early in the week and back by day 4.
const checkIns = wednesdays.flatMap((t) => [0, 1, 2, 3, 4].map((k) => ci(t + k * DAY + 10 * 3_600_000, {
  chips: k === 1 || k === 2 ? ['Nausea'] : [], appetite: [2, 1, 2, 3, 4][k], sleepHours: 7.5,
})));
const NOW = syd('2026-06-05', '12:00'); // Friday after the last shot

describe('day after the shot', () => {
  it('forecasts nausea on the days it usually comes', () => {
    const f = sideEffectForecast(weekly(), shots, checkIns, NOW, S)!;
    expect(f.days).toHaveLength(7);
    // Fri 5 Jun is day 2 after Wednesday's shot: nausea likely. Sat (day 3) clear. Thu 11 Jun is day 1 after the next.
    expect(f.days[0]).toMatchObject({ day: 2 });
    expect(f.days[0].likely.map((x) => x.chip)).toEqual(['Nausea']);
    expect(f.days[1].likely).toEqual([]);
    expect(f.days[6]).toMatchObject({ day: 1 });
    expect(f.days[6].likely[0]).toMatchObject({ chip: 'Nausea', pct: 100 });
    expect(f.atThisDose).toBe(true);
  });
  it('needs enough check-ins, and shots at least a few days apart', () => {
    expect(sideEffectForecast(weekly(), shots, checkIns.slice(0, 3), NOW, S)).toBeNull();
    const daily = Array.from({ length: 10 }, (_, i) => dose(syd('2026-05-20', '08:00') + i * DAY, 5));
    expect(sideEffectForecast(weekly(), daily, checkIns, NOW, S)).toBeNull();
  });
  it('appetite curve: low early in the week, back by day 4; today is day 2', () => {
    const c = appetiteCurve(weekly(), shots, checkIns, NOW)!;
    expect(c.days.slice(0, 5).map((d) => d.appetite)).toEqual([2, 1, 2, 3, 4]);
    expect(c.today).toBe(2);
    expect(c.todayAppetite).toBe(2);
  });
  it('best shot day keeps the hard days off the busy ones', () => {
    // Busy Mon and Tue: nausea comes 1–2 days after the shot, so a Wednesday shot keeps Mon/Tue clear; a Sunday shot doesn't.
    const b = bestShotDay(weekly(), shots, checkIns, [1, 2])!;
    expect(b.current).toBe(3);
    const sunday = b.options.find((o) => o.weekday === 0)!;
    expect(sunday.hardDays).toEqual([1, 2]);
    expect(b.options[0].score).toBe(0);
    expect(b.options.find((o) => o.weekday === 3)!.score).toBe(0);
    expect(bestShotDay(weekly({ schedule: { type: 'fixed', slots: [{ time: '08:00' }] } }), shots, checkIns, [1])).toBeNull();
  });
});

describe('weight path', () => {
  const body = Array.from({ length: 30 }, (_, i) => weigh(syd('2026-04-01') + i * 2 * DAY, 100 - i * 0.14)); // 0.49 kg a week down
  it('projects the current rate, with a range, and when it reaches a goal', () => {
    const p = weightPath(weekly(), shots, body, NOW, 12, 92)!;
    expect(p.perWeek).toBeCloseTo(-0.49, 1);
    expect(p.points).toHaveLength(13);
    expect(p.points[12].v).toBeCloseTo(p.level - 0.49 * 12, 0);
    expect(p.points[12].low).toBeLessThanOrEqual(p.points[12].v);
    expect(p.points[12].high).toBeGreaterThanOrEqual(p.points[12].v);
    expect(p.goal!.eta).toBeGreaterThan(NOW);
    expect(p.basis.weighIns).toBeGreaterThanOrEqual(5);
  });
  it("a planned step back to a dose they've had uses their own rate on it", () => {
    // Faster on 2.5 mg (first 4 weeks): 0.5 kg every 2 days. Then slower.
    const fast = [...Array.from({ length: 14 }, (_, i) => weigh(syd('2026-04-01') + i * 2 * DAY, 100 - i * 0.5)),
      ...Array.from({ length: 16 }, (_, i) => weigh(syd('2026-04-29') + i * 2 * DAY, 93 - i * 0.1))];
    const med = weekly({ plannedChanges: [{ id: 'c', from: '2026-06-20', schedule: weekly().schedule, defaultAmount: 2.5 }] });
    const p = weightPath(med, shots, fast, NOW, 8)!;
    expect(p.segments).toHaveLength(2);
    expect(p.segments[0].basis).toBe('current');
    expect(p.segments[1]).toMatchObject({ amount: 2.5, basis: 'this-dose' });
    expect(p.segments[1].perWeek).toBeLessThan(p.segments[0].perWeek);
  });
  it('needs 5 weigh-ins over a week', () => {
    expect(weightPath(weekly(), shots, body.slice(-3), NOW)).toBeNull();
  });
});

describe('rest of the vial', () => {
  it('stops at the last full dose, leaving what is short', () => {
    // Mixed 20 May: 10 mg. 2.5 mg taken → 7.5 left: 5 mg on 10 Jun, then 2.5 mg isn't enough for 17 Jun.
    const med = weekly({ vials: [{ id: 'v', status: 'in-use', amount: 10, waterMl: 2, addedAt: '', startedAt: iso(syd('2026-05-20')) }] });
    const ds = [dose(syd('2026-06-03', '08:00'), 2.5, { vialId: 'v' })];
    const r = vialRest(med, ds, NOW, S)!;
    expect(r).toMatchObject({ doses: 1, ends: 'empty', leftover: 2.5, nextAmount: 5 });
    expect(r.lastFullAt).toBe(syd('2026-06-10', '08:00'));
  });
  it('or at its use-by, with what will be past it', () => {
    const med = weekly({ defaultAmount: 2.5, vials: [{ id: 'v', status: 'in-use', amount: 10, waterMl: 2, addedAt: '', startedAt: iso(syd('2026-05-20')) }] });
    const r = vialRest(med, [], NOW, S)!; // use by 17 Jun; shots 10 and 17 Jun (8 am, before noon) fit
    expect(r.ends).toBe('use-by');
    expect(r.doses).toBe(2);
    expect(r.leftover).toBe(5);
  });
});

describe('needs by a date', () => {
  it('counts vials and syringes for the plan until the date', () => {
    const med = weekly({ stockCount: 1.5 });
    const at = iso(NOW - DAY);
    const sy: Supply = { id: 's', kind: 'syringes', base: { count: 2, at }, createdAt: '', updatedAt: '' };
    const r = needsByDate([med], [sy], [], NOW, syd('2026-07-05'), S); // 5 Wednesdays: 10 Jun … 1 Jul = 4 shots
    expect(r.meds[0]).toMatchObject({ need: 2, have: 1.5, short: 0.5, basis: 'plan' });
    expect(r.supplies[0]).toMatchObject({ need: 4, have: 2, short: 2 });
  });
});

describe('weeks and changes', () => {
  it('finds a clear difference by shot time, with weeks counted', () => {
    // Evening shots for 4 weeks with no nausea; morning shots for 4 weeks with nausea most days.
    const ds: Dose[] = [], cs: CheckIn[] = [];
    for (let i = 0; i < 8; i++) {
      const t = syd('2026-04-01', i < 4 ? '20:00' : '08:00') + i * 7 * DAY;
      ds.push(dose(t, 5));
      for (let k = 1; k <= 3; k++) cs.push(ci(t + k * DAY, { chips: i < 4 ? [] : ['Nausea'], appetite: 3 }));
    }
    const recs = weekRecords(weekly(), ds, cs, syd('2026-06-01'), S, 9);
    const f = weekFindings(recs).find((x) => x.factor === 'time')!;
    expect(f.a).toMatchObject({ label: 'Morning shots', weeks: 4, effectPct: 100 });
    expect(f.b).toMatchObject({ weeks: 4, effectPct: 0 });
  });
  it('flags side effects up on the batch in use', () => {
    const med = weekly({ vials: [
      { id: 'a', status: 'finished', amount: 10, lot: 'L1', addedAt: '', startedAt: iso(syd('2026-04-01')), finishedAt: iso(syd('2026-05-01')) },
      { id: 'b', status: 'in-use', amount: 10, lot: 'L2', addedAt: '', startedAt: iso(syd('2026-05-01')) },
    ] });
    const cs = [...Array.from({ length: 6 }, (_, i) => ci(syd('2026-04-05') + i * 3 * DAY)),
      ...Array.from({ length: 6 }, (_, i) => ci(syd('2026-05-05') + i * 3 * DAY, { chips: ['Nausea'] }))];
    const f = changeFlags(med, [], cs, [], NOW);
    expect(f.map((x) => x.kind)).toContain('lot-effects');
  });
  it('flags weight flattening and less sleep after a step up', () => {
    const body = [...Array.from({ length: 10 }, (_, i) => weigh(NOW - 42 * DAY + i * 2 * DAY, 100 - i * 0.2)),
      ...Array.from({ length: 10 }, (_, i) => weigh(NOW - 20 * DAY + i * 2 * DAY, 96))];
    const ds = [dose(NOW - 50 * DAY, 2.5), dose(NOW - 14 * DAY, 5)];
    const cs = [...Array.from({ length: 6 }, (_, i) => ci(NOW - 30 * DAY + i * DAY, { sleepHours: 8 })),
      ...Array.from({ length: 6 }, (_, i) => ci(NOW - 10 * DAY + i * DAY, { sleepHours: 6.5 }))];
    const kinds = changeFlags(weekly(), ds, cs, body, NOW).map((x) => x.kind);
    expect(kinds).toContain('weight-flat');
    expect(kinds).toContain('sleep-after-step');
  });
});

describe('late and missed shots', () => {
  it('finds a shot a day late and one missed, with the level lower than on time', () => {
    const ds = [
      dose(syd('2026-05-06', '08:00'), 5), dose(syd('2026-05-14', '09:00'), 5), /* 20 May missed */ dose(syd('2026-05-27', '08:00'), 5), dose(syd('2026-06-03', '08:30'), 5),
    ];
    const r = lateShots(weekly(), ds, [], NOW, S, 5)!;
    const late = r.events.find((e) => !e.missed)!;
    expect(late.hoursLate).toBeCloseTo(25, 0);
    expect(late.levelDropPct).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.missed).map((e) => e.plannedAt)).toContain(syd('2026-05-20', '08:00'));
    // Weeks before the first shot ever aren't missed.
    expect(r.events.every((e) => e.plannedAt >= syd('2026-05-06', '08:00'))).toBe(true);
    expect(weekRecords(weekly(), ds, [], NOW, S, 12).every((w) => w.start >= syd('2026-05-04', '00:00'))).toBe(true);
  });
});

describe('weekly summary', () => {
  it('counts shots on time, level range and stock', () => {
    const w = weeklySummary(weekly({ stockCount: 2 }), shots, checkIns, [], NOW, S);
    expect(w).toMatchObject({ shots: 1, planned: 1, onTime: 1 });
    expect(w.level!.max).toBeGreaterThan(w.level!.min);
    expect(w.stock!.runOutAt).not.toBeNull();
    expect(w.effectPct).toBeGreaterThan(0);
  });
  it('says what a result is based on', () => {
    expect(basisText({ weeks: 9, checkIns: 23 })).toBe('Based on 9 weeks, 23 check-ins');
  });
});
