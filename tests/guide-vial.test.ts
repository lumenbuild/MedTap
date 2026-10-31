import { describe, it, expect } from 'vitest';
import { guideById, guideMed, mixTable, suggestWater } from '../src/logic/peptideGuide';
import { guideCourse } from '../src/logic/courseShop';

describe('guide mixing uses your own vial', () => {
  it('the draw follows the vial and water you enter, not a set size', () => {
    const g = guideById('epitalon')!;
    // A 10 mg vial with 1 mL: 5 mg is 50 units. A 50 mg vial with 5 mL: the same 10 mg per mL.
    expect(mixTable(g, { amount: 10, waterMl: 1 }).find((r) => r.dose === 5)?.units).toBe(50);
    expect(mixTable(g, { amount: 20, waterMl: 1 }).find((r) => r.dose === 5)?.units).toBe(25);
  });
  it('suggests water that makes the starting dose an easy draw', () => {
    const g = guideById('epitalon')!;
    for (const amount of [10, 20, 50]) {
      const w = suggestWater(g, amount);
      const units = (Math.min(g.setup.defaultAmount, amount) / (amount / w)) * 100;
      expect(units).toBeGreaterThanOrEqual(5);
      expect(units).toBeLessThanOrEqual(100);
      expect(units % 5).toBeCloseTo(0);
    }
  });
  it('a blend: each part from your vial', () => {
    const g = guideById('glow')!;
    const [row] = mixTable({ ...g, tableDoses: [1] }, { amount: 35, waterMl: 3, parts: [5, 5] });
    expect(row.others.map((o) => o.amount)).toEqual([0.143, 0.143]);
  });
  it('vials a course takes, and setting it up, follow your vial size', () => {
    const g = guideById('epitalon')!;
    expect(guideCourse(g, 50).vials).toBeLessThan(guideCourse(g, 10).vials);
    const m = guideMed(g, Date.now(), false, { amount: 50, waterMl: 5 });
    expect(m.strength).toBe(50);
    expect(m.peptide?.waterMl).toBe(5);
  });
});
