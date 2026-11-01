import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Food, FoodLog, Medication, Workout } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { COMMON_FOODS, searchCommon } from '../src/logic/commonFoods';
import { landing, landingPlan, leanForecast, weightTrend } from '../src/logic/bodyModel';
import { hydrationWatch, levers, proteinGap, sleepForecast } from '../src/logic/dailySmarts';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 1, 15, 0).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (daysAgo: number, h = 12) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const st = { createdAt: '', updatedAt: '' };
const med = (name: string, o: Partial<Medication> = {}): Medication => ({ id: name, name, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st, ...o });
const empty = { foodLogs: [] as FoodLog[], workouts: [] as Workout[], checkIns: [] as CheckIn[], daily: [] as DailyHealth[], doses: [] as Dose[], meds: [] as Medication[] };
// Losing 0.9 kg a week from 125 kg, with ±0.3 kg of daily noise.
const losing = (days = 60, perWeek = -0.9, noise = (k: number) => ((k * 7) % 5 - 2) * 0.15): BodyEntry[] =>
  Array.from({ length: days }, (_, i) => { const k = days - i; return { id: `w${k}`, date: ymd(at(k)), weightKg: Math.round((116.5 - (perWeek / 7) * k + noise(k)) * 10) / 10, ...st }; });

describe('common foods', () => {
  it('finds home-cooked dishes by everyday words', () => {
    expect(searchCommon('spag bol')[0].id).toBe('spag-bol');
    expect(searchCommon('curry').map((c) => c.id)).toContain('butter-chicken');
    expect(searchCommon('eggs')[0].group).toBe('Breakfast');
    expect(searchCommon('chook').map((c) => c.id)).toContain('roast-chicken');
    expect(searchCommon('zzz')).toEqual([]);
  });
  it('every food has sensible numbers', () => {
    for (const c of COMMON_FOODS) {
      const { kcal = 0, protein = 0, carbs = 0, fat = 0 } = c.n;
      // Energy from the macros within 25% of the stated calories (alcohol drinks aside).
      if (!['beer', 'wine', 'spirit-mixer'].includes(c.id) && kcal > 50) expect(Math.abs(protein * 4 + carbs * 4 + fat * 9 - kcal) / kcal).toBeLessThan(0.25);
    }
  });
});

describe('weight and body model', () => {
  it('the true weight and its rate, through the noise', () => {
    const tr = weightTrend({ ...empty, body: losing() }, NOW)!;
    expect(tr.perWeek).toBeGreaterThan(-1.1);
    expect(tr.perWeek).toBeLessThan(-0.7);
    expect(Math.abs(tr.trend - 116.5)).toBeLessThan(1);
  });
  it('explains a jump: a salty day and a strength session', () => {
    const body = losing();
    body[body.length - 1] = { ...body[body.length - 1], date: ymd(at(0)), weightKg: 118 };
    const salty: FoodLog = { id: 'f', at: new Date(at(1, 19)).toISOString(), name: 'Pizza', servings: 1, nutrients: { kcal: 1800, sodium: 4200, carbs: 200 }, ...st };
    const lift: Workout = { id: 'l', startedAt: new Date(at(1, 7)).toISOString(), sets: [{ id: 's', exerciseId: 'squat', weightKg: 60, reps: 8, done: true }], source: 'manual', ...st };
    const tr = weightTrend({ ...empty, body, foodLogs: [salty], workouts: [lift] }, NOW)!;
    expect(tr.off).toBeGreaterThan(0.5);
    expect(tr.causes.join(' ')).toMatch(/salty/);
    expect(tr.causes.join(' ')).toMatch(/strength/);
  });
  it('where the habits land: the plateau, the goal, and what it takes', () => {
    const tr = weightTrend({ ...empty, body: losing() }, NOW)!;
    const l = landing(tr, 2800, 70, NOW);
    // ~1,000 Cal a day deficit at 22 Cal per kg: a plateau about 45 kg lower.
    expect(l.plateauKg).toBeGreaterThan(65);
    expect(l.plateauKg).toBeLessThan(78);
    expect(l.maintenanceAtGoal).toBeGreaterThan(1600);
    expect(l.plan?.kcal).toBeGreaterThanOrEqual(1400);
    // A goal the plateau stays above is reported as not on this path.
    const slow = landing({ ...tr, perWeek: -0.3, perWeekLow: -0.4, perWeekHigh: -0.2 }, 2800, 70, NOW);
    expect(slow.goal?.reachable).toBe(false);
  });
  it('muscle in the coming loss: lower with strength training and protein', () => {
    const body: BodyEntry[] = [{ id: 'c', date: ymd(at(2)), weightKg: 116.5, bodyFatPct: 40, ...st }];
    const none = leanForecast(body, [], [], -0.9, 140, NOW)!;
    expect(none.share).toBeGreaterThan(0.15);
    expect(none.better).toBeLessThan(none.share);
    expect(none.levers[0]).toMatch(/strength/);
    const lifts = Array.from({ length: 10 }, (_, k): Workout => ({ id: `w${k}`, startedAt: new Date(at(k * 2 + 1, 7)).toISOString(), sets: [{ id: 's', exerciseId: 'squat', weightKg: 60, reps: 8, done: true }], source: 'manual', ...st }));
    expect(leanForecast(body, lifts, [], -0.9, 140, NOW)!.share).toBeLessThan(none.share);
  });
  it('a landing plan near the goal', () => {
    const near = losing(40, -0.5).map((b) => ({ ...b, weightKg: b.weightKg! - 42 }));
    const tr = weightTrend({ ...empty, body: near }, NOW)!;
    const l = landing(tr, 2200, 70, NOW);
    const p = landingPlan(tr, l, { daily: [], workouts: [], checkIns: [] }, NOW)!;
    expect(p).toBeTruthy();
    expect(p.steps.at(-1)!.kcal).toBe(p.maintenance);
    expect(p.risk).toBe('low');
    // Far from the goal: none yet.
    const far = weightTrend({ ...empty, body: losing() }, NOW)!;
    expect(landingPlan(far, landing(far, 2800, 70, NOW), { daily: [], workouts: [], checkIns: [] }, NOW)).toBeNull();
  });
});

