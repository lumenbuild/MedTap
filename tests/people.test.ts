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

import { doseOwner, dosesForPerson, medIsFor } from '../src/db/repos/people';
import { logDose } from '../src/db/repos/doses';
import { getDosesToday, getLastDose, getRecentDose } from '../src/logic/schedule';
import { forecastRunOut } from '../src/logic/plans';
import type { Dose, Medication } from '../src/db/schema';

describe('shared medications (e.g. Panadol)', () => {
  const S = { dayStartsAt: '04:00', tz: 'Australia/Sydney', guardMinutes: 10 };
  const panadol: Medication = { id: 'p', name: 'Panadol', strength: 500, unit: 'mg', form: 'tablet', defaultAmount: 1000,
    schedule: { type: 'prn' }, color: '', icon: '', archived: false, createdAt: '', updatedAt: '', shared: true, stockCount: 20 };
  const mine: Medication = { ...panadol, id: 'r', name: 'Ritalin', shared: undefined, personId: undefined };
  const now = Date.parse('2026-07-15T02:00:00Z');
  const d = (id: string, minsAgo: number, personId?: string, medicationId = 'p'): Dose =>
    ({ id, medicationId, takenAt: new Date(now - minsAgo * 60_000).toISOString(), amount: 1000, source: 'tag', createdAt: '', updatedAt: '', personId });

  it('show for everyone', () => {
    expect(medIsFor(panadol, 'me')).toBe(true);
    expect(medIsFor(panadol, 'sam')).toBe(true);
    expect(medIsFor(mine, 'sam')).toBe(false);
  });

  it("count each person's own doses: Sam's dose doesn't trigger my double-tap guard", () => {
    const doses = [d('a', 5, 'sam'), d('b', 120)];
    const meView = dosesForPerson(doses, [panadol, mine], 'me');
    const samView = dosesForPerson(doses, [panadol, mine], 'sam');
    expect(getRecentDose(meView, 'p', now, 10)).toBeUndefined();
    expect(getRecentDose(samView, 'p', now, 10)?.id).toBe('a');
    expect(getLastDose(meView, 'p')?.id).toBe('b');
    expect(getDosesToday(samView, 'p', now, S)).toHaveLength(1);
    expect(doseOwner(doses[0], panadol)).toBe('sam');
    expect(doseOwner(doses[1], panadol)).toBe('me');
    expect(doseOwner({ personId: 'x' }, { personId: 'sam' })).toBe('sam'); // non-shared: the medication's person
  });

  it('forecast from everyone\'s recent use', () => {
    const doses = Array.from({ length: 14 }, (_, i) => d(`x${i}`, i * 24 * 60 + 60, i % 2 ? 'sam' : undefined));
    const f = forecastRunOut(panadol, doses, now, S)!;
    expect(f.basis).toBe('recent-use');
    expect(f.daysLeft).toBe(10); // 2 tablets a day between them
  });

  it('take stock from the one bottle whoever logs it', async () => {
    const sam = await addPerson('Sam');
    const med = await createMed({ ...base, name: 'Panadol', strength: 500, defaultAmount: 1000, shared: true, stockCount: 20 });
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 1000, source: 'manual' });
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 1000, source: 'manual', personId: sam.id });
    expect((await db.medications.get(med.id))?.stockCount).toBe(16);
    expect(await personRecordCount(sam.id)).toBe(1); // Sam's dose of a shared medication counts as Sam's record
  });
});
