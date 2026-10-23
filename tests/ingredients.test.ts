import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { combinedTotals, ingredientsOf, overlaps, parseIngredients } from '../src/logic/ingredients';

const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'x', strength: 500, unit: 'mg', form: 'tablet', defaultAmount: 1000, schedule: { type: 'prn' }, color: '', icon: 'pill', archived: false, createdAt: '', updatedAt: '', ...o });
const NOW = Date.parse('2026-09-01T12:00:00Z');
const dose = (medicationId: string, hoursAgo: number, amount: number): Dose => ({ id: `${medicationId}${hoursAgo}`, medicationId, takenAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(), amount, source: 'manual', createdAt: '', updatedAt: '' });

describe('ingredients', () => {
  it('from brand names, with combinations and strengths', () => {
    expect(ingredientsOf(med({ name: 'Panadol Rapid' }))).toEqual([{ name: 'paracetamol', mg: 500 }]);
    expect(ingredientsOf(med({ name: 'Panadeine Forte' })).map((i) => i.name)).toEqual(['paracetamol', 'codeine']);
    expect(ingredientsOf(med({ name: 'Mounjaro', unit: 'mg', strength: 5 }))).toEqual([{ name: 'tirzepatide', mg: 5 }]);
    expect(ingredientsOf(med({ name: 'Something else' }))).toEqual([]);
    expect(parseIngredients('Paracetamol 500, codeine 8 mg')).toEqual([{ name: 'paracetamol', mg: 500 }, { name: 'codeine', mg: 8 }]);
  });
  it('flags the same ingredient and the same class, per person', () => {
    const meds = [med({ id: 'a', name: 'Panadol' }), med({ id: 'b', name: 'Codral Cold & Flu' }), med({ id: 'c', name: 'Nurofen', strength: 200 }), med({ id: 'd', name: 'Voltaren', strength: 25 }), med({ id: 'e', name: 'Panadol', personId: 'kid' })];
    const o = overlaps(meds, (m) => m.personId ?? 'me');
    expect(o.map((x) => [x.a.id, x.b.id, x.kind, x.what])).toEqual([['a', 'b', 'same', 'paracetamol'], ['c', 'd', 'class', 'anti-inflammatories (NSAIDs)']]);
  });
  it('combined 24-hour total against the lowest limit set', () => {
    const panadol = med({ id: 'p', name: 'Panadol', schedule: { type: 'prn', maxPer24h: 4 } }); // 4 × 1000 mg = 4000 mg
    const codral = med({ id: 'c', name: 'Panadeine', strength: 500, defaultAmount: 1000 });
    const doses = [dose('p', 10, 1000), dose('p', 6, 1000), dose('c', 3, 1000)];
    const n = combinedTotals(panadol, 1000, [panadol, codral], doses, NOW, () => true);
    expect(n).toEqual([{ ingredient: 'paracetamol', totalMg: 4000, limitMg: 4000, others: ['Panadeine'] }].filter(() => false));
    const over = combinedTotals(panadol, 1000, [panadol, codral], [...doses, dose('c', 1, 1000)], NOW, () => true);
    expect(over).toEqual([{ ingredient: 'paracetamol', totalMg: 5000, limitMg: 4000, others: ['Panadeine'] }]);
  });
});
