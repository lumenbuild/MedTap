import { describe, it, expect } from 'vitest';
import type { Dose, Medication } from '../src/db/schema';
import { interactions, unstudied } from '../src/logic/interactions';
import { ingredientsOf, overlaps } from '../src/logic/ingredients';
import { liveSnoozes, snoozeOf, withoutSnoozed, type PlannedReminder } from '../src/logic/notify';

const med = (id: string, name: string, o: Partial<Medication> = {}): Medication => ({ id, name, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1, schedule: { type: 'prn' }, color: '', icon: 'pill', archived: false, createdAt: '', updatedAt: '', ...o });
const me = () => 'me';
const keys = (ms: Medication[]) => interactions(ms, (m) => m.personId ?? 'me').map((x) => x.key.split(':')[1]);

describe('interactions', () => {
  it('flags well-known pairs, by brand or generic name', () => {
    expect(keys([med('a', 'Zoloft 50mg'), med('b', 'Tramal SR')])).toEqual(['serotonin']);
    expect(keys([med('a', 'Lexapro'), med('b', 'Nurofen')])).toEqual(['bleed-ssri']);
    expect(keys([med('a', 'Eliquis'), med('b', 'Voltaren')])).toEqual(['bleed-thinner']);
    expect(keys([med('a', 'Endone'), med('b', 'Valium')])).toEqual(['breathing']);
    expect(keys([med('a', 'Vyvanse'), med('b', 'Sudafed')])).toEqual(['stim-decongestant']);
    expect(keys([med('a', 'Viagra'), med('b', 'Anginine')])).toEqual(['nitrate']);
    expect(keys([med('a', 'Panadol'), med('b', 'Zyrtec')])).toEqual([]);
  });
  it('covers GLP-1 and research peptides', () => {
    expect(keys([med('a', 'Ozempic'), med('b', 'Lantus')])).toEqual(['low-sugar']);
    expect(keys([med('a', 'Retatrutide'), med('b', 'Diamicron')])).toEqual(['low-sugar']);
    expect(keys([med('a', 'Mounjaro'), med('b', 'Levlen ED')])).toEqual(['pill']);
    expect(keys([med('a', 'Ozempic'), med('b', 'Levlen ED')])).toEqual([]); // the pill note is on tirzepatide's label only
    expect(keys([med('a', 'CJC-1295 / Ipamorelin'), med('b', 'Metformin XR')])).toEqual(['gh-sugar']);
    expect(keys([med('a', 'MK-677'), med('b', 'Jardiance')])).toEqual(['gh-sugar']);
    expect(keys([med('a', 'PT-141'), med('b', 'Naltrexone 50 mg')])).toEqual(['naltrexone']);
    expect(keys([med('a', 'Cagrilintide'), med('b', 'NovoRapid')])).toEqual(['amylin-insulin']);
    // Two GLP-1s (e.g. retatrutide with semaglutide) are the same-class check.
    expect(overlaps([med('a', 'Retatrutide'), med('b', 'Wegovy')], me).map((o) => o.kind)).toEqual(['class']);
  });
  it('only within one person, unless shared', () => {
    expect(keys([med('a', 'Zoloft'), med('b', 'Tramadol', { personId: 'kid' })])).toEqual([]);
    expect(keys([med('a', 'Zoloft'), med('b', 'Tramadol', { personId: 'kid', shared: true })])).toEqual(['serotonin']);
    expect(keys([med('a', 'Zoloft'), med('b', 'Tramadol', { archived: true })])).toEqual([]);
  });
  it('research peptides are "not studied"', () => {
    expect(unstudied(med('a', 'BPC-157'))).toBe(true);
    expect(unstudied(med('a', 'TB-500 2mg'))).toBe(true);
    expect(unstudied(med('a', 'Mystery blend', { peptide: { mixed: true } as unknown as Medication['peptide'] }))).toBe(true);
    expect(unstudied(med('a', 'Ozempic'))).toBe(false);
    expect(ingredientsOf(med('a', 'BPC 157 + TB 500')).map((i) => i.name)).toEqual(['bpc-157']);
  });
});

describe('snooze', () => {
  const NOW = Date.parse('2026-09-01T08:00:00Z');
  const z = snoozeOf({ medId: 'm', amount: 50, dueAt: NOW - 600_000 }, NOW);
  it('reminds again in 15 minutes, until something is logged', () => {
    expect(z.at - NOW).toBe(15 * 60_000);
    expect(liveSnoozes([z], [], NOW + 60_000)).toHaveLength(1);
    expect(liveSnoozes([z], [], z.at + 1)).toHaveLength(0);
    const d = { id: 'd', medicationId: 'm', takenAt: new Date(NOW).toISOString(), amount: 50, source: 'manual', createdAt: new Date(NOW + 120_000).toISOString(), updatedAt: '' } as Dose;
    expect(liveSnoozes([z], [d], NOW + 180_000)).toHaveLength(0);
  });
  it('replaces the same dose\'s earlier reminders, not later ones', () => {
    const r = (at: number, dueAt = z.dueAt): PlannedReminder => ({ id: at, at, medId: 'm', amount: 50, kind: 'nudge', dueAt });
    expect(withoutSnoozed([r(NOW + 300_000), r(NOW + 3_600_000), r(NOW + 300_000, NOW + 86_400_000)], [z]).map((x) => x.at)).toEqual([NOW + 3_600_000, NOW + 300_000]);
  });
});
