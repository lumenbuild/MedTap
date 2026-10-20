import { describe, it, expect } from 'vitest';
import {
  concentration, convert, doseForUnits, drawFor, drawWarnings, fmtUnits, scheduleAtDose, titrationSteps,
  vialStatus, waterForUnits,
} from '../src/logic/peptide';
import type { Dose } from '../src/db/schema';

const dose = (o: Partial<Dose>): Dose => ({ id: crypto.randomUUID(), medicationId: 'p', takenAt: '', amount: 0.25, source: 'manual', createdAt: '', updatedAt: '', ...o });

describe('reconstitution maths', () => {
  it('5 mg vial + 2 mL water: 2.5 mg/mL; 0.25 mg = 0.1 mL = 10 units on U-100', () => {
    expect(concentration(5, 2)).toBe(2.5);
    expect(drawFor(0.25, 5, 2, 'U-100')).toEqual({ ml: 0.1, units: 10 });
  });
  it('mcg doses from a mg vial: 10 mg + 2 mL, 250 mcg = 5 units', () => {
    const vialMcg = convert(10, 'mg', 'mcg')!;
    expect(vialMcg).toBe(10_000);
    expect(drawFor(250, vialMcg, 2, 'U-100').units).toBe(5);
  });
  it('U-40 syringes have 40 units per mL', () => {
    expect(drawFor(0.25, 5, 2, 'U-40')).toEqual({ ml: 0.1, units: 4 });
  });
  it('works backwards from units, and finds the water for an easy draw', () => {
    expect(doseForUnits(10, 5, 2, 'U-100')).toBe(0.25);
    expect(waterForUnits(0.25, 5, 20, 'U-100')).toBe(4); // 4 mL makes 0.25 mg = 20 units
  });
  it('flags draws that are hard to measure or too big for the syringe', () => {
    expect(drawWarnings({ ml: 0.015, units: 1.5 }, 30)).toEqual(['too-small']);
    expect(drawWarnings({ ml: 0.4, units: 40 }, 30)).toEqual(['too-big']);
    expect(drawWarnings({ ml: 0.0833, units: 8.33 }, 100)).toEqual(['not-exact']);
    expect(drawWarnings({ ml: 0.1, units: 10 }, 30)).toEqual([]);
  });
  it('does not convert units that are not amounts', () => {
    expect(convert(1, 'mg', 'mL')).toBeUndefined();
    expect(fmtUnits(7.5)).toBe('7.5 units');
    expect(fmtUnits(10)).toBe('10 units');
  });
});

describe('vialStatus', () => {
  const med = { id: 'p', strength: 5, defaultAmount: 0.5, peptide: { waterMl: 2, syringe: 'U-100' as const, syringeUnits: 30, useWithinDays: 28, mixedAt: '2026-07-01T00:00:00Z' } };
  it('counts doses since mixing, ignoring skipped, deleted and earlier ones', () => {
    const v = vialStatus(med, [
      dose({ takenAt: '2026-07-02T00:00:00Z', amount: 0.5 }),
      dose({ takenAt: '2026-07-09T00:00:00Z', amount: 1 }),
      dose({ takenAt: '2026-07-10T00:00:00Z', amount: 1, skipped: true }),
      dose({ takenAt: '2026-07-10T00:00:00Z', amount: 1, deletedAt: 'x' }),
      dose({ takenAt: '2026-06-30T00:00:00Z', amount: 1 }),
    ], Date.parse('2026-07-15T00:00:00Z'))!;
    expect(v.used).toBe(1.5);
    expect(v.left).toBe(3.5);
    expect(v.dosesLeft).toBe(7);
    expect(v.expired).toBe(false);
    expect(new Date(v.useBy!).toISOString()).toBe('2026-07-29T00:00:00.000Z');
  });
  it('is past its use-within date', () => {
    expect(vialStatus(med, [], Date.parse('2026-08-01T00:00:00Z'))!.expired).toBe(true);
  });
  it('nothing until a vial has been mixed', () => {
    expect(vialStatus({ ...med, peptide: { ...med.peptide, mixedAt: undefined } }, [], 0)).toBeUndefined();
  });
});

describe('titrationSteps', () => {
  it('steps up every 4 weeks to the target', () => {
    expect(titrationSteps({ start: 0.25, from: '2026-07-05', step: 0.25, everyDays: 28, until: 1 })).toEqual([
      { from: '2026-07-05', dose: 0.25 }, { from: '2026-08-02', dose: 0.5 }, { from: '2026-08-30', dose: 0.75 }, { from: '2026-09-27', dose: 1 },
    ]);
  });
  it('the last step lands on the target even if it is not a whole step away', () => {
    expect(titrationSteps({ start: 2.5, from: '2026-07-05', step: 2.5, everyDays: 28, until: 6 }).map((x) => x.dose)).toEqual([2.5, 5, 6]);
  });
  it('steps down for a taper', () => {
    expect(titrationSteps({ start: 30, from: '2026-07-01', step: -10, everyDays: 7, until: 10 }).map((x) => x.dose)).toEqual([30, 20, 10]);
  });
  it('nothing for numbers that never reach the target', () => {
    expect(titrationSteps({ start: 1, from: '2026-07-01', step: -1, everyDays: 7, until: 5 })).toEqual([]);
    expect(titrationSteps({ start: 1, from: '2026-07-01', step: 0, everyDays: 7, until: 5 })).toEqual([]);
    expect(titrationSteps({ start: 0.001, from: '2026-07-01', step: 0.001, everyDays: 1, until: 1000 })).toHaveLength(52);
  });
  it('a titrated schedule uses one dose at every time', () => {
    expect(scheduleAtDose({ type: 'fixed', slots: [{ time: '08:00', amount: 2 }], days: [0] })).toEqual({ type: 'fixed', slots: [{ time: '08:00' }], days: [0] });
  });
});
