import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Vital, Workout } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { weightTrend } from '../src/logic/bodyModel';
import { cravingForecast, hungerWeek, muscleWarning, nextWeighIn, personalLevers, plateauAhead, shortNightEating } from '../src/logic/aheadSmarts';
import { bpWithWeight } from '../src/logic/healthChecks';

const S: ScheduleSettings = { dayStartsAt: '00:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 2, 19, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (k: number, h = 12) => { const d = new Date(NOW - k * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
const empty = { foodLogs: [] as FoodLog[], workouts: [] as Workout[], checkIns: [] as CheckIn[], daily: [] as DailyHealth[], doses: [] as Dose[], meds: [] as Medication[] };
const losing = (days = 60, perWeek = -0.9): BodyEntry[] => Array.from({ length: days }, (_, i) => { const k = days - i; return { id: `w${k}`, date: ymd(at(k)), weightKg: Math.round((116.5 - (perWeek / 7) * k + ((k * 7) % 5 - 2) * 0.12) * 10) / 10, ...st }; });
const meals = (k: number, kcal: number, o: Partial<FoodLog['nutrients']> = {}): FoodLog[] => [8, 13, 19].map((h, i) => ({ id: `f${k}-${i}`, at: new Date(at(k, h)).toISOString(), name: 'Meal', servings: 1, nutrients: { kcal: kcal / 3, sodium: 700, carbs: 70, ...o }, ...st }));
const reta: Medication = { id: 'r', name: 'Retatrutide', strength: 1, unit: 'mg', form: 'injection', defaultAmount: 4, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st };

describe('looking ahead', () => {
  it('a stall coming: steps down and eating more', () => {
    const tr = weightTrend({ ...empty, body: losing() }, NOW);
    const daily = Array.from({ length: 42 }, (_, k) => ({ id: `d${k}`, date: ymd(at(k)), steps: k < 14 ? 5000 : 9000, ...st }));
    const foodLogs = Array.from({ length: 42 }, (_, k) => meals(k + 1, k < 14 ? 2200 : 1800)).flat();
    const p = plateauAhead({ trend: tr, daily, foodLogs }, NOW, S)!;
    expect(p.level).toBe('high');
    expect(p.reasons.join(' ')).toMatch(/steps down about 4,000/);
    expect(p.fixes.join(' ')).toMatch(/9,000 a day/);
    // Holding steady: nothing.
    const flat = Array.from({ length: 42 }, (_, k) => ({ id: `d${k}`, date: ymd(at(k)), steps: 9000, ...st }));
    expect(plateauAhead({ trend: tr, daily: flat, foodLogs: Array.from({ length: 42 }, (_, k) => meals(k + 1, 1800)).flat() }, NOW, S)).toBeNull();
  });
  it("tomorrow's weigh-in: the trend a day on, plus a salty day's water", () => {
    const tr = weightTrend({ ...empty, body: losing() }, NOW)!;
    const plain = nextWeighIn({ trend: tr, foodLogs: [], workouts: [], checkIns: [], daily: [] }, NOW, S)!;
    expect(plain.mid).toBeCloseTo(tr.trend + tr.perWeek / 7, 1);
    expect(plain.hi - plain.lo).toBeGreaterThan(0.5);
    const usual = Array.from({ length: 10 }, (_, k) => meals(k + 1, 1800)).flat();
    const salty = nextWeighIn({ trend: tr, foodLogs: [...usual, ...meals(0, 2400, { sodium: 1700 })], workouts: [], checkIns: [], daily: [] }, NOW, S)!;
    expect(salty.mid).toBeGreaterThan(plain.mid);
    expect(salty.nudges[0]).toMatch(/salty/);
  });
  it('appetite back late in the shot week', () => {
    const doses: Dose[] = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, medicationId: 'r', takenAt: new Date(at(i * 7 + 3, 8)).toISOString(), amount: 4, source: 'manual', ...st }));
    const checkIns: CheckIn[] = [];
    for (let k = 1; k < 56; k++) { const dayOf = (k - 3 + 700) % 7; const since = (7 - dayOf) % 7; checkIns.push({ id: `c${k}`, at: new Date(at(k, 18)).toISOString(), chips: [], appetite: since >= 5 ? 4 : 2, ...st }); }
    const h = hungerWeek({ checkIns, foodLogs: [], doses, meds: [reta] }, NOW, S)!;
    expect(h.peakDays.every((d) => d >= 5)).toBe(true);
    expect(h.nextPeak).toBeGreaterThanOrEqual(new Date(NOW).setHours(0, 0, 0, 0));
  });
  it('after a short night you eat more', () => {
    const daily: DailyHealth[] = [], foodLogs: FoodLog[] = [];
    for (let k = 0; k < 30; k++) { const short = k % 3 === 0; daily.push({ id: `d${k}`, date: ymd(at(k)), sleepMin: short ? 330 : 450, ...st }); if (k) foodLogs.push(...meals(k, short ? 2300 : 1900)); }
    const n = shortNightEating({ daily, foodLogs }, NOW, S)!;
    expect(n.extra).toBe(400);
    expect(n.lastNightShort).toBe(true);
  });
  it('muscle going faster than it should, with why', () => {
    const body: BodyEntry[] = Array.from({ length: 10 }, (_, i) => { const k = i * 3.5; return { id: `b${i}`, date: ymd(at(k)), weightKg: 116.5 + k * 0.1, leanKg: 70 + k * 0.06, bodyFatPct: 40, ...st }; });
    const m = muscleWarning({ body, daily: [], workouts: [], proteinTarget: 150 }, NOW)!;
    expect(m.share).toBeCloseTo(0.6, 1);
    expect(m.reasons.join(' ')).toMatch(/no strength sessions/);
    const steady = body.map((b) => ({ ...b, leanKg: 70 }));
    expect(muscleWarning({ body: steady, daily: [], workouts: [], proteinTarget: 150 }, NOW)).toBeNull();
  });
  it('what one day is worth in days to the goal', () => {
    const tr = weightTrend({ ...empty, body: losing() }, NOW);
    const daily = Array.from({ length: 28 }, (_, k) => ({ id: `d${k}`, date: ymd(at(k)), steps: 5000, ...st }));
    const ls = personalLevers({ trend: tr, daily, foodLogs: Array.from({ length: 14 }, (_, k) => meals(k + 1, 2400)).flat(), target: 2000 }, NOW, S);
    expect(ls[0].what).toMatch(/calorie|Cal target|10,000/);
    const snack = ls.find((l) => /snack/.test(l.what))!;
    // 300 Cal a day for a month is about 1.2 kg; at ~0.13 kg a day lost, about 9 days sooner.
    expect(snack.days).toBeGreaterThan(7);
    expect(snack.days).toBeLessThan(11);
  });
  it('cravings: when they usually hit', () => {
    const checkIns: CheckIn[] = Array.from({ length: 8 }, (_, w) => ({ id: `c${w}`, at: new Date(at(w * 7, 20)).toISOString(), chips: ['Craving sweets'], ...st }));
    const c = cravingForecast({ checkIns, foodLogs: [] }, NOW)!;
    expect(c.usual.hour).toBe(20);
    expect(c.today?.hour).toBe(20);
  });
  it('blood pressure falling on tablets: a review before it gets low', () => {
    const body = losing(100);
    const vitals: Vital[] = Array.from({ length: 20 }, (_, i) => { const k = i * 4; return { id: `v${i}`, at: new Date(at(k, 8)).toISOString(), systolic: Math.round(120 + k * 0.15), diastolic: 75, ...st }; });
    const amlo: Medication = { ...reta, id: 'a', name: 'Amlodipine' };
    const b = bpWithWeight({ vitals, body, checkIns: [], meds: [amlo] }, NOW)!;
    expect(b.reviewBy).toBeGreaterThan(NOW + 30 * DAY);
    expect(b.reviewBy).toBeLessThan(NOW + 100 * DAY);
  });
});
