import { describe, it, expect } from 'vitest';
import type { Dose, LabResult, Medication } from '../src/db/schema';
import { doseCheck, usualRange } from '../src/logic/doseCheck';
import { courseShop, guideCourse } from '../src/logic/courseShop';
import { labsFor } from '../src/logic/peptideLabs';
import { experimentFor } from '../src/logic/experiments';
import { guideById } from '../src/logic/peptideGuide';
import { interactions } from '../src/logic/interactions';
import type { ScheduleSettings } from '../src/logic/schedule';
import { zonedToUtc } from '../src/logic/tz';

const TZ = 'Australia/Sydney';
const S: ScheduleSettings = { dayStartsAt: '04:00', tz: TZ, guardMinutes: 10 };
const DAY = 86_400_000;
const syd = (date: string, time = '12:00') => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return zonedToUtc(y, m, d, h, mi, TZ); };
let n = 0;
const dose = (ms: number, amount: number, medicationId = 'p'): Dose => ({ id: `d${++n}`, medicationId, takenAt: new Date(ms).toISOString(), amount, source: 'manual', createdAt: '', updatedAt: '' });
const med = (o: Partial<Medication>): Medication => ({
  id: 'p', name: 'BPC-157', strength: 5000, unit: 'mcg', form: 'injection', defaultAmount: 250, schedule: { type: 'fixed', slots: [{ time: '08:00' }] },
  color: '', icon: '', archived: false, createdAt: '', updatedAt: '', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 30, useWithinDays: 28 }, ...o,
});

