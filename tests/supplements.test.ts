import { describe, it, expect } from 'vitest';
import type { DailyHealth, Dose, Medication } from '../src/db/schema';
import type { ScheduleSettings } from '../src/logic/schedule';
import { dailyTotals, supplementRules, supplementsOf } from '../src/logic/supplements';
import { howToTake, usualWake } from '../src/logic/howToTake';
import { planReminders } from '../src/logic/notify';
import { interactions } from '../src/logic/interactions';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, guardMinutes: 10 };
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 23, 6, 0).getTime();
const at = (daysAgo: number, h = 12, m = 0) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const st = { createdAt: '', updatedAt: '' };
let n = 0;
const med = (name: string, o: Partial<Medication> = {}): Medication => ({ id: `m${n++}`, name, strength: 0, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, ...st, ...o });

describe('supplements', () => {
  it('knows them by name', () => {
    expect(supplementsOf(med('Magnesium glycinate 300')).map((x) => x.key)).toEqual(['magnesium']);
    expect(supplementsOf(med('Ostelin Vitamin D3 1000 IU')).map((x) => x.key)).toContain('vitamin-d');
    expect(supplementsOf(med('Metamucil')).map((x) => x.key)).toEqual(['fibre']);
    expect(supplementsOf(med('Ritalin'))).toEqual([]);
  });
  it('rules: avoid, apart, pair, and before a blood test', () => {
    const rit = med('Ritalin'), vy = med('Vyvanse'), reta = med('Retatrutide', { form: 'injection', peptide: { waterMl: 1, syringe: 'U-100', syringeUnits: 50 } });
    const r = supplementRules([rit, vy, reta, med('Caffeine tablets'), med('Vitamin C 500'), med('Metamucil'), med('Biotin'), med('L-theanine'), med('Electrolytes')], { bloodTestSoon: true });
    const ids = r.map((x) => x.id.split(':')[0]);
    expect(ids).toEqual(expect.arrayContaining(['caffeine-stim', 'vitc-amph', 'fibre-tablets', 'theanine-stim', 'electro-glp1', 'fibre-glp1', 'lab-biotin']));
    expect(r.find((x) => x.id.startsWith('vitc-amph'))!.text).toMatch(/Vyvanse/);
    expect(r.find((x) => x.id.startsWith('vitc-amph'))!.text).not.toMatch(/Ritalin/);
    expect(r.find((x) => x.id.startsWith('lab-biotin'))!.text).toMatch(/your blood test/);
  });
  it('MAOIs with stimulants are flagged', () => {
    const x = interactions([med('Ritalin'), med('Nardil')], () => 'me');
    expect(x[0].why).toMatch(/not together/);
  });
  it('daily totals against the upper limit', () => {
    const t = dailyTotals([med('Zinc 50', { strength: 50, unit: 'mg', defaultAmount: 50 }), med('Vitamin D3', { unit: 'units', defaultAmount: 5000 })], [], NOW, S);
    expect(t.find((x) => x.key === 'zinc')).toMatchObject({ perDay: 50, ul: 40, over: true });
    expect(t.find((x) => x.key === 'vitamin-d')).toMatchObject({ perDay: 125, ul: 80, over: true });
  });
});

describe('when and how, and waking', () => {
  const daily: DailyHealth[] = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, date: ymd(at(i + 1)), sleepEnd: at(i + 1, 6, 50), ...st }));
  it('usual wake and the advice', () => {
    expect(usualWake(daily, NOW, S)).toBe(6 * 60 + 50);
    const rit = med('Ritalin');
    const doses: Dose[] = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, medicationId: rit.id, takenAt: new Date(at(i + 1, 7, 20)).toISOString(), amount: 10, source: 'manual', ...st }));
    const a = howToTake(rit, { meds: [rit, med('Vitamin C')], doses, checkIns: [], daily }, NOW, S).map((x) => x.text).join(' | ');
    expect(a).toMatch(/30–45 minutes before a meal/);
    expect(a).toMatch(/wake about 6:50 am and take the first dose 30 min later/);
  });
  it('the first reminder follows waking', () => {
    const rit = med('Ritalin', { followWakeMin: 30, schedule: { type: 'fixed', slots: [{ time: '08:00' }, { time: '12:00' }] } });
    const woke = at(0, 6, 10) + DAY * 0;
    const now = at(0, 6, 20);
    const r = planReminders([rit], [], now, S, 1, 10, { wakeAt: woke });
    expect(new Date(r[0].at).getHours() * 60 + new Date(r[0].at).getMinutes()).toBe(6 * 60 + 40);
    expect(new Date(r[1].at).getHours()).toBe(12);
    const plain = planReminders([{ ...rit, followWakeMin: undefined }], [], now, S, 1, 10, { wakeAt: woke });
    expect(new Date(plain[0].at).getHours()).toBe(8);
  });
});
