// Dose maths, checked two ways:
// 1. Worked examples, each done by hand (the working is in the test name), so a change to the formulas that gives a
//    different figure fails loudly.
// 2. Properties over thousands of random vials, waters, doses and syringes: the rules every draw must follow
//    (round trips, scaling, units vs mL, mg vs mcg, syringe type), so an edge case nobody thought of still fails.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  blendAmounts, concentration, convert, doseForUnits, doseGuide, drawFor, drawWarnings, fmtUnits, unitsPerMl,
  vialStatus, vialStockCount, waterForUnits,
} from '../src/logic/peptide';
import { recountStock, stockUnitsFor } from '../src/logic/stock';
import { doseCheck, usualRange } from '../src/logic/doseCheck';
import type { Dose, Medication, PeptideVial, SyringeType } from '../src/db/schema';

const RUNS = { numRuns: 2000 };
const st = { createdAt: '', updatedAt: '' };
const dose = (o: Partial<Dose>): Dose => ({ id: crypto.randomUUID(), medicationId: 'p', takenAt: '', amount: 0.25, source: 'manual', ...st, ...o });
const vial = (o: Partial<PeptideVial>): PeptideVial => ({ id: crypto.randomUUID(), status: 'stock', amount: 5, waterMl: 2, addedAt: '2026-06-01T00:00:00Z', ...o });
const pmed = (o: Partial<Medication> = {}): Medication => ({
  id: 'p', name: 'Test peptide', strength: 5, unit: 'mg', form: 'injection', defaultAmount: 0.25, color: '', icon: 'syringe', archived: false,
  schedule: { type: 'prn' }, ...st, peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50, useWithinDays: 28 }, ...o,
});

// Realistic ranges: vials 0.5–60 mg (or the same in mcg), 0.5–10 mL of water, doses from 1% to 100% of the vial.
const syringe = fc.constantFrom<SyringeType>('U-100', 'U-40');
const vialMg = fc.double({ min: 0.5, max: 60, noNaN: true });
const water = fc.double({ min: 0.5, max: 10, noNaN: true });
const share = fc.double({ min: 0.01, max: 1, noNaN: true });
/** A draw's units are rounded to 0.01 and its mL to 0.0001; allow for that and float noise. */
const close = (a: number, b: number, abs: number) => Math.abs(a - b) <= abs + Math.abs(b) * 1e-9;

