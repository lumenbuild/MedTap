import { describe, it, expect } from 'vitest';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication } from '../src/db/schema';
import { countCheck, heartAfterDose, onOffDays, stepsVsWeight, substanceFindings, ALCOHOL, CAFFEINE } from '../src/logic/lifestyle';
import { countTablets } from '../src/logic/countTablets';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const HOUR = 3_600_000;
const syd = (date: string, time = '12:00') => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, h, mi, TZ);
};
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const dose = (ms: number, o: Partial<Dose> = {}): Dose => ({ id: `d${++n}`, medicationId: 'm', takenAt: iso(ms), amount: 10, source: 'tag', createdAt: iso(ms), updatedAt: '', ...o });
const ci = (ms: number, o: Partial<CheckIn> = {}): CheckIn => ({ id: `c${++n}`, at: iso(ms), chips: [], createdAt: '', updatedAt: '', ...o });
const med = (o: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, color: '', icon: 'pill', archived: false,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, createdAt: '', updatedAt: '', ...o,
});
const NOW = syd('2026-08-01', '12:00');

describe('recount', () => {
  it('fewer than the logs say: the set times with nothing logged are the likely ones', () => {
    const doses: Dose[] = [];
    for (let i = 1; i <= 11; i++) if (i !== 3 && i !== 6) doses.push(dose(syd('2026-07-21', '08:05') + i * DAY));
    const m = med({ stockCount: 20, stockBase: { count: 28, at: iso(syd('2026-07-22', '06:00')) } });
    const c = countCheck(m, doses, 18, NOW, S)!;
    expect(c).toMatchObject({ expected: 20, counted: 18, diff: 2, doses: 2 });
    expect(c.unlogged.map((u) => new Date(u.t + 10 * HOUR).toISOString().slice(0, 10))).toEqual(['2026-07-24', '2026-07-27']);
    expect(countCheck(m, doses, 21, NOW, S)!.unlogged).toEqual([]);
  });
});

describe('days on and off', () => {
  it('weekdays on, weekends off', () => {
    const doses: Dose[] = [], cis: CheckIn[] = [];
    for (let i = 1; i <= 28; i++) {
      const t = syd('2026-07-03', '08:00') + i * DAY;
      const wd = new Date(t + 10 * HOUR).getUTCDay();
      const on = wd !== 0 && wd !== 6;
      if (on) doses.push(dose(t));
      cis.push(ci(t + 4 * HOUR, { focus: on ? 4 : 2, appetite: on ? 2 : 4 }));
    }
    const r = onOffDays(med(), doses, cis, NOW, S)!;
    expect(r.on).toMatchObject({ focus: 4, appetite: 2 });
    expect(r.off).toMatchObject({ focus: 2, appetite: 4 });
    expect(r.off.days).toBeGreaterThanOrEqual(6);
  });
});

describe('caffeine, alcohol and the cycle', () => {
  it('late caffeine and alcohol against sleep and next-day side effects', () => {
    const cis: CheckIn[] = [];
    for (let i = 1; i <= 20; i++) {
      const day = syd('2026-07-08', '12:00') + i * DAY;
      const late = i % 3 === 0, drink = i % 4 === 0;
      if (late) cis.push(ci(day + 4 * HOUR, { chips: [CAFFEINE] }));
      if (drink) cis.push(ci(day + 8 * HOUR, { chips: [ALCOHOL] }));
      cis.push(ci(day + DAY - 4 * HOUR, { sleepQuality: late ? 2 : 4, chips: drink ? ['Headache'] : [] }));
      if (!late && !drink) cis.push(ci(day + 2 * HOUR, { chips: [CAFFEINE] })); // morning coffee
    }
    const f = substanceFindings(cis, NOW, S);
    const c = f.find((x) => x.what === 'late-caffeine')!;
    expect(c.with.sleepQuality).toBeLessThan(c.without.sleepQuality!);
    const a = f.find((x) => x.what === 'alcohol')!;
    expect(a.with.effectPct!).toBeGreaterThan(a.without.effectPct!);
  });
});

describe('steps, weight and heart rate', () => {
  it('busier weeks against quieter ones', () => {
    const daily: DailyHealth[] = [], body: BodyEntry[] = [];
    let kg = 100;
    for (let w = 12; w >= 1; w--) {
      const busy = w % 2 === 0;
      for (let d = 0; d < 7; d++) {
        const t = NOW - w * 7 * DAY + d * DAY;
        const date = new Date(t + 10 * HOUR).toISOString().slice(0, 10);
        daily.push({ id: `${w}-${d}`, date, steps: busy ? 11000 : 4000, createdAt: '', updatedAt: '' });
        kg -= busy ? 0.1 : 0.02;
        if (d % 2 === 0) body.push({ id: `b${w}-${d}`, date, weightKg: Math.round(kg * 100) / 100, createdAt: '', updatedAt: '' });
      }
    }
    const r = stepsVsWeight(daily, body, NOW)!;
    expect(r.busier.steps).toBeGreaterThan(r.quieter.steps);
    expect(r.busier.perWeek).toBeLessThan(r.quieter.perWeek);
  });
  it('heart rate rises a couple of hours after a dose', () => {
    const daily: DailyHealth[] = [];
    const doses: Dose[] = [];
    for (let i = 1; i <= 10; i++) {
      const date = new Date(syd('2026-07-20') + i * DAY + 10 * HOUR).toISOString().slice(0, 10);
      const dosed = i % 5 !== 0;
      const hr = Array.from({ length: 24 }, (_, h) => (dosed && h >= 9 && h <= 14 ? 88 : 68));
      daily.push({ id: date, date, hrByHour: hr, createdAt: '', updatedAt: '' });
      if (dosed) doses.push(dose(new Date(`${date}T08:00`).getTime()));
    }
    const r = heartAfterDose(med(), doses, daily, [], syd('2026-08-01'), S)!;
    expect(r.peak!.bpm).toBe(88);
    expect(r.baseline).toBe(68);
  });
});

describe('counting tablets in a photo', () => {
  const draw = (w: number, h: number, bg: number, fg: number, discs: [number, number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = discs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
      const v = inside ? fg : bg + ((x * 7 + y * 13) % 9); // a little texture
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
    return { width: w, height: h, data };
  };
  it('counts separate tablets and splits two that touch', () => {
    const discs: [number, number, number][] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) discs.push([50 + i * 70, 50 + j * 70, 16]);
    discs.push([340, 220, 16], [371, 220, 16]); // touching pair
    const r = countTablets(draw(420, 280, 40, 230, discs));
    expect(r.count).toBe(14);
  });
  it('dark tablets on a light background', () => {
    const discs: [number, number, number][] = Array.from({ length: 9 }, (_, i) => [40 + (i % 3) * 60, 40 + Math.floor(i / 3) * 60, 14] as [number, number, number]);
    expect(countTablets(draw(240, 220, 220, 30, discs)).count).toBe(9);
  });
});
