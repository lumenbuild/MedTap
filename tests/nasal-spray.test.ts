import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { bottleSprays, doseGuide, guideText, liquidForSprays, nostrilSplit, sprayFor, supplyCount, vialStatus } from '../src/logic/peptide';

const NOW = Date.parse('2026-11-14T09:00:00Z');
const st = { createdAt: '2026-11-01T00:00:00Z', updatedAt: '' };
const semax = (o: Partial<Medication> = {}): Medication => ({ id: 's', name: 'Semax', strength: 10000, unit: 'mcg', form: 'nasal spray', defaultAmount: 300,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false,
  peptide: { kind: 'nasal', waterMl: 5, syringe: 'U-100', syringeUnits: 100, sprayMl: 0.1, primeSprays: 5 },
  vials: [{ id: 'v1', status: 'in-use', amount: 10000, waterMl: 5, addedAt: st.createdAt, startedAt: st.createdAt }], ...st, ...o });

describe('nasal spray maths', () => {
  it('10 mg in 5 mL at 0.1 mL a spray is 200 mcg a spray', () => {
    const s = sprayFor(400, 10000, 5, 0.1);
    expect(s.perSpray).toBe(200);
    expect(s.sprays).toBe(2);
    expect(s.delivered).toBe(400);
    expect(s.split).toBe('1 in each nostril');
  });
  it('whole sprays: the nearest, and how far that is from the dose', () => {
    const s = sprayFor(300, 10000, 5, 0.1); // 1.5 sprays
    expect(s.exact).toBe(1.5);
    expect(s.sprays).toBe(2);
    expect(s.off).toBe(0.333);
  });
  it('at least one spray', () => { expect(sprayFor(10, 10000, 5, 0.1).sprays).toBe(1); });
  it('the liquid that makes a whole number of sprays exact', () => {
    // 300 mcg in 2 sprays = 150 a spray; 10,000 mcg × 0.1 mL ÷ 150 = 6.667 mL
    const ml = liquidForSprays(300, 10000, 2, 0.1);
    expect(ml).toBeCloseTo(6.667, 3);
    expect(sprayFor(300, 10000, ml, 0.1).off).toBeCloseTo(0, 2);
  });
  it('sprays in a bottle, after priming', () => {
    expect(bottleSprays(5, 0.1, 5)).toBe(45);
    expect(bottleSprays(0.4, 0.1, 5)).toBe(0);
  });
  it('splits between nostrils', () => {
    expect(nostrilSplit(1)).toBe('one nostril');
    expect(nostrilSplit(3)).toBe('2 in one nostril, 1 in the other');
    expect(nostrilSplit(4)).toBe('2 in each nostril');
  });
});

describe('nasal sprays in the app', () => {
  it('the dose guide is in sprays', () => {
    const g = doseGuide(semax(), 400);
    expect(g?.kind).toBe('spray');
    expect(guideText(semax(), 400)).toBe('2 sprays (1 in each nostril)');
  });
  it('priming comes off what is left in the bottle', () => {
    // 5 priming sprays at 200 mcg = 1,000 mcg; one 400 mcg dose logged.
    const doses: Dose[] = [{ id: 'd1', medicationId: 's', takenAt: '2026-11-02T08:00:00Z', amount: 400, source: 'manual', vialId: 'v1', ...st }];
    const v = vialStatus(semax({ defaultAmount: 400 }), doses, NOW)!;
    expect(v.left).toBe(8600);
    expect(v.dosesLeft).toBe(21);
  });
  it('nasal doses use no syringes or swabs', () => {
    const doses: Dose[] = [{ id: 'd1', medicationId: 's', takenAt: '2026-11-02T08:00:00Z', amount: 400, source: 'manual', ...st, createdAt: '2026-11-02T08:00:00Z' }];
    expect(supplyCount({ kind: 'syringes', base: { count: 10, at: '2026-11-01T00:00:00Z' } }, [semax()], doses)).toBe(10);
    expect(supplyCount({ kind: 'swabs', base: { count: 10, at: '2026-11-01T00:00:00Z' } }, [semax()], doses)).toBe(10);
  });
});