describe('dose maths: worked examples (by hand)', () => {
  const cases: [string, number, number, number, SyringeType, number, number][] = [
    // label, dose, vial, water mL, syringe, expected mL, expected units
    ['10 mg in 2 mL = 5 mg/mL; 2.5 mg ÷ 5 = 0.5 mL = 50 units', 2.5, 10, 2, 'U-100', 0.5, 50],
    ['10 mg in 1 mL = 10 mg/mL; 2 mg ÷ 10 = 0.2 mL = 20 units', 2, 10, 1, 'U-100', 0.2, 20],
    ['same on U-40: 0.2 mL × 40 = 8 units', 2, 10, 1, 'U-40', 0.2, 8],
    ['5,000 mcg in 2.5 mL = 2,000 mcg/mL; 250 mcg ÷ 2,000 = 0.125 mL = 12.5 units', 250, 5000, 2.5, 'U-100', 0.125, 12.5],
    ['15 mg in 3 mL = 5 mg/mL; 7.5 mg ÷ 5 = 1.5 mL = 150 units', 7.5, 15, 3, 'U-100', 1.5, 150],
    ['2 mg in 2 mL = 1 mg/mL; 0.1 mg = 0.1 mL = 10 units', 0.1, 2, 2, 'U-100', 0.1, 10],
    ['30 mg in 3 mL = 10 mg/mL; 2.25 mg = 0.225 mL = 22.5 units', 2.25, 30, 3, 'U-100', 0.225, 22.5],
    ['5 mg in 2 mL = 2.5 mg/mL; 0.25 mg = 0.1 mL = 10 units', 0.25, 5, 2, 'U-100', 0.1, 10],
    ['10 mg in 3 mL = 3.333 mg/mL; 1 mg = 0.3 mL = 30 units', 1, 10, 3, 'U-100', 0.3, 30],
    ['6 mg in 3 mL = 2 mg/mL; 0.5 mg = 0.25 mL = 10 units on U-40', 0.5, 6, 3, 'U-40', 0.25, 10],
  ];
  it.each(cases)('%s', (_label, d, v, w, s, ml, units) => {
    expect(drawFor(d, v, w, s)).toEqual({ ml, units });
    expect(doseForUnits(units, v, w, s)).toBeCloseTo(d, 4);
  });

  it('water for an easy draw: 10 mg vial, 2 mg dose as 20 units → 1 mL; as 10 units on U-40 → 1.25 mL', () => {
    expect(waterForUnits(2, 10, 20, 'U-100')).toBe(1);
    expect(waterForUnits(2, 10, 10, 'U-40')).toBe(1.25);
  });
  it('150 units is too big for a 100-unit syringe', () => {
    expect(drawWarnings(drawFor(7.5, 15, 3, 'U-100'), 100)).toContain('too-big');
  });
  it('mcg vial and mg dose agree once converted: 5 mg vial, 250 mcg dose = 10 units in 2 mL', () => {
    expect(drawFor(250, convert(5, 'mg', 'mcg')!, 2, 'U-100').units).toBe(10);
    expect(drawFor(0.25, 5, 2, 'U-100').units).toBe(10);
  });
  it('pen: 1 mg at 0.05 mg a click = 20 clicks', () => {
    expect(doseGuide(pmed({ peptide: { kind: 'pen', waterMl: 0, syringe: 'U-100', syringeUnits: 30, amountPerClick: 0.05 } }), 1)).toEqual({ kind: 'pen', clicks: 20 });
  });
  it('blend: 10 mg BPC + 10 mg TB in a vial; 0.5 mg of the first carries 0.5 mg of the second', () => {
    const m = pmed({ name: 'BPC', strength: 10, peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50, blend: [{ name: 'TB', amount: 10, unit: 'mg' }] } });
    expect(blendAmounts(m, 0.5)).toEqual([{ name: 'BPC', amount: 0.5, unit: 'mg' }, { name: 'TB', amount: 0.5, unit: 'mg' }]);
  });
  it('tablets: 20 mg of 10 mg tablets = 2 off the stock; 5 mg = half a tablet', () => {
    expect(stockUnitsFor({ strength: 10 }, 20)).toBe(2);
    expect(stockUnitsFor({ strength: 10 }, 5)).toBe(0.5);
  });
});

