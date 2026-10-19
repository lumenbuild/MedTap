import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createMed } from '../src/db/repos/meds';
import { logDose, removeDose, restoreDose, updateDose } from '../src/db/repos/doses';
import { linkTag } from '../src/db/repos/tags';
import { addPendingTag, getSettings } from '../src/db/repos/settings';

const base = {
  name: 'Stim', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
  schedule: { type: 'interval' as const, intervalHours: 4 }, color: '#0B7A75', icon: 'pill',
};

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('stock', () => {
  it('decrements on log and undo restores it', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const d = await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 20, source: 'manual' });
    expect((await db.medications.get(med.id))!.stockCount).toBe(28);
    await removeDose(d.id);
    expect((await db.medications.get(med.id))!.stockCount).toBe(30);
    expect((await db.doses.get(d.id))!.deletedAt).toBeTruthy();
    await removeDose(d.id); // undoing twice doesn't double-restore
    expect((await db.medications.get(med.id))!.stockCount).toBe(30);
    await restoreDose(d.id);
    expect((await db.medications.get(med.id))!.stockCount).toBe(28);
    expect((await db.doses.get(d.id))!.deletedAt).toBeUndefined();
  });

  it('follows amount edits', async () => {
    const med = await createMed({ ...base, stockCount: 30 });
    const d = await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 10, source: 'manual' });
    await updateDose(d.id, { amount: 15 });
    expect((await db.medications.get(med.id))!.stockCount).toBe(28.5);
  });

  it('leaves medications without a stock count alone', async () => {
    const med = await createMed(base);
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 10, source: 'manual' });
    expect((await db.medications.get(med.id))!.stockCount).toBeUndefined();
  });

  it('records a started event for new medications', async () => {
    const med = await createMed(base);
    expect(await db.medEvents.where('medicationId').equals(med.id).count()).toBe(1);
  });
});

describe('tags', () => {
  it('linking a pending tag clears it from the pending list', async () => {
    const med = await createMed(base);
    await addPendingTag('abcd2345');
    expect((await getSettings()).pendingTags).toEqual(['abcd2345']);
    await linkTag('abcd2345', med.id, 'Kitchen');
    expect((await getSettings()).pendingTags).toEqual([]);
    expect((await db.tags.get('abcd2345'))!.medicationId).toBe(med.id);
  });
});

import { upsertBody, undoBody } from '../src/db/repos/body';

describe('body entries', () => {
  it('fill in one entry per day and undo puts it back', async () => {
    const a = await upsertBody('2026-07-15', { weightKg: 80 });
    const b = await upsertBody('2026-07-15', { waistCm: 90 });
    expect(b.id).toBe(a.id);
    expect(await db.bodyEntries.count()).toBe(1);
    expect(await db.bodyEntries.get(a.id)).toMatchObject({ weightKg: 80, waistCm: 90 });
    await undoBody(b.id, b.before);
    expect((await db.bodyEntries.get(a.id))?.waistCm).toBeUndefined();
    await undoBody(a.id, a.before);
    expect((await db.bodyEntries.get(a.id))?.deletedAt).toBeTruthy();
  });
});
