import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { addVital, removeVital, restoreVital, updateVital } from '../src/db/repos/vitals';
import { eraseAll, exportBackup, importBackup } from '../src/db/repos/backup';
import { vitalsCsv } from '../src/logic/csv';
import { fmtVital } from '../src/components/VitalsSheet';

beforeEach(async () => { await eraseAll(); });

describe('vitals', () => {
  it('adds, edits, deletes and restores a reading', async () => {
    const v = await addVital({ at: '2026-07-15T01:00:00Z', systolic: 120, diastolic: 80, heartRate: 72 });
    await updateVital(v.id, { at: v.at, heartRate: 70 });
    let row = await db.vitals.get(v.id);
    expect(row?.systolic).toBeUndefined();
    expect(row?.heartRate).toBe(70);
    await removeVital(v.id);
    expect((await db.vitals.get(v.id))?.deletedAt).toBeTruthy();
    await restoreVital(v.id);
    row = await db.vitals.get(v.id);
    expect(row?.deletedAt).toBeUndefined();
  });

  it('formats readings', () => {
    expect(fmtVital({ systolic: 120, diastolic: 80, heartRate: 72 })).toBe('120/80 mmHg · 72 bpm');
    expect(fmtVital({ heartRate: 64 })).toBe('64 bpm');
  });

  it('is included in backups', async () => {
    await addVital({ at: '2026-07-15T01:00:00Z', systolic: 130, diastolic: 85, personId: 'sam' });
    const backup = JSON.parse(JSON.stringify(await exportBackup({ includePhotos: false })));
    await eraseAll();
    expect(await db.vitals.count()).toBe(0);
    await importBackup(backup, 'replace');
    const rows = await db.vitals.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].personId).toBe('sam');
  });

  it('exports CSV without deleted readings', () => {
    const csv = vitalsCsv([
      { id: 'a', at: '2026-07-15T01:00:00Z', systolic: 120, diastolic: 80, createdAt: '', updatedAt: '' },
      { id: 'b', at: '2026-07-16T01:00:00Z', heartRate: 60, createdAt: '', updatedAt: '', deletedAt: 'x' },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('person,date,time,systolic mmHg,diastolic mmHg,heart rate bpm,note');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Me,2026-07-15,\d\d:\d\d,120,80,,$/);
  });
});