describe('daily predictions', () => {
  it("tonight's sleep: shorter with caffeine still in you at bedtime, by your own nights", () => {
    const daily: DailyHealth[] = [], checkIns: CheckIn[] = [];
    for (let k = 1; k <= 30; k++) {
      const late = k % 2 === 0;
      daily.push({ id: `d${k}`, date: ymd(at(k - 1)), sleepMin: late ? 380 : 440, ...st }); // that night, recorded next morning
      if (late) checkIns.push({ id: `c${k}`, at: new Date(at(k, 17)).toISOString(), chips: ['Caffeine'], caffeineMg: 200, ...st });
    }
    checkIns.push({ id: 'today', at: new Date(at(0, 14)).toISOString(), chips: ['Caffeine'], caffeineMg: 200, ...st });
    const f = sleepForecast({ daily: daily.filter((x) => x.date !== ymd(at(0))), checkIns, foodLogs: [], doses: [], meds: [], bedtime: '22:30', halfLifeH: 5 }, NOW, S)!;
    expect(f.reasons[0].text).toMatch(/caffeine/);
    expect(f.reasons[0].min).toBeLessThan(-30);
    expect(f.minutes).toBeLessThan(f.usual);
  });
  it('closes the protein gap with high-protein foods that fit the calories left', () => {
    const foods: Food[] = [{ id: 'y', name: 'Chobani yoghurt', kind: 'product', nutrients: { kcal: 120, protein: 15 }, ...st }, { id: 'c', name: 'Chocolate', kind: 'product', nutrients: { kcal: 250, protein: 3 }, ...st }];
    const g = proteinGap(80, 140, 1300, 1700, foods, NOW, S)!;
    expect(g.gap).toBe(60);
    const p = g.picks.reduce((a, x) => a + x.protein, 0), k = g.picks.reduce((a, x) => a + x.kcal, 0);
    expect(p).toBeGreaterThanOrEqual(35);
    expect(k).toBeLessThanOrEqual(400);
    expect(g.picks.map((x) => x.name)).not.toContain('Chocolate');
    expect(proteinGap(130, 140, 1300, 1700, foods, NOW, S)).toBeNull(); // close enough
    // Only 100 Cal left: protein still wins, a little over the calories, and it says so.
    const tight = proteinGap(45, 140, 1700, 1800, foods, NOW, S)!;
    expect(tight.picks.reduce((a, x) => a + x.protein, 0)).toBeGreaterThanOrEqual(30);
    expect(tight.over).toBe(true);
  });
  it('signs of running dry need a body sign', () => {
    const reta = med('Retatrutide', { schedule: { type: 'fixed', slots: [{ time: '08:00' }], days: [1] } });
    const daily: DailyHealth[] = Array.from({ length: 14 }, (_, k) => ({ id: `r${k}`, date: ymd(at(k + 1)), restingHr: 62, ...st }));
    const today: DailyHealth = { id: 't', date: ymd(at(0)), restingHr: 70, waterMl: 500, ...st };
    const shot: Dose = { id: 's', medicationId: 'Retatrutide', takenAt: new Date(at(1, 8)).toISOString(), amount: 2, source: 'manual', ...st };
    const h = hydrationWatch({ daily: [...daily, today], body: [], checkIns: [], doses: [shot], meds: [reta] }, 2800, NOW, S)!;
    expect(h.signs.join(' ')).toMatch(/resting heart rate 70/);
    expect(h.signs.join(' ')).toMatch(/shot/);
    // Low water and a shot alone, no body sign: nothing.
    expect(hydrationWatch({ daily: [...daily, { ...today, restingHr: 62 }], body: [], checkIns: [], doses: [shot], meds: [reta] }, 2800, NOW, S)).toBeNull();
  });
  it('the biggest lever: muscle first when much of the loss is likely lean', () => {
    const body: BodyEntry[] = [{ id: 'c', date: ymd(at(2)), weightKg: 116.5, bodyFatPct: 40, ...st }];
    const lean = leanForecast(body, [], [], -1.4, 140, NOW);
    const tr = weightTrend({ ...empty, body: losing() }, NOW);
    const daily: DailyHealth[] = Array.from({ length: 14 }, (_, k) => ({ id: `s${k}`, date: ymd(at(k + 1)), steps: 5000, sleepMin: 420, ...st }));
    const ls = levers({ trend: tr, lean, daily, sleepTargetH: 8 }, NOW);
    expect(ls[0].title).toMatch(/muscle/i);
    expect(ls.map((l) => l.title).join(' ')).toMatch(/2,000 more steps/);
  });
});
