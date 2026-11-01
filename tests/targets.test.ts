import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Medication } from '../src/db/schema';
import { DEFAULT_SETTINGS } from '../src/db/repos/settings';
import { currentTarget, differs, fmtTarget, isAuto, suggestTargets } from '../src/logic/targets';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 1, 12, 0).getTime();
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const st = { createdAt: '', updatedAt: '' };
const weigh = (kg: number): BodyEntry[] => [{ id: 'w', date: ymd(NOW - DAY), weightKg: kg, ...st }];
const med = (name: string): Medication => ({ id: name, name, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st });
const base = { daily: [] as DailyHealth[], workouts: [], meds: [] as Medication[], doses: [], checkIns: [] as CheckIn[], now: NOW };

describe('targets', () => {
  it('water from weight, a little more for a very active month', () => {
    expect(suggestTargets({ ...base, body: weigh(90) }).water?.value).toBe(3150);
    const active = Array.from({ length: 20 }, (_, k): DailyHealth => ({ id: `a${k}`, date: ymd(NOW - (k + 1) * DAY), kcalActive: 800, ...st }));
    expect(suggestTargets({ ...base, body: weigh(90), daily: active }).water?.value).toBe(3400);
    expect(suggestTargets({ ...base, body: [] }).water?.value).toBe(2500);
  });
  it('protein from the goal weight when it is lower', () => {
    expect(suggestTargets({ ...base, body: weigh(100), goalKg: 80 }).protein?.value).toBe(130);
    expect(suggestTargets({ ...base, body: weigh(100) }).protein?.value).toBe(160);
  });
  it('fibre follows calories, between 25 and 35 g', () => {
    expect(suggestTargets({ ...base, body: [], calorieKcal: 2200 }).fibre?.value).toBe(31);
    expect(suggestTargets({ ...base, body: [], calorieKcal: 1400 }).fibre?.value).toBe(25);
  });
  it('sleep from nights before best-energy days, in half hours', () => {
    const daily: DailyHealth[] = [], checkIns: CheckIn[] = [];
    for (let k = 1; k <= 30; k++) {
      const date = ymd(NOW - k * DAY);
      daily.push({ id: `s${k}`, date, sleepMin: k % 2 ? 7.5 * 60 : 6 * 60, ...st });
      checkIns.push({ id: `c${k}`, at: new Date(`${date}T15:00`).toISOString(), chips: [], energy: k % 2 ? 5 : 2, ...st });
    }
    expect(suggestTargets({ ...base, body: [], daily, checkIns }).sleep?.value).toBe(7.5);
    expect(suggestTargets({ ...base, body: [] }).sleep?.value).toBe(8);
  });
  it('caffeine: 300 mg with a stimulant, else 400', () => {
    expect(suggestTargets({ ...base, body: [], meds: [med('Ritalin')] }).caffeine?.value).toBe(300);
    expect(suggestTargets({ ...base, body: [], meds: [med('Vitamin D')] }).caffeine?.value).toBe(400);
  });
  it('automatic until the person sets their own', () => {
    const s = { ...DEFAULT_SETTINGS };
    expect(isAuto(s, 'water')).toBe(true);
    expect(isAuto({ ...s, waterTargetMl: 3000 }, 'water')).toBe(false); // set by hand before targets were automatic
    expect(isAuto({ ...s, waterTargetMl: 3000, targetAuto: { water: true } }, 'water')).toBe(true);
    expect(isAuto({ ...s, fibreTargetG: 25 }, 'fibre')).toBe(true);
    expect(isAuto({ ...s, stepsTargetOwn: 9000 }, 'steps')).toBe(false);
    expect(currentTarget({ ...s, stepsTargetOwn: null }, 'steps', { steps: { key: 'steps', value: 8500, why: '', parts: [], stack: [] } })).toBe(8500);
  });
  it('only changes when it matters, and reads well', () => {
    expect(differs('water', 2500, 2600)).toBe(false);
    expect(differs('water', 2500, 2900)).toBe(true);
    expect(fmtTarget('water', 2900)).toBe('2.9 L');
    expect(fmtTarget('water', 3000)).toBe('3 L');
    expect(fmtTarget('sleep', 7.5)).toBe('7 h 30 min');
  });
  it('the stack changes targets, and says what changed them', () => {
    const reta = { ...med('Retatrutide'), schedule: { type: 'fixed' as const, slots: [{ time: '08:00' }], days: [1] } };
    const w = suggestTargets({ ...base, body: weigh(90), meds: [reta] }).water!;
    expect(w.value).toBe(3650); // 3,150 + 500
    expect(w.stack).toEqual(['Retatrutide']);
    expect(w.parts.join(' ')).toMatch(/\+500 mL for Retatrutide/);
    // Reta and Ritalin and creatine together.
    const all = suggestTargets({ ...base, body: weigh(90), meds: [reta, med('Ritalin'), med('Creatine monohydrate')] }).water!;
    expect(all.value).toBe(4400);
    // A diuretic: the prescriber's fluid advice comes first; no extra pushed.
    const diu = suggestTargets({ ...base, body: weigh(90), meds: [reta, med('Furosemide')] }).water!;
    expect(diu.value).toBe(3150);
    expect(diu.why).toMatch(/prescriber/);
    // Fibre up for a GLP-1; protein never under 1.2 g per kg of today's weight.
    expect(suggestTargets({ ...base, body: weigh(90), meds: [reta], calorieKcal: 2000 }).fibre?.value).toBe(33);
    expect(suggestTargets({ ...base, body: weigh(120), goalKg: 70, meds: [reta] }).protein?.value).toBe(145);
    // Caffeine: 200 mg with a medicine that slows clearing it.
    expect(suggestTargets({ ...base, body: [], meds: [med('Fluvoxamine')] }).caffeine?.value).toBe(200);
    // Archived items don't count.
    expect(suggestTargets({ ...base, body: weigh(90), meds: [{ ...reta, archived: true }] }).water?.value).toBe(3150);
  });
});
