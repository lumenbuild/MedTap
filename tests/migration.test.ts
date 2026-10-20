import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';

describe('database v1 → v2', () => {
  it('keeps data and moves old colours to the validated palette', async () => {
    const v1 = new Dexie('medtap');
    v1.version(1).stores({ medications: 'id, name, archived', tags: 'id, medicationId', doses: 'id, medicationId, takenAt',
      checkIns: 'id, at', bodyEntries: 'id, date', medEvents: 'id, medicationId, at', settings: 'key' });
    await v1.table('medications').bulkAdd([{ id: 'a', name: 'A', color: '#0B7A75' }, { id: 'b', name: 'B', color: '#123456' }]);
    await v1.table('doses').add({ id: 'd', medicationId: 'a', takenAt: '2026-01-01T00:00:00Z' });
    v1.close();

    const { db } = await import('../src/db/db');
    await db.open();
    expect(db.verno).toBe(5);
    expect((await db.medications.get('a'))?.color).toBe('#1baf7a');
    expect((await db.medications.get('b'))?.color).toBe('#123456');
    expect(await db.doses.count()).toBe(1);
    expect(await db.photos.count()).toBe(0);
  });
});
