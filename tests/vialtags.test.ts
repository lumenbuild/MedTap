import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { linkTag, moveVialTags, restoreTag } from '../src/db/repos/tags';
import { startVial } from '../src/db/repos/meds';
import { currentVial, vialForTag } from '../src/logic/peptide';
import type { Medication } from '../src/db/schema';

const med: Medication = {
  id: 'p', name: 'Retatrutide', strength: 10, unit: 'mg', form: 'injection', defaultAmount: 2, schedule: { type: 'prn' },
  color: '', icon: '', archived: false, createdAt: '', updatedAt: '',
  peptide: { waterMl: 2, syringe: 'U-100', syringeUnits: 100 },
  vials: [
    { id: 'v1', status: 'in-use', amount: 10, waterMl: 2, addedAt: '2026-07-01T00:00:00Z', startedAt: '2026-07-01T00:00:00Z' },
    { id: 'v2', status: 'stock', amount: 10, addedAt: '2026-07-01T00:00:00Z' },
  ],
};

beforeEach(async () => { await db.delete(); await db.open(); await db.medications.put(med); });

describe('vial tags', () => {
  it('a vial tag logs from its own vial', async () => {
    const t = await linkTag('tagA', 'p', 'Vial tag', 'v1');
    expect(t.vialId).toBe('v1');
    expect(vialForTag(med, 'v1')).toEqual({ vial: med.vials![0], stale: false });
  });

  it('mixing a new vial reuses the same tag: it now points at the new vial', async () => {
    await linkTag('tagA', 'p', 'Vial tag', 'v1');
    await linkTag('box', 'p', 'Box'); // an ordinary tag on the box isn't touched
    await startVial('p', { vialId: 'v2', waterMl: 2 });
    const m = (await db.medications.get('p'))!;
    expect(currentVial(m)!.id).toBe('v2');
    // Before moving, the tag's vial is finished: it falls back to the one in use and says so.
    expect(vialForTag(m, 'v1')).toMatchObject({ vial: { id: 'v2' }, stale: true });
    const before = await moveVialTags('p', 'v2');
    expect(before.map((t) => t.vialId)).toEqual(['v1']);
    expect((await db.tags.get('tagA'))!.vialId).toBe('v2');
    expect((await db.tags.get('box'))!.vialId).toBeUndefined();
    expect(vialForTag(m, 'v2').stale).toBe(false);
    // Undo puts it back.
    for (const t of before) await restoreTag(t);
    expect((await db.tags.get('tagA'))!.vialId).toBe('v1');
  });

  it('relinking a vial tag to another medication clears its vial', async () => {
    await linkTag('tagA', 'p', 'Vial tag', 'v1');
    expect((await linkTag('tagA', 'other')).vialId).toBeUndefined();
  });
});