describe('dose maths: properties', () => {
  it('units are always mL × the syringe’s units per mL', () => {
    fc.assert(fc.property(vialMg, water, share, syringe, (v, w, s, sy) => {
      const d = drawFor(v * s, v, w, sy);
      return close(d.units, d.ml * unitsPerMl(sy), 0.01 + 0.00005 * unitsPerMl(sy));
    }), RUNS);
  });

  it('mL is dose ÷ concentration, whatever the syringe', () => {
    fc.assert(fc.property(vialMg, water, share, (v, w, s) => {
      const dose = v * s;
      const a = drawFor(dose, v, w, 'U-100'), b = drawFor(dose, v, w, 'U-40');
      return a.ml === b.ml && close(a.ml, dose / concentration(v, w), 0.00005);
    }), RUNS);
  });

  it('U-40 shows 0.4 × the units of U-100 for the same dose (never mixed up)', () => {
    fc.assert(fc.property(vialMg, water, share, (v, w, s) => {
      const a = drawFor(v * s, v, w, 'U-100').units, b = drawFor(v * s, v, w, 'U-40').units;
      return close(b, a * 0.4, 0.01);
    }), RUNS);
  });

  it('round trip: the dose for the units drawn is the dose asked for', () => {
    fc.assert(fc.property(vialMg, water, share, syringe, (v, w, s, sy) => {
      const dose = v * s;
      const back = doseForUnits(drawFor(dose, v, w, sy).units, v, w, sy);
      // Units are rounded to 0.01, so the dose can be out by at most 0.005 units' worth (plus the 4 dp rounding).
      const perUnit = concentration(v, w) / unitsPerMl(sy);
      return close(back, dose, 0.005 * perUnit + 0.00005);
    }), RUNS);
  });

  it('water for a target number of units gives that number of units', () => {
    fc.assert(fc.property(vialMg, share, fc.integer({ min: 2, max: 100 }), syringe, (v, s, target, sy) => {
      const dose = v * s;
      const w = waterForUnits(dose, v, target, sy);
      // Water is rounded to 0.001 mL; that moves the draw by at most 0.0005 mL's worth of units, in proportion.
      return close(drawFor(dose, v, w, sy).units, target, target * (0.0005 / w) + 0.01);
    }), RUNS);
  });

  it('scales the right way: twice the dose or twice the water = twice the units; twice the vial = half', () => {
    fc.assert(fc.property(vialMg, water, fc.double({ min: 0.01, max: 0.5, noNaN: true }), syringe, (v, w, s, sy) => {
      const d = v * s;
      const base = drawFor(d, v, w, sy).units;
      return close(drawFor(2 * d, v, w, sy).units, 2 * base, 0.02)
        && close(drawFor(d, v, 2 * w, sy).units, 2 * base, 0.02)
        && close(drawFor(d, 2 * v, w, sy).units, base / 2, 0.01);
    }), RUNS);
  });

  it('mg and mcg give the same draw once the vial and dose are in the same unit', () => {
    fc.assert(fc.property(vialMg, water, share, syringe, (v, w, s, sy) => {
      const inMg = drawFor(v * s, v, w, sy);
      const inMcg = drawFor(convert(v * s, 'mg', 'mcg')!, convert(v, 'mg', 'mcg')!, w, sy);
      return close(inMg.units, inMcg.units, 0.01) && close(inMg.ml, inMcg.ml, 0.0001);
    }), RUNS);
  });

  it('a whole vial is the whole of the water', () => {
    fc.assert(fc.property(vialMg, water, syringe, (v, w, sy) => close(drawFor(v, v, w, sy).ml, w, 0.00005)), RUNS);
  });

  it('convert is reversible and 1 mg = 1,000 mcg', () => {
    fc.assert(fc.property(fc.double({ min: 0.001, max: 100_000, noNaN: true }), (x) =>
      close(convert(convert(x, 'mg', 'mcg')!, 'mcg', 'mg')!, x, 1e-9) && close(convert(x, 'mg', 'mcg')!, x * 1000, 1e-9)), RUNS);
  });

  it('warnings: too big exactly when over the syringe, too small exactly when under 2 units, half-unit marks are exact', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 400 }), fc.constantFrom(12, 20, 30, 40, 50, 100), (halves, cap) => {
      const units = halves / 2;
      const w = drawWarnings({ ml: units / 100, units }, cap);
      return w.includes('too-big') === (units > cap) && w.includes('too-small') === (units < 2) && !w.includes('not-exact');
    }), RUNS);
  });

  it('the units shown are never more than 0.05 from the units worked out', () => {
    fc.assert(fc.property(fc.double({ min: 0.05, max: 500, noNaN: true }), (u) => {
      const shown = Number(fmtUnits(u).split(' ')[0]);
      return Math.abs(shown - u) <= 0.05 + 1e-9;
    }), RUNS);
  });

  it('the draw on Today follows the water of the vial in use, not the medicine’s usual water', () => {
    fc.assert(fc.property(vialMg, water, water, share, syringe, (v, usual, mixed, s, sy) => {
      const m = pmed({ strength: v, peptide: { waterMl: usual, syringe: sy, syringeUnits: 100 },
        vials: [vial({ status: 'in-use', amount: v, waterMl: mixed, startedAt: '2026-07-01T00:00:00Z' })] });
      const g = doseGuide(m, v * s);
      return g?.kind === 'draw' && g.draw.units === drawFor(v * s, v, mixed, sy).units;
    }), RUNS);
  });

  it('pen clicks × amount per click is the dose (to a tenth of a click)', () => {
    fc.assert(fc.property(fc.double({ min: 0.01, max: 0.5, noNaN: true }), fc.double({ min: 0.1, max: 15, noNaN: true }), (perClick, d) => {
      const g = doseGuide(pmed({ peptide: { kind: 'pen', waterMl: 0, syringe: 'U-100', syringeUnits: 30, amountPerClick: perClick } }), d);
      return g?.kind === 'pen' && g.clicks !== undefined && close(g.clicks * perClick, d, 0.05 * perClick + 1e-9);
    }), RUNS);
  });

  it('blend parts stay in the vial’s proportions', () => {
    fc.assert(fc.property(vialMg, vialMg, share, (main, other, s) => {
      const m = pmed({ strength: main, peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50, blend: [{ name: 'B', amount: other, unit: 'mg' }] } });
      const [a, b] = blendAmounts(m, main * s);
      // Both amounts are rounded to 4 dp (0.1 mcg in mg), so the ratio can be out by that much of each.
      const ratio = other / main;
      return close(b.amount / a.amount, ratio, (0.00005 * (ratio + 1)) / a.amount + 1e-9);
    }), RUNS);
  });
});