describe('dose check', () => {
  const now = syd('2026-11-02', '09:00');
  it('the usual range, in the medicine’s own unit', () => {
    expect(usualRange(med({}))).toEqual([250, 500]);
    expect(usualRange(med({ unit: 'mg' }))).toEqual([0.25, 0.5]);
    expect(usualRange(med({ name: 'Paracetamol' }))).toBeUndefined();
  });
  it('a mg/mcg slip, with the amount probably meant', () => {
    const [f] = doseCheck(med({}), 0.25, [], now); // typed mg into a mcg medicine
    expect(f).toMatchObject({ kind: 'slip', suggest: 250 });
    expect(doseCheck(med({ name: 'Epitalon', strength: 10, unit: 'mg', defaultAmount: 5 }), 5000, [], now)[0]).toMatchObject({ kind: 'slip', suggest: 5 });
  });
  it('far over or under the usual range', () => {
    expect(doseCheck(med({}), 2500, [], now)[0].kind).toBe('high');
    expect(doseCheck(med({}), 50, [], now)[0].kind).toBe('low');
    expect(doseCheck(med({}), 400, [], now)).toEqual([]);
  });
  it('against their own usual dose, for any medicine', () => {
    const ds = [1, 2, 3, 4].map((i) => dose(now - i * DAY, 10, 'r'));
    const rit = med({ id: 'r', name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', peptide: undefined });
    expect(doseCheck(rit, 30, ds, now)[0]).toMatchObject({ kind: 'usual', suggest: 10 });
    expect(doseCheck(rit, 10, ds, now)).toEqual([]);
  });
  it('more than is left in the vial', () => {
    const m = med({ vials: [{ id: 'v', status: 'in-use', amount: 5000, waterMl: 2, addedAt: '', startedAt: new Date(now - 10 * DAY).toISOString() }] });
    const ds = Array.from({ length: 19 }, (_, i) => dose(now - (i + 1) * 12 * 3_600_000, 250)); // 4,750 used
    const f = doseCheck(m, 500, ds, now);
    expect(f.find((x) => x.kind === 'vial')?.text).toMatch(/Only about 250 mcg is left in this vial/);
  });
});

describe('course shopping list', () => {
  it('Epitalon: a 20-day course at 5 mg needs 10 vials of 10 mg', () => {
    expect(guideCourse(guideById('epitalon')!)).toEqual({ shots: 20, total: 100, vials: 10, days: 20, course: true });
  });
  it('BPC-157: 4 weeks at 250 mcg fits in 2 vials of 5 mg', () => {
    expect(guideCourse(guideById('bpc-157')!)).toMatchObject({ shots: 28, total: 7000, vials: 2 });
  });
  it('a weekly GLP-1 is limited by its 4 weeks once mixed, not the amount', () => {
    // Reta 2 mg weekly from a 10 mg vial: the vial would last 5 weeks, but it's replaced after 4.
    expect(guideCourse(guideById('retatrutide')!)).toMatchObject({ shots: 4, total: 8, vials: 1 });
  });
  it('your own: what is in hand, what to buy, when it runs out', () => {
    const now = syd('2026-11-02', '07:00'); // before today's 8 am shot
    const m = med({
      name: 'Epitalon', strength: 10, unit: 'mg', defaultAmount: 5,
      schedule: { type: 'fixed', slots: [{ time: '21:00' }], course: { start: '2026-11-02', days: 20, remindAfterDays: 140 } },
      peptide: { waterMl: 1, syringe: 'U-100', syringeUnits: 100, useWithinDays: 28 },
      vials: [
        { id: 'a', status: 'in-use', amount: 10, waterMl: 1, addedAt: '', startedAt: new Date(now - 3_600_000).toISOString() },
        { id: 'b', status: 'stock', amount: 10, addedAt: '' }, { id: 'c', status: 'stock', amount: 10, addedAt: '' },
      ],
    });
    const c = courseShop(m, [], now, S)!;
    expect(c).toMatchObject({ span: 'rest', days: 20, shots: 20, total: 100, inVial: 10, unopened: 2, unopenedAmount: 20, vials: 7, vialSize: 10, waterMl: 7, syringes: 20, swabs: 40 });
    expect(c.runsOutAt).toBeGreaterThan(now + 5 * DAY); // 30 mg in hand = 6 days
    expect(c.runsOutAt).toBeLessThan(now + 7 * DAY);
  });
  it('nothing to buy when stock covers it', () => {
    const now = syd('2026-11-02', '07:00');
    const m = med({ vials: [{ id: 'a', status: 'in-use', amount: 5000, waterMl: 2, addedAt: '', startedAt: new Date(now).toISOString() }, { id: 'b', status: 'stock', amount: 5000, addedAt: '' }] });
    expect(courseShop(m, [], now, S)).toMatchObject({ span: 'weeks', shots: 28, total: 7000, vials: 0 });
  });
});

describe('blood tests, experiments and interactions', () => {
  it('blood tests per peptide, with your latest', () => {
    const labs = [
      { id: '1', date: '2026-06-01', name: 'IGF-1', value: 180, unit: 'nmol/L' },
      { id: '2', date: '2026-09-01', name: 'IGF-1', value: 240, unit: 'nmol/L' },
    ] as LabResult[];
    const l = labsFor(guideById('ipamorelin')!, labs)!;
    expect(l.tests.map((t) => t.label)).toEqual(['IGF-1', 'Fasting glucose', 'HbA1c']);
    expect(l.tests[0].latest?.value).toBe(240);
    expect(l.tests[1].latest).toBeUndefined();
    expect(labsFor(guideById('retatrutide')!, [])!.tests.map((t) => t.label)).toContain('HbA1c');
    expect(labsFor(guideById('bpc-157')!, [])).toBeNull();
  });
  it('an experiment only for short-acting ones a rating or the watch can measure', () => {
    expect(experimentFor(guideById('dsip')!)).toMatchObject({ a: 'DSIP', b: 'No DSIP', metric: 'deepMin', blockDays: 3 });
    expect(experimentFor(guideById('semax')!)).toMatchObject({ metric: 'focus', blockDays: 7 });
    expect(experimentFor(guideById('retatrutide')!)).toBeNull(); // weeks in the body
    expect(experimentFor(guideById('bpc-157')!)).toBeNull(); // healing: no daily measure
  });
  it('new interaction checks', () => {
    const m = (id: string, name: string) => ({ id, name, strength: 1, unit: 'mg', archived: false }) as Medication;
    const keys = (ms: Medication[]) => interactions(ms, () => 'me').map((x) => x.key.split(':')[1]);
    expect(keys([m('a', 'Retatrutide'), m('b', 'Ozempic')])).toEqual(['glp1-glp1']);
    expect(keys([m('a', 'Ipamorelin'), m('b', 'Mounjaro')])).toEqual(['gh-glp1']);
    expect(keys([m('a', 'PT-141'), m('b', 'Melanotan II')])).toEqual(['melanocortin']);
    expect(keys([m('a', 'Semax'), m('b', 'Ritalin')])).toEqual(['stim-peptide']);
    expect(keys([m('a', 'DSIP'), m('b', 'Temazepam')])).toEqual(['calm-peptide']);
    expect(keys([m('a', 'MOTS-c'), m('b', 'Gliclazide')])).toEqual(['sugar-peptide']);
  });
});
