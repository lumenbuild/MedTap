import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { eraseAll, exportBackup, importBackup } from '../src/db/repos/backup';
import { addPerson, listPeople, personOf, personRecordCount, removePerson, renamePerson } from '../src/db/repos/people';
import { createMed } from '../src/db/repos/meds';
import { upsertBody } from '../src/db/repos/body';
import { DEFAULT_PERSON } from '../src/db/schema';

const base = { name: 'Ritalin', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 10, color: '', icon: 'pill',
  schedule: { type: 'prn' as const } };

beforeEach(async () => { await eraseAll(); });

describe('family members', () => {
  it('start with just "Me", which old records belong to', async () => {
    expect((await listPeople()).map((p) => p.name)).toEqual(['Me']);
    const med = await createMed(base);
    expect(personOf(med)).toBe(DEFAULT_PERSON);
  });

  it('can be added and renamed; Me stays first', async () => {
    const sam = await addPerson('Sam');
    await renamePerson(DEFAULT_PERSON, 'Robert');
    expect((await listPeople()).map((p) => p.name)).toEqual(['Robert', 'Sam']);
    expect(sam.id).not.toBe(DEFAULT_PERSON);
  });

  it('keep separate body entries on the same day', async () => {
    const sam = await addPerson('Sam');
    await upsertBody('2026-07-15', { weightKg: 80 });
    await upsertBody('2026-07-15', { weightKg: 30 }, sam.id);
    const all = await db.bodyEntries.toArray();
    expect(all).toHaveLength(2);
    expect(all.find((b) => personOf(b) === sam.id)?.weightKg).toBe(30);
    expect(all.find((b) => personOf(b) === DEFAULT_PERSON)?.weightKg).toBe(80);
  });

  it("can't be removed while they have records", async () => {
    const sam = await addPerson('Sam');
    await createMed({ ...base, personId: sam.id });
    expect(await personRecordCount(sam.id)).toBe(1);
    expect(await removePerson(sam.id)).toBe(false);
    expect(await removePerson(DEFAULT_PERSON)).toBe(false);
    const empty = await addPerson('Pat');
    expect(await removePerson(empty.id)).toBe(true);
  });

  it('come back with a backup', async () => {
    const sam = await addPerson('Sam');
    await createMed({ ...base, personId: sam.id });
    const backup = await exportBackup({ includePhotos: false });
    await eraseAll();
    await importBackup(backup, 'replace');
    expect((await listPeople()).map((p) => p.name)).toEqual(['Me', 'Sam']);
    expect((await db.medications.toArray())[0].personId).toBe(sam.id);
  });
});