describe('what is left: vials and stock', () => {
  const DAY = 86_400_000;
  const start = Date.parse('2026-07-01T00:00:00Z');
  const doseList = fc.array(fc.record({
    day: fc.integer({ min: -5, max: 25 }), amount: fc.double({ min: 0.05, max: 2, noNaN: true }),
    skipped: fc.boolean(), deleted: fc.boolean(),
  }), { maxLength: 40 });

  it('vial left = amount − doses taken from it since mixing (never below 0); doses left is whole doses only', () => {
    fc.assert(fc.property(fc.double({ min: 1, max: 30, noNaN: true }), fc.double({ min: 0.05, max: 2, noNaN: true }), doseList, (amount, usual, list) => {
      const m = pmed({ strength: amount, defaultAmount: usual, vials: [vial({ status: 'in-use', amount, startedAt: new Date(start).toISOString() })] });
      const ds = list.map((x) => dose({ takenAt: new Date(start + x.day * DAY).toISOString(), amount: x.amount, skipped: x.skipped || undefined, deletedAt: x.deleted ? 'x' : undefined }));
      const v = vialStatus(m, ds, start + 20 * DAY)!;
      const used = list.filter((x) => x.day >= 0 && !x.skipped && !x.deleted).reduce((n, x) => n + x.amount, 0);
      const left = Math.max(0, amount - used);
      return close(v.left, left, 0.0001)
        && v.dosesLeft * usual <= v.left + 1e-6 && (v.dosesLeft + 1) * usual > v.left - 1e-6;
    }), RUNS);
  });

  it('vials on hand = unopened vials + the share left in the one in use, and 0 share once past its use-within date', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), (unopened, usedShare, expired) => {
      const amount = 10;
      const m = pmed({ strength: amount, vials: [vial({ status: 'in-use', amount, startedAt: new Date(start).toISOString() }), ...Array.from({ length: unopened }, () => vial({ amount }))] });
      const ds = usedShare > 0 ? [dose({ takenAt: new Date(start + DAY).toISOString(), amount: amount * usedShare })] : [];
      const now = start + (expired ? 40 : 10) * DAY; // use within 28 days
      const n = vialStockCount(m, ds, now)!;
      const expect_ = unopened + (expired ? 0 : 1 - usedShare);
      return close(n, expect_, 0.006);
    }), RUNS);
  });

  it('tablet stock: the order doses are listed in never matters, and logging then deleting a dose changes nothing', () => {
    const base = '2026-07-01T00:00:00Z';
    fc.assert(fc.property(fc.integer({ min: 1, max: 200 }), fc.constantFrom(5, 10, 20, 25), fc.array(fc.record({
      after: fc.boolean(), amount: fc.constantFrom(5, 10, 20, 40), deleted: fc.option(fc.boolean()), skipped: fc.boolean(),
    }), { maxLength: 30 }), (count, strength, list) => {
      const m = { id: 'p', strength, stockCount: count, stockBase: { count, at: base } };
      const ds = list.map((x) => dose({ amount: x.amount, skipped: x.skipped || undefined,
        createdAt: x.after ? '2026-07-05T00:00:00Z' : '2026-06-25T00:00:00Z',
        // Deleted after the count was set (true), before it (false, only possible for a dose logged before it), or not.
        deletedAt: x.deleted === null || (x.after && x.deleted === false) ? undefined : x.deleted ? '2026-07-06T00:00:00Z' : '2026-06-26T00:00:00Z' }));
      const n = recountStock(m, ds)!;
      // Expected: count − tablets of doses logged after the count and still there + tablets of doses logged before it
      // but deleted after it (they'd been counted already).
      const want = list.reduce((acc, x) => {
        if (x.skipped) return acc;
        const t = x.amount / strength;
        if (x.after && x.deleted !== true) return acc - t; // false is treated as not deleted for these (see above)
        if (!x.after && x.deleted === true) return acc + t;
        return acc;
      }, count);
      const shuffled = recountStock(m, [...ds].reverse())!;
      const withTemp = recountStock(m, [...ds, dose({ amount: 20, createdAt: '2026-07-05T00:00:00Z', deletedAt: '2026-07-05T01:00:00Z' })])!;
      return close(n, want, 0.001) && n === shuffled && n === withTemp;
    }), RUNS);
  });
});

