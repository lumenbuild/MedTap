import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Vital } from '../src/db/schema';
import { parseScaleCsv, parseScaleScreen, planScaleImport } from '../src/logic/scaleImport';
import { apnoeaCheck, bodyClock, bpWithWeight, fitnessAge, rhrExplained, scaleWaterDrop, usualBands, visceralPath } from '../src/logic/healthChecks';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 2, 18, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ago = (k: number) => ymd(NOW - k * DAY);

const RENPHO = `Time of Measurement,Weight(kg),BMI,Body Fat(%),Fat-free Body Weight(kg),Subcutaneous Fat(%),Visceral Fat,Body Water(%),Skeletal Muscle(%),Muscle Mass(kg),Bone Mass(kg),Protein (%),BMR(kcal),Metabolic Age,Remarks
2026.11.02 06:41:10,116.2,38.4,39.8,69.9,33.1,15,43.6,34.2,66.4,3.6,13.8,2105,52,
2026.11.02 19:02:00,117.4,38.8,40.1,70.3,33.4,15,43.1,34.0,66.8,3.6,13.7,2112,53,
2026.11.01 06:30:00,116.6,38.5,39.9,70.1,33.2,15,43.5,34.1,66.5,3.6,13.8,2108,52,`;

describe('a smart scale export', () => {
  it('reads every measure from a Renpho CSV, one reading a day (the morning one)', () => {
    const rs = parseScaleCsv(RENPHO);
    expect(rs).toHaveLength(3);
    expect(rs[0].values).toEqual({ weightKg: 116.2, bodyFatPct: 39.8, leanKg: 69.9, subcutFatPct: 33.1, visceralFat: 15, waterPct: 43.6, skeletalMusclePct: 34.2,
      muscleKg: 66.4, boneKg: 3.6, proteinPct: 13.8, bmrKcal: 2105, metabolicAge: 52 });
    const plan = planScaleImport(rs, [], undefined);
    expect(plan.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02']);
    expect(plan[1].fields.weightKg).toBe(116.2); // 6:41 am, not the evening
    expect(plan[1].fields.compSource).toBe('scale');
  });
  it('fills only what a day lacks, and never replaces a weight', () => {
    const existing: BodyEntry[] = [{ id: 'x', date: '2026-11-02', weightKg: 116.0, bodyFatPct: 39.5, ...st }];
    const plan = planScaleImport(parseScaleCsv(RENPHO), existing, undefined);
    const day = plan.find((p) => p.date === '2026-11-02')!.fields;
    expect(day.weightKg).toBeUndefined();
    expect(day.bodyFatPct).toBeUndefined();
    expect(day.visceralFat).toBe(15);
  });
  it('pounds, day-month or month-day dates, and other column names', () => {
    const lb = `Date,Weight (lb),Body Fat (%),Muscle Mass (lb),Visceral Fat\n03/14/2026 7:31 AM,256.2,39.8,146.4,15\n03/20/2026 7:10 AM,255.0,39.6,146.0,15`;
    const rs = parseScaleCsv(lb);
    expect(rs[0].date).toBe('2026-03-14');
    expect(rs[0].values.weightKg).toBeCloseTo(116.2, 1);
    expect(rs[0].values.muscleKg).toBeCloseTo(66.4, 1);
    const dmy = parseScaleCsv(`Time,Weight(kg)\n14/03/2026 07:31,116.2\n02/04/2026 07:31,115.0`);
    expect(dmy.map((r) => r.date)).toEqual(['2026-03-14', '2026-04-02']);
    expect(parseScaleCsv('name,age\nbob,3')).toEqual([]);
  });
  it('a screenshot of a result screen, value beside or below the name', () => {
    const text = 'Renpho\nWeight\n116.2kg\nBMI 38.4\nBody Fat 39.8%\nFat-free Body Weight 69.9kg\nSubcutaneous Fat\n33.1%\nVisceral Fat 15\nBody Water 43.6%\nSkeletal Muscle 34.2%\nMuscle Mass 66.4kg\nBone Mass 3.6kg\nProtein 13.8%\nBMR 2105kcal\nMetabolic Age 52';
    const r = parseScaleScreen(text, '2026-11-02')!;
    expect(r.date).toBe('2026-11-02');
    expect(r.values).toMatchObject({ weightKg: 116.2, bodyFatPct: 39.8, leanKg: 69.9, subcutFatPct: 33.1, visceralFat: 15, waterPct: 43.6, muscleKg: 66.4, bmrKcal: 2105, metabolicAge: 52 });
    expect(parseScaleScreen('Hello\nnothing here', '2026-11-02')).toBeNull();
  });
});

const day = (k: number, o: Partial<DailyHealth>): DailyHealth => ({ id: `d${k}`, date: ago(k), ...st, ...o });
const weights = (from: number, perDay: number, days = 120): BodyEntry[] => Array.from({ length: days }, (_, k) => ({ id: `w${k}`, date: ago(k), weightKg: Math.round((from + perDay * k) * 10) / 10, ...st }));

describe('health checks', () => {
  it('sleep apnoea: risk factors and overnight oxygen dips', () => {
    const daily = Array.from({ length: 14 }, (_, k) => day(k, { spo2Min: k % 2 ? 86 : 90, spo2Avg: 94.5 }));
    const body: BodyEntry[] = [{ id: 'b', date: ago(1), weightKg: 116.5, neckCm: 44, ...st }];
    const a = apnoeaCheck({ daily, body, vitals: [], checkIns: [], meds: [], about: { heightCm: 178, birthYear: 1985, sex: 'm' } }, NOW)!;
    expect(a.items).toEqual(expect.arrayContaining(['BMI 36.8', 'Neck 44 cm', 'Male']));
    expect(a.nightSigns[0]).toMatch(/under 88% on 7 of 14 nights/);
    expect(a.level).toBe('high');
    expect(a.unknown[0]).toMatch(/snoring/);
  });
  it('blood pressure with the weight loss, and low readings on BP tablets for the prescriber', () => {
    const body = weights(110, 0.08);
    const vitals: Vital[] = Array.from({ length: 30 }, (_, i) => { const k = i * 4; return { id: `v${k}`, at: new Date(NOW - k * DAY).toISOString(), systolic: Math.round(118 + 0.08 * k * 1.2), diastolic: 72, ...st }; });
    const amlo: Medication = { id: 'a', name: 'Amlodipine', strength: 5, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st };
    const b = bpWithWeight({ vitals, body, checkIns: [], meds: [amlo] }, NOW)!;
    expect(b.perKg).toBeGreaterThan(0.8);
    expect(b.perKg).toBeLessThan(1.6);
    expect(b.kgLost).toBeGreaterThan(5);
    expect(b.lowOnTablets).toBeUndefined();
    const low: Vital[] = [...vitals, { id: 'l', at: new Date(NOW - DAY).toISOString(), systolic: 96, diastolic: 60, ...st }];
    expect(bpWithWeight({ vitals: low, body, checkIns: [], meds: [amlo] }, NOW)!.lowOnTablets).toContain('a reading under 100');
  });
  it('fitness age now and at the goal weight', () => {
    const daily = Array.from({ length: 10 }, (_, k) => day(k, { vo2max: 30 }));
    const f = fitnessAge(daily, weights(116.5, 0, 10), { birthYear: 1985, sex: 'm' }, 70, NOW)!;
    expect(f.fitnessAge).toBe(86); // (61.7 − 30) / 0.37
    expect(f.atGoal!.vo2).toBe(49.9); // 30 × 116.5 / 70
    expect(f.atGoal!.fitnessAge).toBe(32);
    expect(f.band).toBe('low');
  });
  it('resting heart rate: weight down, medicine up', () => {
    const reta: Medication = { id: 'r', name: 'Retatrutide', strength: 1, unit: 'mg', form: 'injection', defaultAmount: 2, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st };
    // Started six weeks ago (4 mg weekly), while the weight kept falling: each mg adds 1.2 bpm, each kg 0.25.
    const doses: Dose[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, medicationId: 'r', takenAt: new Date(NOW - i * 7 * DAY).toISOString(), amount: 4, source: 'manual', ...st }));
    const body = weights(108, 0.08);
    const daily = Array.from({ length: 110 }, (_, k) => { const kg = 108 + 0.08 * k; const on = k <= 35 ? 4 : 0; return day(k, { restingHr: Math.round(40 + 0.25 * kg + 1.2 * on + ((k * 7) % 3 - 1) * 0.5) }); });
    const r = rhrExplained({ daily, body, doses, meds: [reta] }, NOW)!;
    expect(r.change).toBeGreaterThan(2);
    const med = r.parts.find((p) => /GLP-1/.test(p.what))!;
    expect(med.bpm).toBeGreaterThan(3.8);
    expect(med.bpm).toBeLessThan(5.8);
    expect(r.parts.find((p) => /Weight/.test(p.what))!.bpm).toBeLessThan(-0.8); // weight down: heart rate down
  });
  it('body clock: weekend jet lag', () => {
    const daily: DailyHealth[] = [];
    for (let k = 1; k <= 28; k++) {
      const wake = new Date(NOW - k * DAY); const free = wake.getDay() === 0 || wake.getDay() === 6;
      wake.setHours(free ? 9 : 6, 30, 0, 0);
      daily.push(day(k, { sleepEnd: wake.getTime(), sleepStart: wake.getTime() - 7.5 * 3600_000 }));
    }
    const c = bodyClock(daily, [], NOW)!;
    expect(c.jetLagH).toBe(3);
    expect(c.score).toBeLessThan(40);
  });
  it('each reading against your own usual', () => {
    const daily = Array.from({ length: 30 }, (_, k) => day(k, { restingHr: k === 0 ? 70 : 60 + (k % 3), hrvMs: 40 + (k % 4) }));
    const b = usualBands({ daily, body: [], vitals: [] }, NOW);
    expect(b.find((x) => x.key === 'restingHr')).toMatchObject({ value: 70, state: 'high', higherBetter: false });
    expect(b.find((x) => x.key === 'hrvMs')!.state).toBe('usual');
  });
  it('visceral fat path, and running dry from the scale', () => {
    const body: BodyEntry[] = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, date: ago(i * 7), visceralFat: 15 + Math.round(i * 0.5), ...st }));
    const v = visceralPath(body, NOW)!;
    expect(v.band).toBe('very high');
    expect(v.perMonth).toBeLessThan(0);
    expect(v.healthyBy).toBeGreaterThan(NOW);
    const water: BodyEntry[] = [...Array.from({ length: 8 }, (_, k) => ({ id: `x${k}`, date: ago(k + 1), waterPct: 44, ...st })), { id: 't', date: ago(0), waterPct: 42.1, ...st }];
    expect(scaleWaterDrop(water, ago(0))).toMatch(/42.1%/);
    expect(scaleWaterDrop(water.slice(0, 8), ago(1))).toBeNull();
  });
});
