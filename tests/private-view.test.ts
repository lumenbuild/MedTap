import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { discreetName, disguise, hiddenMedIds, privateRule, viewMeds, withoutHidden } from '../src/logic/privateView';

const st = { createdAt: '', updatedAt: '' };
const med = (o: Partial<Medication>): Medication => ({ id: 'm', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', times: ['07:00'] } as Medication['schedule'], color: 'blue', icon: 'pill', archived: false, ...st, ...o });
const tirz = med({ id: 't', name: 'Tirzepatide', form: 'injection', peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 50 } as Medication['peptide'], vials: [] });
const vy = med({ id: 'v', privateView: 'cover', coverName: 'Vitamin D', ingredients: [{ name: 'lisdexamfetamine', mg: 50 }], instructions: 'With breakfast', scriptNotes: 'Dr L' });
const para = med({ id: 'p', name: 'Paracetamol' });
const dose = (medicationId: string): Dose => ({ id: medicationId + 'd', medicationId, takenAt: '', amount: 1, source: 'manual', ...st });

describe('private view', () => {
  it('peptides are left out by default, everything else shown unless chosen', () => {
    expect(privateRule(tirz, true)).toBe('hide');
    expect(privateRule(tirz, false)).toBe('show');
    expect(privateRule({ ...tirz, privateView: 'show' }, true)).toBe('show');
    expect(privateRule(para, true)).toBe('show');
    expect(privateRule(vy, true)).toBe('cover');
  });
  it('covered medicines lose everything that identifies them but keep their schedule and colour', () => {
    const d = disguise(vy);
    expect(d.name).toBe('Vitamin D');
    expect(d.ingredients).toBeUndefined(); expect(d.instructions).toBeUndefined(); expect(d.scriptNotes).toBeUndefined(); expect(d.nickname).toBeUndefined();
    expect(d.schedule).toEqual(vy.schedule); expect(d.color).toBe('blue'); expect(d.id).toBe('v');
    expect(disguise(med({ privateView: 'cover', form: 'injection' })).name).toBe('Medication');
    expect(disguise(tirz).form).toBe('other');
  });
  it('the list, ids and records follow the rules', () => {
    const shown = viewMeds([tirz, vy, para], true);
    expect(shown.map((m) => m.name)).toEqual(['Vitamin D', 'Paracetamol']);
    const hidden = hiddenMedIds([tirz, vy, para], true);
    expect([...hidden]).toEqual(['t']);
    expect(withoutHidden([dose('t'), dose('v'), dose('p')], hidden).map((d) => d.medicationId)).toEqual(['v', 'p']);
  });
  it('lock-screen names', () => {
    const shown = (m: Medication) => m.nickname || m.name;
    expect(discreetName(tirz, true, shown)).toBeNull();
    expect(discreetName(vy, true, shown)).toBe('Vitamin D');
    expect(discreetName(para, true, shown)).toBe('Paracetamol');
  });
});
