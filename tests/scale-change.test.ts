import { describe, it, expect } from 'vitest';
import { methodChange, rebaseScale } from '../src/logic/bodyComp';
import type { BodyEntry } from '../src/db/schema';

const e = (date: string, weightKg: number, bodyFatPct?: number, extra: Partial<BodyEntry> = {}): BodyEntry =>
  ({ id: date, date, createdAt: '', updatedAt: '', weightKg, bodyFatPct, ...extra });

// A scale that switched method overnight: body fat 52% → 44% with the weight unchanged.
const switched = [
  e('2026-03-01', 120, 52.0, { visceralFat: 21 }), e('2026-03-02', 119.8, 51.9, { visceralFat: 21 }),
  e('2026-03-03', 119.7, 51.8, { visceralFat: 21 }), e('2026-03-04', 119.6, 51.8, { visceralFat: 21 }),
  e('2026-03-05', 119.6, 44.1), e('2026-03-06', 119.2, 43.8, { visceralFat: 3 }), e('2026-03-07', 119.0, 43.9, { visceralFat: 3 }),
  e('2026-03-08', 118.8, 43.7, { visceralFat: 3 }),
];

describe('scale change of method', () => {
  it('finds the overnight step in body fat and visceral fat', () => {
    expect(methodChange(switched, 'bodyFatPct')).toBe('2026-03-05');
    expect(methodChange(switched, 'visceralFat')).toBe('2026-03-06');
  });
  it('keeps each measure only from its change on, and leaves weight alone', () => {
    const r = rebaseScale(switched);
    expect(r.changedOn).toBe('2026-03-05');
    expect(r.body.filter((b) => b.bodyFatPct !== undefined).map((b) => b.date)[0]).toBe('2026-03-05');
    expect(r.body.every((b) => b.weightKg !== undefined)).toBe(true);
    expect(r.body.find((b) => b.date === '2026-03-04')!.visceralFat).toBeUndefined();
  });
  it('a steady fall in body fat with real weight loss is not a change of method', () => {
    const real = Array.from({ length: 30 }, (_, i) => e(`2026-04-${String(i + 1).padStart(2, '0')}`, 120 - i * 0.4, 45 - i * 0.25));
    expect(methodChange(real, 'bodyFatPct')).toBeUndefined();
    expect(rebaseScale(real).body).toBe(real);
  });
  it('one odd reading is not a change of method', () => {
    const odd = [...switched.slice(4), e('2026-03-09', 118.7, 51), e('2026-03-10', 118.6, 43.6)];
    expect(methodChange(odd, 'bodyFatPct')).toBeUndefined();
  });
});

import { strengthCheck } from '../src/logic/supplements';
describe('supplement strength check', () => {
  it('flags 1.2 mg of magnesium and passes 300 mg', () => {
    expect(strengthCheck({ name: 'Magnesium Citrate', strength: 1.2, unit: 'mg' })?.name).toBe('Magnesium');
    expect(strengthCheck({ name: 'Magnesium Citrate', strength: 300, unit: 'mg' })).toBeUndefined();
    expect(strengthCheck({ name: 'Ritalin', strength: 10, unit: 'mg' })).toBeUndefined();
  });
});
