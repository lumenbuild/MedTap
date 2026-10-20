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

// ── v2: vials, pens, blends, cycles, levels, supplies ───────────────────────────────────────────────
import 'fake-indexeddb/auto';
import { blendAmounts, currentVial, doseGuide, doseLevels, estimatedLevel, stockVials, supplyAlerts, supplyCount, vialsOf } from '../src/logic/peptide';
import { cycleInfo, isScheduledDay, type ScheduleSettings } from '../src/logic/schedule';
import { db } from '../src/db/db';
import { addVials, createMed, startVial } from '../src/db/repos/meds';
import { logDose } from '../src/db/repos/doses';
import { eraseAll } from '../src/db/repos/backup';
import type { CheckIn, Medication, PeptideVial, Supply } from '../src/db/schema';

const S: ScheduleSettings = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
const vial = (o: Partial<PeptideVial>): PeptideVial => ({ id: crypto.randomUUID(), status: 'stock', amount: 5, addedAt: '2026-07-01T00:00:00Z', ...o });
const pmed = (o: Partial<Medication> = {}): Medication => ({
  id: 'p', name: 'Pep', strength: 5, unit: 'mg', form: 'injection', defaultAmount: 0.25, color: '', icon: 'pill', archived: false,
  schedule: { type: 'prn' }, createdAt: '', updatedAt: '', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 30, useWithinDays: 28 }, ...o,
});

describe('vials', () => {
  it('each vial keeps its own water, so the units follow the vial in use', () => {
    const m = pmed({ vials: [vial({ status: 'finished', waterMl: 2, startedAt: '2026-06-01T00:00:00Z' }), vial({ status: 'in-use', waterMl: 2.5, startedAt: '2026-07-01T00:00:00Z' })] });
    const g = doseGuide(m, 0.25);
    expect(g?.kind === 'draw' && g.draw.units).toBe(12.5);
  });
  it('older records: the vial mixed before vial records still counts', () => {
    const m = pmed({ peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 30, mixedAt: '2026-07-01T00:00:00Z' } });
    expect(currentVial(m)?.id).toBe('legacy');
    expect(vialsOf(m)).toHaveLength(1);
  });
  it('next from stock is the soonest expiry', () => {
    const m = pmed({ vials: [vial({ id: 'b', expiry: '2027-05-01' }), vial({ id: 'a', expiry: '2027-01-01' }), vial({ id: 'c' })] });
    expect(stockVials(m).map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });
  it('pens: clicks from the amount per click', () => {
    expect(doseGuide(pmed({ peptide: { kind: 'pen', waterMl: 0, syringe: 'U-100', syringeUnits: 30, amountPerClick: 0.0135 } }), 0.25)).toEqual({ kind: 'pen', clicks: 18.5 });
    expect(doseGuide(pmed({ peptide: { kind: 'pen', waterMl: 0, syringe: 'U-100', syringeUnits: 30 } }), 0.25)).toEqual({ kind: 'pen', clicks: undefined });
  });
  it('starting a vial finishes the one in use; doses come off the vial they were taken from', async () => {
    await eraseAll();
    const med = await createMed({ ...pmed(), stockCount: 0 } as never);
    await addVials(med.id, 2, { amount: 5, lot: 'L1', expiry: '2027-01-01' });
    expect((await db.medications.get(med.id))?.stockCount).toBe(2);
    const first = stockVials((await db.medications.get(med.id))!)[0];
    await startVial(med.id, { vialId: first.id, waterMl: 2 });
    let m = (await db.medications.get(med.id))!;
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 1, source: 'manual', vialId: currentVial(m)!.id });
    await startVial(med.id, { vialId: stockVials(m)[0].id, waterMl: 3 });
    m = (await db.medications.get(med.id))!;
    expect(vialsOf(m).map((v) => v.status).sort()).toEqual(['finished', 'in-use']);
    expect(currentVial(m)?.waterMl).toBe(3);
    const doses = await db.doses.toArray();
    expect(vialStatus(m, doses, Date.now())?.left).toBe(5);
    expect(vialStatus(m, doses, Date.now(), vialsOf(m).find((v) => v.status === 'finished'))?.left).toBe(4);
  });
});

describe('blends', () => {
  it('each part in proportion to the dose', () => {
    const m = pmed({ name: 'A', strength: 10, peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 30, blend: [{ name: 'B', amount: 5, unit: 'mg' }] } });
    expect(blendAmounts(m, 0.5)).toEqual([{ name: 'A', amount: 0.5, unit: 'mg' }, { name: 'B', amount: 0.25, unit: 'mg' }]);
    expect(blendAmounts(pmed(), 0.5)).toEqual([]);
  });
});

