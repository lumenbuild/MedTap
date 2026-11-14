import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createMed } from '../src/db/repos/meds';
import { logDose } from '../src/db/repos/doses';
import { addCheckIn } from '../src/db/repos/checkIns';
import { logFood } from '../src/db/repos/food';
import { fingerprint } from '../src/logic/duplicate';

const base = { name: 'Stim', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, schedule: { type: 'interval' as const, intervalHours: 4 }, color: '#0B7A75', icon: 'pill' };
const live = async () => (await db.doses.toArray()).filter((d) => !d.deletedAt);

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });

describe('a second tap is not a second entry', () => {
  it('the same dose tapped twice is logged once, and stock comes off once', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const input = { medicationId: med.id, takenAt: new Date().toISOString(), amount: 10, source: 'manual' as const };
    const a = await logDose(input);
    const b = await logDose({ ...input, takenAt: new Date(Date.now() + 5_000).toISOString() });
    expect(a.duplicate).toBeFalsy();
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await live()).toHaveLength(1);
    expect((await db.medications.get(med.id))!.stockCount).toBe(29);
  });
  it('two taps at the same moment still make one entry', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const input = { medicationId: med.id, takenAt: new Date().toISOString(), amount: 10, source: 'manual' as const };
    await Promise.all([logDose(input), logDose(input), logDose(input)]);
    expect(await live()).toHaveLength(1);
  });
  it('Log again, a different amount or a skip are new entries', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const input = { medicationId: med.id, takenAt: new Date().toISOString(), amount: 10, source: 'manual' as const };
    await logDose(input);
    expect((await logDose(input, { again: true })).duplicate).toBeFalsy();
    expect((await logDose({ ...input, amount: 5 })).duplicate).toBeFalsy();
    expect((await logDose({ ...input, skipped: true })).duplicate).toBeFalsy();
    expect(await live()).toHaveLength(4);
  });
  it('a backdated dose far from the first is its own entry', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const now = Date.now();
    await logDose({ medicationId: med.id, takenAt: new Date(now).toISOString(), amount: 10, source: 'manual' });
    expect((await logDose({ medicationId: med.id, takenAt: new Date(now - 4 * 3_600_000).toISOString(), amount: 10, source: 'backdated' })).duplicate).toBeFalsy();
  });
  it('a drink tapped twice is one drink and its water counts once', async () => {
    const at = new Date().toISOString();
    const a = await addCheckIn({ at, chips: ['Caffeine'], note: 'Coffee', caffeineMg: 95 });
    const b = await addCheckIn({ at, chips: ['Caffeine'], note: 'Coffee', caffeineMg: 95 });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await db.checkIns.count()).toBe(1);
    const [day] = await db.daily.toArray();
    expect(day?.waterMl ?? 0).toBe(a.waterMl ?? 0);
  });
  it('a different chip is a different check-in', async () => {
    const at = new Date().toISOString();
    await addCheckIn({ at, chips: ['Nausea'] });
    expect((await addCheckIn({ at, chips: ['Headache'] })).duplicate).toBeFalsy();
    expect(await db.checkIns.count()).toBe(2);
  });
  it('the same food tapped twice is logged once', async () => {
    const at = new Date().toISOString();
    const x = { name: 'Greek yoghurt', servings: 1, nutrients: { kcal: 120, protein: 15 }, at, date: at.slice(0, 10), personId: 'me' };
    const [a, b] = await Promise.all([logFood(x), logFood(x)]);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await db.foodLogs.count()).toBe(1);
    const [day] = await db.daily.toArray();
    expect(day.proteinG).toBe(15);
  });
  it('the fingerprint ignores ids, times and empty fields, and chip order', () => {
    expect(fingerprint({ id: 'a', at: '1', chips: ['B', 'A'], note: '', mood: 3 })).toBe(fingerprint({ id: 'b', at: '2', chips: ['A', 'B'], mood: 3, skipped: false }));
    expect(fingerprint({ mood: 3 })).not.toBe(fingerprint({ mood: 4 }));
  });
});
