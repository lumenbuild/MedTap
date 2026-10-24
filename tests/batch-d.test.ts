import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Vital, Workout } from '../src/db/schema';
import { buildOf, newsOf } from '../src/app/updates';
import { repeatRequest, scriptVisits } from '../src/logic/records';
import { lastWeek, weeklyDigest } from '../src/logic/digest';
import { costSummary, monthlyPackCost, pricePerUnit } from '../src/logic/cost';
import { readingsWorthMentioning } from '../src/logic/readings';
import { BUILT_IN } from '../src/logic/exercises';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (date: string, time = '12:00') => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return zonedToUtc(y, m, d, h, mi, TZ); };
const ymd = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const stamp = { createdAt: '', updatedAt: '' };
const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', slots: [{ time: '07:30' }] }, color: '', icon: 'pill', archived: false, ...stamp, ...o });
const dose = (medicationId: string, t: number, amount: number, o: Partial<Dose> = {}): Dose => ({ id: `${medicationId}${t}`, medicationId, takenAt: new Date(t).toISOString(), amount, source: 'manual', ...stamp, ...o });

describe('updates', () => {
  it('reads the build and what is new', () => {
    expect(buildOf('MedTap for Android (build 42)')).toBe(42);
    expect(newsOf("What's new: Smart progression\n\nDownload MedTap.apk")).toBe('Smart progression');
  });
});

describe('scripts', () => {
  it('puts scripts needed close together on one visit, and writes a repeat request', () => {
    const now = syd('2026-09-01');
    const a = med({ id: 'a', stockCount: 10, repeatsLeft: 0, packSize: 30 }); // runs out ~11 Sep
    const b = med({ id: 'b', name: 'Dexamfetamine', strength: 5, defaultAmount: 5, stockCount: 30, repeatsLeft: 0, packSize: 30 }); // ~1 Oct
    const c = med({ id: 'c', name: 'Far', stockCount: 200, repeatsLeft: 0, packSize: 30 });
    const v = scriptVisits([a, b, c], [], now, S);
    expect(v[0].meds.map((x) => x.med.id)).toEqual(['a', 'b']);
    expect(v[1].meds.map((x) => x.med.id)).toEqual(['c']);
    expect(repeatRequest([a], 'Robin')).toContain('- Vyvanse 50 mg capsules');
  });
});

describe('weekly digest', () => {
  it('last week against the week before', () => {
    const now = syd('2026-09-02', '09:00'); // Wednesday
    const { start } = lastWeek(now, S);
    expect(new Date(start).toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'short' })).toBe('Mon');
    const m = med({});
    const doses: Dose[] = []; const body: BodyEntry[] = []; const checkIns: CheckIn[] = [];
    for (let i = 0; i < 14; i++) {
      const t = start - 7 * DAY + i * DAY + 4 * 3_600_000;
      if (i >= 7 || i % 2 === 0) doses.push(dose('m', t, 50)); // all last week, 4 of 7 the week before
      body.push({ id: `b${i}`, date: ymd(t), weightKg: 90 - (i >= 7 ? 0.8 : 0), ...stamp });
      checkIns.push({ id: `c${i}`, at: new Date(t + 3_600_000).toISOString(), chips: [], mood: i >= 7 ? 4 : 3, ...stamp });
    }
    const ws: Workout[] = [{ id: 'w1', startedAt: new Date(start - 3 * DAY).toISOString(), sets: [{ id: 's1', exerciseId: 'bench', weightKg: 60, reps: 8, done: true }], source: 'manual', ...stamp },
      { id: 'w2', startedAt: new Date(start + DAY).toISOString(), sets: [{ id: 's2', exerciseId: 'bench', weightKg: 65, reps: 8, done: true }], source: 'manual', ...stamp }];
    const d = weeklyDigest({ meds: [m], doses, checkIns, body, workouts: ws, daily: [], defs: BUILT_IN }, now, S, { units: 'metric', body: true, training: true })!;
    expect(d.lines.find((l) => l.key === 'doses')!.text).toBe('7 of 7 logged (100%), up from 57%');
    expect(d.lines.find((l) => l.key === 'weight')!.text).toMatch(/^down 0.8 kg/);
    expect(d.lines.find((l) => l.key === 'training')!.text).toMatch(/1 session, 1 personal best: Bench press: Heaviest: 65 kg × 8/);
    expect(d.lines.find((l) => l.key === 'mood')!.text).toBe('4 of 5, up from 3');
    // Leads with what went well: the personal best first.
    expect(d.headline).toMatch(/^A personal best: Bench press/);
    expect(d.wins[0]).toBe(d.headline);
  });
});

describe('cost', () => {
  it('per mg from each vial, spend, weekly rate and the plan', () => {
    const now = syd('2026-09-01');
    const m = med({ id: 't', name: 'Tirzepatide', strength: 10, unit: 'mg', defaultAmount: 5, schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1] },
      peptide: { kind: 'vial', waterMl: 2, syringe: 'U-100', syringeUnits: 100 },
      vials: [{ id: 'v1', status: 'finished', amount: 10, cost: 200, supplier: 'A', addedAt: '' }, { id: 'v2', status: 'in-use', amount: 10, cost: 150, supplier: 'B', addedAt: '' }] });
    expect(pricePerUnit(m, 'v1')).toBe(20);
    const doses = [dose('t', now - 21 * DAY, 5, { vialId: 'v1' }), dose('t', now - 14 * DAY, 5, { vialId: 'v1' }), dose('t', now - 7 * DAY, 5, { vialId: 'v2' }), dose('t', now - DAY, 5, { vialId: 'v2' })];
    const c = costSummary(m, doses, now, S)!;
    expect(c.spent).toBe(5 * 20 * 2 + 5 * 15 * 2);
    expect(c.perUnit).toBe(15);
    expect(c.perWeek).toBe(75);
    expect(c.next12Weeks).toBe(12 * 5 * 15);
    expect(c.cheapest!.map((x) => x.supplier)).toEqual(['B', 'A']);
    const tabs = med({ costPerUnit: 60, packSize: 30 });
    expect(monthlyPackCost(tabs, Array.from({ length: 28 }, (_, i) => dose('m', now - i * DAY - 1000, 50)), now)).toBeCloseTo(60.88, 1);
  });
});

describe('readings worth mentioning', () => {
  it('a week above your usual, and 140/90+', () => {
    const now = syd('2026-09-30');
    const v = (daysAgo: number, s: number, d: number): Vital => ({ id: `v${daysAgo}`, at: new Date(now - daysAgo * DAY).toISOString(), systolic: s, diastolic: d, ...stamp });
    const usual = [10, 14, 18, 22, 26, 30].map((x) => v(x, 118, 76));
    expect(readingsWorthMentioning([...usual, v(1, 131, 80), v(3, 129, 82), v(5, 130, 81)], [], now)[0].kind).toBe('bp');
    expect(readingsWorthMentioning([...usual, v(1, 145, 92), v(3, 142, 91), v(5, 141, 90)], [], now)[0].kind).toBe('bp-high');
    expect(readingsWorthMentioning([...usual, v(1, 120, 77), v(3, 119, 75), v(5, 121, 76)], [], now)).toEqual([]);
    const daily: DailyHealth[] = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, date: ymd(now - i * DAY), restingHr: i < 6 ? 70 : 60, ...stamp }));
    expect(readingsWorthMentioning([], daily, now)).toEqual([]); // heart rate shifts are in What changed
  });
});