describe('dose check (before logging)', () => {
  // Retatrutide is in the guide (mg): the usual range comes from its mixing table and step-up.
  const reta = pmed({ name: 'Retatrutide', unit: 'mg', strength: 10 });
  const range = usualRange(reta)!;

  it('the guide gives a usual range for a known peptide', () => {
    expect(range[0]).toBeGreaterThan(0);
    expect(range[1]).toBeGreaterThan(range[0]);
  });

  it('a dose in the usual range is never flagged as unusual for the peptide', () => {
    fc.assert(fc.property(fc.double({ min: range[0], max: range[1], noNaN: true }), (x) =>
      !doseCheck(reta, x, [], Date.now()).some((f) => f.kind === 'slip' || f.kind === 'high' || f.kind === 'low')), RUNS);
  });

  it('a usual dose typed 1,000 times too big (mcg typed as mg) is caught, and the right amount offered', () => {
    fc.assert(fc.property(fc.double({ min: range[0], max: range[1], noNaN: true }), (x) => {
      const slip = doseCheck(reta, x * 1000, [], Date.now()).find((f) => f.kind === 'slip');
      return !!slip && close(slip.suggest!, x, 1e-9);
    }), RUNS);
  });

  it('three times the person’s own usual dose is flagged', () => {
    fc.assert(fc.property(fc.double({ min: range[0], max: range[1] / 3, noNaN: true }), (usual) => {
      const m = pmed({ name: 'Retatrutide', unit: 'mg', strength: 1000 }); // big vial: the vial check stays quiet
      const past = [1, 2, 3].map((k) => dose({ amount: usual, takenAt: `2026-07-0${k}T00:00:00Z` }));
      return doseCheck(m, usual * 3, past, Date.parse('2026-07-04T00:00:00Z')).some((f) => f.kind === 'usual');
    }), RUNS);
  });

  it('more than is left in the vial in use is flagged', () => {
    const m = pmed({ name: 'Retatrutide', unit: 'mg', strength: 10, vials: [vial({ status: 'in-use', amount: 10, startedAt: '2026-07-01T00:00:00Z' })] });
    const past = [dose({ amount: 8, takenAt: '2026-07-02T00:00:00Z' })];
    expect(doseCheck(m, 4, past, Date.parse('2026-07-03T00:00:00Z')).some((f) => f.kind === 'vial')).toBe(true);
    expect(doseCheck(m, 2, past, Date.parse('2026-07-03T00:00:00Z')).some((f) => f.kind === 'vial')).toBe(false);
  });
});
