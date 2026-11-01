import { describe, it, expect } from 'vitest';
import type { BodyEntry, DailyHealth, FoodLog } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { calorieTarget, expenditure, proteinTarget } from '../src/logic/energy';
import { followUpResult, insights, type InsightInput } from '../src/logic/insights';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-30T10:00:00+11:00');
const st = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '' };
const ymd = (t: number) => new Date(t + 11 * 3_600_000).toISOString().slice(0, 10);
// 4 weeks: 1,900 Cal a day eaten, losing 0.5 kg a week.
const food: FoodLog[] = Array.from({ length: 28 }, (_, i) => ({ id: `f${i}`, at: new Date(NOW - (i + 1) * DAY).toISOString(), name: 'Day', servings: 1, nutrients: { kcal: 1900, protein: 90 }, ...st }));
const body: BodyEntry[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, date: ymd(NOW - (27 - i * 3) * DAY), weightKg: 90 - ((i * 3) / 7) * 0.5, ...st }));

describe('what you burn', () => {
  it('intake plus the energy the weight change stands for', () => {
    const e = expenditure(food, body, NOW, S)!;
    expect(e.intake).toBe(1900);
    expect(e.kgPerWeek).toBeCloseTo(-0.5, 1);
    expect(e.kcal).toBeGreaterThan(2400); // 1900 + 0.5 kg × 7700 / 7 ≈ 2450
    expect(e.kcal).toBeLessThan(2500);
  });
  it('needs two weeks of food and six weigh-ins', () => {
    expect(expenditure(food.slice(0, 10), body, NOW, S)).toBeNull();
    expect(expenditure(food, body.slice(0, 4), NOW, S)).toBeNull();
  });
  it('the target: the deficit for the rate, never a quarter under what you burn or under 1,200', () => {
    expect(calorieTarget({ kcal: 2450 }, 0.5).kcal).toBe(1900);
    expect(calorieTarget({ kcal: 2000 }, 1)).toEqual({ kcal: 1500, capped: true });
    expect(calorieTarget({ kcal: 1400 }, 0.5).kcal).toBe(1200);
  });
  it('protein: 1.6 g for each kg of the goal weight (or the weight now)', () => {
    expect(proteinTarget(100, 80)).toBe(130);
    expect(proteinTarget(70)).toBe(110);
    expect(proteinTarget(undefined)).toBeUndefined();
  });
});

const base = (o: Partial<InsightInput> = {}): InsightInput => ({
  meds: [], doses: [], checkIns: [], daily: [], body, vitals: [], workouts: [], events: [], foodLogs: food, appointments: [], goals: [],
  settings: { bedtime: '22:30', caffeineHalfLifeH: 5, fibreTargetG: 25, caffeineCutoff: null, proteinTargetG: null, energyTargetKcal: null, energyAuto: false, lossRateKgWeek: 0.5,
    mentionsDismissed: [], oddDismissed: [], insightsHidden: {}, followUps: [], targetChanges: [], targetAuto: {}, sleepTools: false, waterTargetMl: null, stepsTargetOwn: null, sleepTargetH: 8, caffeineLimitMg: 400 },
  units: 'metric', has: { body: true, food: true, training: true, meds: true }, ...o,
});

describe('insights', () => {
  it('a calorie target from what you burn, with a button that keeps it updated', () => {
    const cal = insights(base(), NOW, S).find((x) => x.kind === 'calories')!;
    expect(cal.headline).toMatch(/^About 1,9\d0 Cal a day loses 0.5 kg a week$/);
    expect(cal.action).toMatchObject({ kind: 'setting', key: 'energyAuto', value: true, followUp: { kind: 'calories' } });
    // Not again once it's on, or when the target is already about that.
    expect(insights(base({ settings: { ...base().settings, energyAuto: true } }), NOW, S).some((x) => x.kind === 'calories')).toBe(false);
    expect(insights(base({ settings: { ...base().settings, energyTargetKcal: 1950 } }), NOW, S).some((x) => x.kind === 'calories')).toBe(false);
  });
  it('protein enough to keep muscle, unless the target is already near it', () => {
    const p = insights(base(), NOW, S).find((x) => x.kind === 'protein')!;
    expect(p.action).toMatchObject({ key: 'proteinTargetG', value: 140 }); // 1.6 × ~88 kg
    expect(insights(base({ settings: { ...base().settings, proteinTargetG: 135 } }), NOW, S).some((x) => x.kind === 'protein')).toBe(false);
  });
  it('most important first, and one put away stays away', () => {
    const all = insights(base(), NOW, S);
    expect(all.map((x) => x.importance)).toEqual([...all.map((x) => x.importance)].sort((a, b) => b - a));
    const id = all[0].id;
    expect(insights(base({ settings: { ...base().settings, insightsHidden: { [id]: NOW + DAY } } }), NOW, S).some((x) => x.id === id)).toBe(false);
  });
});

describe('checking back', () => {
  it('sleep since a cut-off, against the weeks before', () => {
    const at = NOW - 21 * DAY;
    const daily: DailyHealth[] = Array.from({ length: 49 }, (_, i) => { const t = NOW - (48 - i) * DAY; return { id: `d${i}`, date: ymd(t), sleepMin: t < at ? 400 : 430, ...st }; });
    const r = followUpResult({ id: 'x', kind: 'cutoff', at, value: 14 }, base({ daily }), NOW)!;
    expect(r.headline).toBe('Since your 2 pm cut-off: sleep 6.7 h → 7.2 h');
    expect(r.tone).toBe('good');
    expect(followUpResult({ id: 'x', kind: 'cutoff', at: NOW - 5 * DAY, value: 14 }, base({ daily }), NOW)).toBeNull(); // too soon
  });
  it('weight since a calorie target', () => {
    const r = followUpResult({ id: 'y', kind: 'calories', at: NOW - 20 * DAY, value: 1900 }, base(), NOW)!;
    expect(r.headline).toMatch(/^Since your 1,900 Cal target: losing 0.5 kg a week$/);
  });
});
