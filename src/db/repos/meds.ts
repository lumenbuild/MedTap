import { db } from '../db';
import type { Bottle, PeptideVial, MedEvent, Medication, PlannedChange } from '../schema';
import { describeChange, splitDueChanges } from '../../logic/plans';
import { vialsOf } from '../../logic/peptide';

const nowIso = () => new Date().toISOString();

export type MedInput = Omit<Medication, 'id' | 'createdAt' | 'updatedAt' | 'archived'>;

async function addEvent(medicationId: string, kind: MedEvent['kind'], summary: string, at = nowIso(), before?: unknown, after?: unknown) {
  await db.medEvents.add({ id: crypto.randomUUID(), medicationId, at, kind, summary, before, after });
}

export async function createMed(input: MedInput): Promise<Medication> {
  const now = nowIso();
  const med: Medication = {
    ...input, id: crypto.randomUUID(), archived: false, createdAt: now, updatedAt: now,
    stockBase: input.stockCount !== undefined ? { count: input.stockCount, at: now } : undefined,
  };
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    await db.medications.add(med);
    await addEvent(med.id, 'started', `Started ${med.name}`);
  });
  return med;
}

/** Save edits. Pass `change` to record a dated medication event (for chart markers). */
export async function updateMed(id: string, input: MedInput, change?: { at: string; summary: string; before: unknown; after: unknown }) {
  await db.transaction('rw', db.medications, db.medEvents, async () => {
    const before = await db.medications.get(id);
    const now = nowIso();
    // A stock count typed in is a new starting point for counting.
    const stockBase = input.stockCount === undefined ? undefined
      : input.stockCount !== before?.stockCount || !before?.stockBase ? { count: input.stockCount, at: now } : before.stockBase;
    await db.medications.update(id, { ...input, stockBase, updatedAt: now });
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

/** Several planned changes at once (a titration). Returns their ids, for undo. */
export async function addPlannedChanges(medId: string, changes: Omit<PlannedChange, 'id'>[]): Promise<string[]> {
  const med = await db.medications.get(medId);
  if (!med) return [];
  const added = changes.map((c) => ({ ...c, id: crypto.randomUUID() }));
  const dates = new Set(added.map((c) => c.from));
  const list = [...(med.plannedChanges ?? []).filter((c) => !dates.has(c.from)), ...added].sort((a, b) => a.from.localeCompare(b.from));
  await db.medications.update(medId, { plannedChanges: list, updatedAt: nowIso() });
  return added.map((c) => c.id);
}

export async function removePlannedChanges(medId: string, ids: string[]) {
  const med = await db.medications.get(medId);
  const rest = (med?.plannedChanges ?? []).filter((c) => !ids.includes(c.id));
  await db.medications.update(medId, { plannedChanges: rest.length ? rest : undefined, updatedAt: nowIso() });
}

// ── Vials and pens (peptide tools) ───────────────────────────────────────────────────────────────────

export type VialDetails = Pick<PeptideVial, 'amount' | 'lot' | 'supplier' | 'purity' | 'expiry' | 'note'>;

/** Add unopened vials or pens to stock (and to the stock count). Returns their ids, for undo. */
export async function addVials(medId: string, count: number, details: VialDetails): Promise<string[]> {
  const med = await db.medications.get(medId);
  if (!med || !(count >= 1)) return [];
  const now = nowIso();
  const added: PeptideVial[] = Array.from({ length: count }, () => ({ ...details, id: crypto.randomUUID(), status: 'stock', addedAt: now }));
  const stockCount = Math.round(((med.stockCount ?? 0) + count) * 1000) / 1000;
  await db.medications.update(medId, {
    vials: [...vialsOf(med), ...added], stockCount, stockBase: { count: stockCount, at: now }, updatedAt: now,
  });
  return added.map((v) => v.id);
}

/** Start a vial or pen: one from stock (`vialId`), or one that wasn't recorded (`details`). The one in use is finished.
 *  Returns what the list was before, for undo. */
export async function startVial(medId: string, opts: { vialId?: string; details?: VialDetails; waterMl?: number }): Promise<PeptideVial[] | undefined> {
  const med = await db.medications.get(medId);
  if (!med) return undefined;
  const before = vialsOf(med);
  const now = nowIso();
  let list = before.map((v) => (v.status === 'in-use' ? { ...v, status: 'finished' as const, finishedAt: now } : v));
  if (opts.vialId && list.some((v) => v.id === opts.vialId)) {
    list = list.map((v) => (v.id === opts.vialId ? { ...v, status: 'in-use' as const, startedAt: now, waterMl: opts.waterMl ?? v.waterMl } : v));
  } else {
    list = [...list, { amount: med.strength, ...opts.details, id: crypto.randomUUID(), status: 'in-use', addedAt: now, startedAt: now, waterMl: opts.waterMl }];
  }
  await db.medications.update(medId, { vials: list, updatedAt: now });
  return med.vials;
}

export async function setVials(medId: string, vials: PeptideVial[] | undefined) {
  await db.medications.update(medId, { vials, updatedAt: nowIso() });
}

export async function updateVial(medId: string, vialId: string, patch: Partial<PeptideVial>) {
  const med = await db.medications.get(medId);
  if (!med) return;
  await setVials(medId, vialsOf(med).map((v) => (v.id === vialId ? { ...v, ...patch, id: v.id } : v)));
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
  const now = nowIso();
  const stockCount = Math.round(((med.stockCount ?? 0) + added) * 1000) / 1000;
  await db.medications.update(medId, {
    stockCount, stockBase: { count: stockCount, at: now },
    repeatsLeft: usedRepeat && med.repeatsLeft !== undefined ? Math.max(0, med.repeatsLeft - 1) : med.repeatsLeft,
    updatedAt: now,
  });
}

/** Undo a restock. */
export async function unrestock(medId: string, added: number, usedRepeat: boolean) {
  const med = await db.medications.get(medId);
  if (!med) return;
  const now = nowIso();
  const stockCount = Math.round(((med.stockCount ?? 0) - added) * 1000) / 1000;
  await db.medications.update(medId, {
    stockCount, stockBase: { count: stockCount, at: now },
    repeatsLeft: usedRepeat && med.repeatsLeft !== undefined ? med.repeatsLeft + 1 : med.repeatsLeft,
    updatedAt: now,
  });
}

// ── Bottles and expiry dates ─────────────────────────────────────────────────────────────────────────

export async function addBottle(medId: string, b: { expiry: string; label?: string }): Promise<Bottle | undefined> {
  const med = await db.medications.get(medId);
  if (!med) return;
  const bottle: Bottle = { id: crypto.randomUUID(), expiry: b.expiry, label: b.label?.trim() || undefined, addedAt: nowIso() };
  await db.medications.update(medId, { bottles: [...(med.bottles ?? []), bottle].sort((x, y) => x.expiry.localeCompare(y.expiry)), updatedAt: nowIso() });
  return bottle;
}

export async function removeBottle(medId: string, bottleId: string): Promise<Bottle | undefined> {
  const med = await db.medications.get(medId);
  const removed = med?.bottles?.find((b) => b.id === bottleId);
  const rest = (med?.bottles ?? []).filter((b) => b.id !== bottleId);
  await db.medications.update(medId, { bottles: rest.length ? rest : undefined, updatedAt: nowIso() });
  return removed;
}

export async function restoreBottle(medId: string, bottle: Bottle) {
  const med = await db.medications.get(medId);
  if (!med) return;
  await db.medications.update(medId, { bottles: [...(med.bottles ?? []), bottle].sort((x, y) => x.expiry.localeCompare(y.expiry)), updatedAt: nowIso() });
}

/** Days an order takes to arrive (peptide tools), for the "order by" date. */
export async function setLeadTime(medId: string, days: number | undefined) {
  const med = await db.medications.get(medId);
  if (!med?.peptide) return;
  await db.medications.update(medId, { peptide: { ...med.peptide, leadTimeDays: days }, updatedAt: nowIso() });
}

/** Flag a batch with a note (shown when mixing another vial from it), or clear the flag with `note === null`. */
export async function setLotFlag(medId: string, lot: string, note: string | null) {
  const med = await db.medications.get(medId);
  if (!med) return;
  const rest = (med.lotFlags ?? []).filter((f) => f.lot !== lot);
  const lotFlags = note === null ? rest : [...rest, { lot, note: note.trim() || undefined, at: nowIso() }];
  await db.medications.update(medId, { lotFlags: lotFlags.length ? lotFlags : undefined, updatedAt: nowIso() });
}
