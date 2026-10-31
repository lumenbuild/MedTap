import { describe, it, expect } from 'vitest';
import { canSplit, fmtDose, GUIDE, guideById, guideFor, guideMed, isGlp, levelSwing, mixTable, searchGuide, splitView, stackChecks, stepChanges, weekGaps } from '../src/logic/peptideGuide';
import { guideYours } from '../src/logic/guideYours';
import type { Medication } from '../src/db/schema';
import { ingredientsOf } from '../src/logic/ingredients';
import { unstudied } from '../src/logic/interactions';

describe('peptide guide', () => {
  it('finds the entry from the names people use', () => {
    const cases: [string, string][] = [['Retatrutide 10mg', 'retatrutide'], ['Glutathione', 'glutathione'], ['GHK-Cu', 'ghk-cu'], ['DISP', 'dsip'], ['DSIP 5mg', 'dsip'],
      ['BPC-157', 'bpc-157'], ['BPC157', 'bpc-157'], ['NAD500', 'nad'], ['NAD+ 500', 'nad'], ['NAD+', 'nad'], ['Epithilian', 'epitalon'], ['Epithalon', 'epitalon'], ['Semax', 'semax'], ['NA-Semax', 'semax']];
    for (const [name, id] of cases) expect(guideFor(name)?.id, name).toBe(id);
    expect(guideFor('Nadolol')).toBeUndefined();
    expect(guideFor('Panadol dispersible')).toBeUndefined();
  });
  it('mixing tables in syringe units', () => {
    const reta = guideById('retatrutide')!;
    expect(mixTable(reta, { amount: 10, waterMl: 1 }).map((r) => [r.dose, r.units])).toEqual([[0.5, 5], [1, 10], [2, 20], [3, 30], [4, 40], [6, 60], [8, 80]]);
    expect(mixTable(guideById('bpc-157')!, { amount: 5000, waterMl: 2 }).map((r) => r.units)).toEqual([10, 20]);
    expect(mixTable(guideById('nad')!, { amount: 500, waterMl: 5 }).map((r) => r.units)).toEqual([25, 50, 100]);
    expect(mixTable(guideById('dsip')!, { amount: 5, waterMl: 2 }).find((r) => r.dose === 0.25)?.units).toBe(10);
    // Each entry's first vial makes its starting dose a measurable draw that fits the syringe.
    for (const g of GUIDE) {
      const [d] = mixTable({ ...g, tableDoses: [g.setup.defaultAmount] }, g.vials[0]);
      expect(d.units, g.id).toBeGreaterThanOrEqual(2);
      expect(d.units, g.id).toBeLessThanOrEqual(g.setup.syringeUnits);
    }
  });
  it('sets up the injection form', () => {
    const now = new Date('2026-11-02T09:00').getTime(); // a Monday
    const m = guideMed(guideById('retatrutide')!, now);
    expect(m).toMatchObject({ name: 'Retatrutide', strength: 10, unit: 'mg', defaultAmount: 2, form: 'injection', schedule: { type: 'fixed', days: [1] },
      peptide: { waterMl: 1, syringe: 'U-100', syringeUnits: 50, useWithinDays: 28, halfLifeHours: 144 } });
    expect(guideMed(guideById('epitalon')!, now).schedule.course).toEqual({ start: '2026-11-02', days: 20, remindAfterDays: 140 });
    expect(guideMed(guideById('nad')!, now).schedule.days).toEqual([1, 3, 5]);
  });
  it('the step-up as dated changes', () => {
    expect(stepChanges(guideById('retatrutide')!, '2026-11-02')).toEqual([
      { from: '2026-11-30', amount: 4 }, { from: '2026-12-28', amount: 8 }, { from: '2027-01-25', amount: 12 }]);
    expect(stepChanges(guideById('bpc-157')!, '2026-11-02')).toEqual([]);
  });
  it('doses read naturally', () => {
    expect(fmtDose(250, 'mcg')).toBe('250 mcg');
    expect(fmtDose(5000, 'mcg')).toBe('5 mg');
    expect(fmtDose(0.25, 'mg')).toBe('0.25 mg (250 mcg)');
    expect(fmtDose(1500, 'mg')).toBe('1,500 mg');
  });
  it('flags interactions as unstudied for the new spellings', () => {
    for (const name of ['Epithilian', 'DSIP', 'BPC157']) expect(unstudied({ name, strength: 5, unit: 'mg' } as never), name).toBe(true);
    expect(ingredientsOf({ name: 'Panadol dispersible', strength: 500, unit: 'mg' })).toEqual([{ name: 'paracetamol', mg: 500 }]);
  });

  it('splits a weekly peptide into two half shots, 3 and 4 days apart', () => {
    const now = new Date('2026-11-02T09:00').getTime(); // Monday
    const reta = guideById('retatrutide')!;
    expect(canSplit(reta)).toBe(true);
    expect(canSplit(guideById('bpc-157')!)).toBe(false);
    const m = guideMed(reta, now, true);
    expect(m.defaultAmount).toBe(1);
    expect(m.schedule.days).toEqual([1, 4]);
    expect(stepChanges(reta, '2026-11-02', true).map((c) => c.amount)).toEqual([2, 4, 6]);
    // A daily one isn't split.
    expect(guideMed(guideById('bpc-157')!, now, true).defaultAmount).toBe(250);
  });
  it('how steady the level is between shots', () => {
    expect(weekGaps([1, 4])).toEqual([3, 4]);
    expect(weekGaps([3])).toEqual([7]);
    expect(weekGaps([0, 2, 4])).toEqual([2, 2, 3]);
    expect(levelSwing(144, 144)).toBeCloseTo(0.5);
    const weekly = splitView(144, [1])!;
    expect(Math.round(weekly.swing * 100)).toBe(49); // with a day to absorb: less than the 55% elimination alone gives
    expect(Math.round(weekly.other.swing * 100)).toBe(30);
    const twice = splitView(144, [1, 4])!;
    expect(twice.perWeek).toBe(2);
    expect(Math.round(twice.swing * 100)).toBe(30);
    expect(Math.round(twice.other.swing * 100)).toBe(49);
    expect(splitView(4, [1, 4])).toBeNull(); // short half-life: gone between shots either way
    expect(splitView(undefined, [1])).toBeNull();
  });

  it('finds the newer entries and blends, the longest name winning', () => {
    const cases: [string, string][] = [['Sema 5mg', 'semaglutide'], ['Ozempic', 'semaglutide'], ['Tirz 30mg', 'tirzepatide'], ['Mounjaro', 'tirzepatide'],
      ['Cagri', 'cagrilintide'], ['Ipamorelin', 'ipamorelin'], ['CJC-1295 no DAC', 'cjc-1295'], ['CJC-1295 / Ipamorelin', 'cjc-ipa'], ['CJC Ipa 10mg', 'cjc-ipa'],
      ['TB-500', 'tb-500'], ['TB500', 'tb-500'], ['BPC-157 + TB-500', 'bpc-tb'], ['BPC/TB 10mg', 'bpc-tb'], ['Wolverine', 'bpc-tb'], ['GLOW 70', 'glow'],
      ['Thymosin alpha-1', 'thymosin-alpha-1'], ['TA1', 'thymosin-alpha-1'], ['Thymosin beta-4', 'tb-500'], ['MOTS-c', 'mots-c'], ['SS-31', 'ss-31'],
      ['AOD 9604', 'aod-9604'], ['Selank', 'selank'], ['PT-141', 'pt-141'], ['MT2', 'melanotan-ii'], ['KPV', 'kpv'], ['Tesamorelin', 'tesamorelin'], ['NA-Semax', 'semax']];
    for (const [name, id] of cases) expect(guideFor(name)?.id, name).toBe(id);
    expect(new Set(GUIDE.map((g) => g.id)).size).toBe(GUIDE.length);
    for (const g of GUIDE) expect(g.goals?.length, g.id).toBeGreaterThan(0);
    for (const g of GUIDE) for (const n of [...(g.with ?? []), ...(g.notWith ?? [])]) expect(n.id === 'glp1' || !!guideById(n.id), `${g.id} → ${n.id}`).toBe(true);
  });
  it('filters by goal and searches', () => {
    const weight = searchGuide('', 'weight').map((g) => g.id);
    expect(weight).toEqual(expect.arrayContaining(['retatrutide', 'semaglutide', 'tirzepatide', 'cagrilintide', 'aod-9604']));
    expect(weight).not.toContain('bpc-157');
    expect(searchGuide('wegovy').map((g) => g.id)).toEqual(['semaglutide']);
    expect(searchGuide('tb', 'healing').map((g) => g.id)).toEqual(expect.arrayContaining(['tb-500', 'bpc-tb']));
  });
  it('a blend draw carries the other parts', () => {
    const glow = mixTable(guideById('glow')!, { amount: 50, waterMl: 3 });
    expect(glow[1]).toMatchObject({ dose: 1.25, units: 7.5, others: [{ name: 'BPC-157', amount: 0.25 }, { name: 'TB-500', amount: 0.25 }] });
    expect(mixTable(guideById('bpc-tb')!, { amount: 5, waterMl: 2 })[1].others).toEqual([{ name: 'TB-500', amount: 0.5 }]);
    expect(mixTable(guideById('bpc-157')!, { amount: 5000, waterMl: 2 })[0].others).toEqual([]);
  });
  it('checks combinations against what you take', () => {
    const m = (id: string, name: string) => ({ id, name, strength: 10, unit: 'mg', archived: false }) as Medication;
    const reta = guideById('retatrutide')!;
    expect(isGlp(m('a', 'Reta 10mg'))).toBe(true);
    expect(isGlp(m('a', 'Ozempic'))).toBe(true);
    expect(stackChecks(reta, [m('r', 'Retatrutide'), m('o', 'Ozempic')], 'r')).toEqual([{ kind: 'notWith', med: 'Ozempic', note: 'Two GLP-1 medicines together', ref: 'glp1' }]);
    expect(stackChecks(guideById('bpc-157')!, [m('t', 'TB-500'), m('x', 'Paracetamol')])).toEqual([{ kind: 'with', med: 'TB-500', note: 'The common healing pairing', ref: 'tb-500' }]);
    // Either side's notes count.
    expect(stackChecks(guideById('melanotan-ii')!, [m('p', 'PT-141')])[0].kind).toBe('notWith');
    expect(stackChecks(guideById('tb-500')!, [m('b', 'BPC-157')])[0].kind).toBe('with');
  });
  it('yours: dose and draw, progress, adherence and weight', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const s = { dayStartsAt: '04:00', tz } as never;
    const now = new Date('2026-11-02T12:00').getTime();
    const reta = guideById('retatrutide')!;
    const med = { ...guideMed(reta, new Date('2026-09-07T09:00').getTime()), id: 'r', createdAt: '', updatedAt: '', color: '', icon: '', archived: false } as Medication;
    const doses = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, medicationId: 'r', amount: 2, takenAt: new Date(new Date('2026-09-07T09:00').getTime() + i * 7 * 86_400_000).toISOString() })).filter((d) => d.id !== 'd6');
    const body = [{ id: 'b1', date: '2026-09-06', weightKg: 100 }, { id: 'b2', date: '2026-11-01', weightKg: 93.5 }];
    const lines = guideYours(reta, med, { meds: [med], doses: doses as never, checkIns: [], daily: [], body: body as never }, now, s);
    expect(lines[0]).toBe('2 mg (20 units on your vial), on Mon.');
    expect(lines[1]).toMatch(/^Started 7 Sept?: 8 weeks in\.$/);
    expect(lines).toContain('Last 4 weeks: 3 of 4 planned doses taken.'); // one missed on 19 Oct
    expect(lines).toContain('Down 6.5 kg since starting (−6.5%).');
  });
});
