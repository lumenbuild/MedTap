import { describe, it, expect } from 'vitest';
import type { Dose, Medication, PeptideVial } from '../src/db/schema';
import { needsNewVial, vialStatus, vialStockCount } from '../src/logic/peptide';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 9, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const iso = (t: number) => new Date(t).toISOString();
const vial = (id: string, status: PeptideVial['status'], o: Partial<PeptideVial> = {}): PeptideVial => ({ id, status, amount: 10, addedAt: iso(NOW - 30 * DAY), ...o });
const med = (vials: PeptideVial[], useWithinDays = 28): Medication => ({ id: 'm', name: 'Tirzepatide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 2.5, schedule: { type: 'fixed', slots: [{ time: '08:00' }] },
  color: '', icon: 'syringe', archived: false, peptide: { kind: 'vial', waterMl: 2, syringe: 'U-100', syringeUnits: 100, useWithinDays }, vials, ...st });
const dose = (k: number, amount = 2.5, vialId?: string): Dose => ({ id: `d${k}`, medicationId: 'm', takenAt: iso(NOW - k * DAY), amount, source: 'manual', vialId, ...st });

describe('stock from the vial records', () => {
  it('unopened vials plus what is left of the one in use', () => {
    const m = med([vial('a', 'in-use', { startedAt: iso(NOW - 10 * DAY), waterMl: 2 }), vial('b', 'stock'), vial('c', 'stock')]);
    expect(vialStockCount(m, [dose(7, 2.5, 'a')], NOW)).toBe(2.75);
  });
  it('a used-up vial counts nothing, and is flagged for the next one', () => {
    const m = med([vial('a', 'in-use', { startedAt: iso(NOW - 20 * DAY), waterMl: 2 }), vial('b', 'stock')]);
    const ds = [dose(14, 5, 'a'), dose(7, 4, 'a')];
    expect(vialStockCount(m, ds, NOW)).toBe(1.1);
    expect(needsNewVial(vialStatus(m, ds, NOW), 2.5)).toBe(true);
  });
  it('past its use-within date counts nothing', () => {
    const m = med([vial('a', 'in-use', { startedAt: iso(NOW - 30 * DAY), waterMl: 2 }), vial('b', 'stock')]);
    expect(vialStockCount(m, [], NOW)).toBe(1);
    expect(needsNewVial(vialStatus(m, [], NOW), 2.5)).toBe(true);
  });
  it('no vial records: no count from them', () => {
    expect(vialStockCount({ ...med([]), vials: undefined }, [], NOW)).toBeUndefined();
  });
});
