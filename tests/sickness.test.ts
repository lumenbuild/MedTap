import { describe, it, expect } from 'vitest';
import type { CheckIn, DailyHealth } from '../src/db/schema';
import { sickEpisodes, sickForecast } from '../src/logic/sickness';
import { drinkMl } from '../src/logic/caffeine';
import { waterFromLog } from '../src/db/repos/food';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 6, 8, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (k: number, h = 12) => { const d = new Date(NOW - k * DAY); d.setHours(h, 0, 0, 0); return d.getTime(); };
// A steady person: small day-to-day wobble.
const wob = (k: number, a: number) => (((k * 7) % 5) - 2) * a;
const night = (k: number, o: Partial<DailyHealth> = {}): DailyHealth => ({ id: `d${k}`, date: ymd(at(k)), restingHr: 56 + wob(k, 0.5), hrvMs: 60 + wob(k, 2), respRate: 14 + wob(k, 0.1), skinTempDelta: wob(k, 0.05), spo2Avg: 97 + wob(k, 0.2), ...st, ...o });
const sickNight = (k: number) => night(k, { restingHr: 63, hrvMs: 44, respRate: 15.6, skinTempDelta: 0.6 });
const sick = (k: number, chip = 'Sore throat'): CheckIn => ({ id: `c${k}`, at: new Date(at(k, 18)).toISOString(), chips: [chip], ...st });

describe('sickness forecast', () => {
  it('a steady person: clear', () => {
    const daily = Array.from({ length: 40 }, (_, i) => night(39 - i));
    const f = sickForecast({ daily, checkIns: [] }, NOW)!;
    expect(f.level).toBe('clear');
    expect(f.off).toHaveLength(0);
  });

  it('several signals off together: flagged, most off first', () => {
    const daily = [...Array.from({ length: 40 }, (_, i) => night(40 - i)), sickNight(0)];
    const f = sickForecast({ daily, checkIns: [] }, NOW)!;
    expect(f.level).not.toBe('clear');
    expect(f.off.length).toBeGreaterThanOrEqual(3);
    expect(f.off.map((x) => x.key)).toContain('skinTempDelta');
    expect(f.score).toBeGreaterThan(f.watchAt);
  });

  it('one signal alone is not enough', () => {
    const daily = [...Array.from({ length: 40 }, (_, i) => night(40 - i)), night(0, { restingHr: 66 })];
    expect(sickForecast({ daily, checkIns: [] }, NOW)!.level).toBe('clear');
  });

  it('alcohol the night before counts heart rate and HRV for less', () => {
    const daily = [...Array.from({ length: 40 }, (_, i) => night(40 - i)), night(0, { restingHr: 61, hrvMs: 50 })];
    const plain = sickForecast({ daily, checkIns: [] }, NOW)!;
    const drink = sickForecast({ daily, checkIns: [{ id: 'a', at: new Date(at(1, 20)).toISOString(), chips: ['Alcohol'], ...st }] }, NOW)!;
    expect(drink.score).toBeLessThan(plain.score);
    expect(drink.confound).toMatch(/alcohol/);
  });

  it('learns from past illnesses: which signal moves first, and how many it would have caught', () => {
    // Two past colds, each with skin temperature up the two nights before (other signals only a little).
    const lead = (k: number) => night(k, { skinTempDelta: 0.5, restingHr: 59, respRate: 14.8 });
    const daily: DailyHealth[] = [];
    for (let k = 100; k >= 0; k--) daily.push([72, 71, 32, 31].includes(k) ? lead(k) : night(k));
    const f = sickForecast({ daily, checkIns: [sick(70), sick(30, 'Unwell')] }, NOW)!;
    expect(f.learned.episodes).toBe(2);
    expect(f.learned.first).toBe('skinTempDelta');
    expect(f.learned.checked).toBe(2);
  });

  it('"I\'m fine" answers raise the alert level', () => {
    const daily = Array.from({ length: 40 }, (_, i) => night(39 - i));
    const a = sickForecast({ daily, checkIns: [] }, NOW)!;
    const b = sickForecast({ daily, checkIns: [], feedback: { '2026-10-01': 'fine', '2026-10-10': 'fine' } }, NOW)!;
    expect(b.watchAt).toBeGreaterThan(a.watchAt);
  });

  it('sick check-ins on nearby days count as one illness', () => {
    expect(sickEpisodes([sick(10), sick(9, 'Fever'), sick(8, 'Feeling ill'), sick(1)])).toHaveLength(2);
    expect(sickEpisodes([{ id: 'x', at: new Date(at(3)).toISOString(), chips: ['Headache'], ...st }])).toHaveLength(0);
  });

  it('no forecast without recent nights', () => {
    const daily = Array.from({ length: 40 }, (_, i) => night(45 - i));
    expect(sickForecast({ daily, checkIns: [] }, NOW)).toBeNull();
  });
});

describe('drinks count toward water', () => {
  it('size from the drink list or its name', () => {
    expect(drinkMl('Energy drink, 500 mL')).toBe(500);
    expect(drinkMl('Flat white or latte, 1 shot')).toBe(220);
    expect(drinkMl('Monster Ultra 500ml')).toBe(500);
    expect(drinkMl('Mother 1.5 L')).toBe(1500);
    expect(drinkMl('Caffeine tablet')).toBeUndefined();
    expect(drinkMl('Something')).toBeUndefined();
  });
  it('food in mL counts; alcohol, sauces and small amounts do not', () => {
    const can = { servingQty: 500, servingUnit: 'mL' as const, kind: 'product' as const };
    expect(waterFromLog('Red Bull Sugarfree', 1, can)).toBe(500);
    expect(waterFromLog('Red Bull Sugarfree', 1.5, can)).toBe(750);
    expect(waterFromLog('Great Northern lager', 1, { ...can, servingQty: 375 })).toBeUndefined();
    expect(waterFromLog('Soy sauce', 1, { ...can, servingQty: 15 })).toBeUndefined();
    expect(waterFromLog('Sweet chilli sauce', 4, { ...can, servingQty: 30 })).toBeUndefined();
    expect(waterFromLog('Energy drink, 250 mL', 1, undefined, 80)).toBe(250);
    expect(waterFromLog('Chicken breast', 1, { servingQty: 150, servingUnit: 'g', kind: 'product' })).toBeUndefined();
  });
});
