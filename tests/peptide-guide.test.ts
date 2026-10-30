import { describe, it, expect } from 'vitest';
import { canSplit, fmtDose, GUIDE, guideById, guideFor, guideMed, levelSwing, mixTable, splitView, stepChanges, weekGaps } from '../src/logic/peptideGuide';
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
    expect(guideMed(guideById('epitalon')!, now).schedule.course).toEqual({ start: '2026-11-02', days: 20 });
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
    expect(Math.round(weekly.swing * 100)).toBe(55);
    expect(Math.round(weekly.other.swing * 100)).toBe(37);
    const twice = splitView(144, [1, 4])!;
    expect(twice.perWeek).toBe(2);
    expect(Math.round(twice.swing * 100)).toBe(37);
    expect(Math.round(twice.other.swing * 100)).toBe(55);
    expect(splitView(4, [1, 4])).toBeNull(); // short half-life: gone between shots either way
    expect(splitView(undefined, [1])).toBeNull();
  });
});
