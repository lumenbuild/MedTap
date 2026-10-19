import { db } from '../db';
import type { MedEvent, Medication } from '../schema';

const nowIso = () => new Date().toISOString();

export type MedInput = Omit<Medication, 'id' | 'createdAt' | 'updatedAt' | 'archived'>;

async function addEvent(medicationId: string, kind: MedEvent['kind'], summary: string, at = nowIso(), before?: unknown, after?: unknown) {
  await db.medEvents.add({ id: crypto.randomUUID(), medicationId, at, kind, summary, before, after });
}

export async function createMed(input: MedInput): Promise<Medication> {
  const now = nowIso();
  const med: Medication = { ...input, id: crypto.randomUUID(), archived: false, createdAt: now, updatedAt: now };
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    await db.medications.add(med);
    await addEvent(med.id, 'started', `Started ${med.name}`);
  });
  return med;
}

/** Save edits. Pass `change` to record a dated medication event (for chart markers). */
export async function updateMed(id: string, input: MedInput, change?: { at: string; summary: string; before: unknown; after: unknown }) {
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    await db.medications.update(id, { ...input, updatedAt: nowIso() });
    if (change) await addEvent(id, 'changed', change.summary, change.at, change.before, change.after);
  });
}

export async function setArchived(id: string, archived: boolean) {
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    const med = await db.medications.get(id);
    if (!med) return;
    await db.medications.update(id, { archived, updatedAt: nowIso() });
    await addEvent(id, archived ? 'stopped' : 'started', `${archived ? 'Stopped' : 'Restarted'} ${med.name}`);
  });
}

/** Permanently delete a medication and everything recorded against it. */
export async function deleteMedForever(id: string) {
  await db.transaction('rw', [db.medications, db.doses, db.tags, db.medEvents], async () => {
    await db.doses.where('medicationId').equals(id).delete();
    await db.tags.where('medicationId').equals(id).delete();
    await db.medEvents.where('medicationId').equals(id).delete();
    await db.medications.delete(id);
  });
}