describe('cycles', () => {
  const day = (ymd: string) => Date.parse(`${ymd}T10:00:00+10:00`);
  it('5 days on, 2 off', () => {
    const m = pmed({ schedule: { type: 'fixed', slots: [{ time: '08:00' }], cycle: { on: 5, off: 2, start: '2026-07-06' } } });
    const on = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13'].map((d) => isScheduledDay(m, day(d), S));
    expect(on).toEqual([true, true, true, true, true, false, false, true]);
  });
  it('says which week of the phase it is and when it changes', () => {
    const c = { on: 56, off: 28, start: '2026-07-01' };
    expect(cycleInfo(c, day('2026-07-15'), S)).toEqual({ phase: 'on', day: 15, length: 56, nextChange: '2026-08-26' });
    expect(cycleInfo(c, day('2026-09-01'), S)).toMatchObject({ phase: 'off', day: 7, nextChange: '2026-09-23' });
  });
});

describe('estimatedLevel', () => {
  it('halves every half-life and adds up doses', () => {
    const t0 = Date.parse('2026-07-01T00:00:00Z');
    const pts = estimatedLevel([dose({ takenAt: new Date(t0).toISOString(), amount: 1 }), dose({ takenAt: new Date(t0 + 168 * 3_600_000).toISOString(), amount: 1 })],
      168, t0, t0 + 336 * 3_600_000, 3);
    expect(pts.map((p) => p.v)).toEqual([1, 1.5, 0.75]);
  });
});

describe('doseLevels', () => {
  it('weight change and check-ins at each dose', () => {
    const w = (d: string, kg: number) => ({ t: Date.parse(`${d}T00:00:00Z`), kg });
    const ci = (d: string, chips: string[], appetite: number) => ({ id: d, at: `${d}T09:00:00Z`, chips, appetite, createdAt: '', updatedAt: '' }) as CheckIn;
    const levels = doseLevels(
      [dose({ takenAt: '2026-07-01T00:00:00Z', amount: 0.25 }), dose({ takenAt: '2026-07-08T00:00:00Z', amount: 0.25 }), dose({ takenAt: '2026-07-15T00:00:00Z', amount: 0.5 })],
      [w('2026-07-01', 100), w('2026-07-15', 98), w('2026-07-29', 97)],
      [ci('2026-07-02', ['Nausea'], 2), ci('2026-07-03', ['Nausea', 'Low appetite'], 3), ci('2026-07-16', [], 4)],
      Date.parse('2026-07-29T12:00:00Z'));
    expect(levels).toHaveLength(2);
    expect(levels[0]).toMatchObject({ dose: 0.25, doses: 2, weightStart: 100, weightEnd: 98, perWeek: -1, appetite: 2.5, noticed: [{ chip: 'Nausea', n: 2 }, { chip: 'Low appetite', n: 1 }] });
    expect(levels[1]).toMatchObject({ dose: 0.5, weightStart: 98, weightEnd: 97, perWeek: -0.5 });
  });
});

describe('supplies', () => {
  const meds = [pmed({ id: 'v' }), pmed({ id: 'pen', peptide: { kind: 'pen', waterMl: 0, syringe: 'U-100', syringeUnits: 30 } }),
    pmed({ id: 'w', vials: [vial({ status: 'in-use', startedAt: '2026-07-05T00:00:00Z', waterMl: 2 })] })];
  const doses = [dose({ medicationId: 'v', createdAt: '2026-07-02T00:00:00Z' }), dose({ medicationId: 'pen', createdAt: '2026-07-02T00:00:00Z' }),
    dose({ medicationId: 'v', createdAt: '2026-07-02T00:00:00Z', skipped: true }), dose({ medicationId: 'v', createdAt: '2026-06-01T00:00:00Z' })];
  const sup = (kind: Supply['kind'], count: number, o: Partial<Supply> = {}) => ({ id: kind, kind, base: { count, at: '2026-07-01T00:00:00Z' }, createdAt: '', updatedAt: '', ...o }) as Supply;
  it('counts down from doses logged since the count was set', () => {
    expect(supplyCount(sup('syringes', 10), meds, doses)).toBe(9);
    expect(supplyCount(sup('pen-needles', 10), meds, doses)).toBe(9);
    expect(supplyCount(sup('swabs', 10), meds, doses)).toBe(8);
    expect(supplyCount(sup('sharps', 3), meds, doses)).toBe(5);
    expect(supplyCount(sup('water', 30), meds, doses)).toBe(28);
  });
  it('warns when low or the sharps container is nearly full', () => {
    const a = supplyAlerts([sup('syringes', 10, { warnAt: 9 }), sup('swabs', 10, { warnAt: 2 }), sup('sharps', 7, { capacity: 10 })], meds, doses);
    expect(a.map((x) => x.supply.kind)).toEqual(['syringes', 'sharps']);
  });
});
