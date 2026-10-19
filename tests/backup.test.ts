import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createMed } from '../src/db/repos/meds';
import { logDose } from '../src/db/repos/doses';
import { linkTag } from '../src/db/repos/tags';
import { eraseAll, exportBackup, importBackup } from '../src/db/repos/backup';
import { blobToDataUrl, dataUrlToBlob, mergeRows, validateBackup } from '../src/logic/backup';
import { toCsv } from '../src/logic/csv';

const base = {
  name: 'Stim', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10,
  schedule: { type: 'interval' as const, intervalHours: 4 }, color: '#0B7A75', icon: 'pill',
};

beforeEach(async () => { await eraseAll(); });

describe('validateBackup', () => {
  it('rejects things that are not backups', () => {
    expect(validateBackup(null, 2).ok).toBe(false);
    expect(validateBackup({ hello: 1 }, 2).ok).toBe(false);
    expect(validateBackup({ format: 1, tables: { doses: [{ nope: 1 }] } }, 2).ok).toBe(false);
  });
  it('rejects backups from a newer app', () => {
    const r = validateBackup({ format: 1, schemaVersion: 99, tables: {} }, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version/);
  });
  it('counts records, ignoring deleted ones', () => {
    const r = validateBackup({ format: 1, schemaVersion: 2, tables: { doses: [{ id: 'a' }, { id: 'b', deletedAt: 'x' }], tags: [{ id: 't' }] } }, 2);
    expect(r.ok && r.counts).toEqual({ doses: 1, tags: 1 });
  });
});

describe('mergeRows', () => {
  it('adds new records and lets the newer edit win', () => {
    const local = [{ id: 'a', v: 1, updatedAt: '2026-01-02T00:00:00Z' }, { id: 'b', v: 1, updatedAt: '2026-01-02T00:00:00Z' }];
    const incoming = [
      { id: 'a', v: 2, updatedAt: '2026-01-01T00:00:00Z' }, // older: keep local
      { id: 'b', v: 2, updatedAt: '2026-01-03T00:00:00Z' }, // newer: take it
      { id: 'c', v: 2 },
    ];
    expect(mergeRows('doses', local, incoming).map((r) => `${r.id}${r.v}`)).toEqual(['b2', 'c2']);
  });
  it('keeps local settings', () => {
    expect(mergeRows('settings', [{ key: 'units', value: 'metric' }], [{ key: 'units', value: 'imperial' }, { key: 'x', value: 1 }]))
      .toEqual([{ key: 'x', value: 1 }]);
  });
});

describe('export and restore', () => {
  it('a restore on a fresh device re-links tags and keeps doses', async () => {
    const med = await createMed({ ...base, stockCount: 20 });
    await linkTag('ab3defgh', med.id, 'Kitchen');
    await logDose({ medicationId: med.id, takenAt: '2026-07-15T01:00:00Z', amount: 10, source: 'tag', tagId: 'ab3defgh' });

    const backup = JSON.parse(JSON.stringify(await exportBackup({ includePhotos: true })));
    await eraseAll();
    expect(await db.tags.count()).toBe(0);

    const v = validateBackup(backup, db.verno);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    await importBackup(v.backup, 'replace');
    expect((await db.tags.get('ab3defgh'))?.medicationId).toBe(med.id);
    expect(await db.doses.count()).toBe(1);
    expect((await db.medications.get(med.id))?.stockCount).toBe(19);
  });

  it('merge does not duplicate', async () => {
    const med = await createMed(base);
    await logDose({ medicationId: med.id, takenAt: '2026-07-15T01:00:00Z', amount: 10, source: 'manual' });
    const backup = await exportBackup({ includePhotos: false });
    await importBackup(backup, 'merge');
    expect(await db.doses.count()).toBe(1);
    expect(await db.medications.count()).toBe(1);
  });
});

describe('helpers', () => {
  it('photos survive the trip through JSON', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' });
    const back = dataUrlToBlob(await blobToDataUrl(blob));
    expect(back.type).toBe('image/jpeg');
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([1, 2, 3, 250]);
  });
  it('CSV escapes commas, quotes and new lines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"\nok']])).toBe('a,b\r\n"x,y","say ""hi""\nok"\r\n');
  });
});

import { backupText } from '../src/app/autoBackup';
import { isSealed, unsealBackup } from '../src/logic/crypto';

describe('encrypted backup files', () => {
  it('are unreadable as text and restore without a password', async () => {
    const med = await createMed({ ...base, name: 'Ritalin' });
    await linkTag('ab3defgh', med.id);
    const text = await backupText(false);
    expect(text).not.toContain('Ritalin');
    expect(text).not.toContain('ab3defgh');
    const file = JSON.parse(text);
    expect(isSealed(file)).toBe(true);
    const v = validateBackup(JSON.parse(await unsealBackup(file.sealed)), db.verno);
    expect(v.ok).toBe(true);
    await eraseAll();
    if (v.ok) await importBackup(v.backup, 'replace');
    expect((await db.tags.get('ab3defgh'))?.medicationId).toBe(med.id);
  });
});
