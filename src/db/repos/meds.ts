import { db } from '../db';
import type { MedEvent, Medication, PlannedChange } from '../schema';
import { describeChange, splitDueChanges } from '../../logic/plans';

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

// ── Planned changes and refills ─────────────────────────────────────────────────────────────────────

/** Move any planned changes whose date has arrived into the live schedule, recording each as a dated change.
 *  Runs at start-up and every few minutes, so a change applies even if the app wasn't opened that morning. */
export async function applyDuePlannedChanges(todayYmd: string, dayStartsAt: string): Promise<number> {
  let applied = 0;
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    const meds = await db.medications.toArray();
    for (const med of meds) {
      const { due, future } = splitDueChanges(med, todayYmd);
      if (!due.length) continue;
      let current: Medication = med;
      for (const c of due) {
        const lines = describeChange(current, { ...current, schedule: c.schedule, defaultAmount: c.defaultAmount });
        await addEvent(med.id, 'changed', [...lines, c.note ? `(${c.note})` : ''].filter(Boolean).join('; ') || 'Planned change',
          new Date(`${c.from}T${dayStartsAt}`).toISOString(),
          { defaultAmount: current.defaultAmount, schedule: current.schedule }, { defaultAmount: c.defaultAmount, schedule: c.schedule });
        current = { ...current, schedule: c.schedule, defaultAmount: c.defaultAmount };
        applied++;
      }
      await db.medications.update(med.id, {
        schedule: current.schedule, defaultAmount: current.defaultAmount, plannedChanges: future.length ? future : undefined, updatedAt: nowIso(),
      });
    }
  });
  return applied;
}

export async function addPlannedChange(medId: string, change: Omit<PlannedChange, 'id'>) {
  const med = await db.medications.get(medId);
  if (!med) return;
  const list = [...(med.plannedChanges ?? []).filter((c) => c.from !== change.from), { ...change, id: crypto.randomUUID() }]
    .sort((a, b) => a.from.localeCompare(b.from));
  await db.medications.update(medId, { plannedChanges: list, updatedAt: nowIso() });
}

export async function removePlannedChange(medId: string, changeId: string): Promise<PlannedChange | undefined> {
  const med = await db.medications.get(medId);
  const removed = med?.plannedChanges?.find((c) => c.id === changeId);
  const rest = (med?.plannedChanges ?? []).filter((c) => c.id !== changeId);
  await db.medications.update(medId, { plannedChanges: rest.length ? rest : undefined, updatedAt: nowIso() });
  return removed;
}

/** Add a refill to the stock count, optionally using up one script repeat. */
export async function restock(medId: string, added: number, usedRepeat: boolean) {
  const med = await db.medications.get(medId);
  if (!med) return;
  await db.medications.update(medId, {
    stockCount: Math.round(((med.stockCount ?? 0) + added) * 1000) / 1000,
    repeatsLeft: usedRepeat && med.repeatsLeft !== undefined ? Math.max(0, med.repeatsLeft - 1) : med.repeatsLeft,
    updatedAt: nowIso(),
  });
}

/** Undo a restock. */
export async function unrestock(medId: string, added: number, usedRepeat: boolean) {
  const med = await db.medications.get(medId);
  if (!med) return;
  await db.medications.update(medId, {
    stockCount: Math.round(((med.stockCount ?? 0) - added) * 1000) / 1000,
    repeatsLeft: usedRepeat && med.repeatsLeft !== undefined ? med.repeatsLeft + 1 : med.repeatsLeft,
    updatedAt: nowIso(),
  });
}
