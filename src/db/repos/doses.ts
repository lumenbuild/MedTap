import { db } from '../db';
import type { Dose } from '../schema';
import { round, stockUnitsFor } from '../../logic/stock';
import { vialStockCount } from '../../logic/peptide';
import { SAME_TAP_MS, sameTap } from '../../logic/duplicate';

const nowIso = () => new Date().toISOString();

async function adjustStock(medicationId: string, amount: number, sign: 1 | -1, skipped?: boolean) {
  if (skipped) return; // a skipped dose never came out of the pack
  const med = await db.medications.get(medicationId);
  if (!med) return;
  // A peptide with vial records: the count is worked out from the vials and the doses taken from them.
  if (med.peptide && med.vials?.length) {
    const n = vialStockCount(med, await db.doses.where('medicationId').equals(medicationId).toArray(), Date.now());
    if (n !== undefined && n !== med.stockCount) await db.medications.update(medicationId, { stockCount: n, stockBase: { count: n, at: new Date().toISOString() } });
    return;
  }
  if (med.stockCount === undefined || med.stockCount === null) return;
  await db.medications.update(medicationId, { stockCount: round(med.stockCount + sign * stockUnitsFor(med, amount)) });
}

export interface NewDose {
  medicationId: string;
  takenAt: string;
  amount: number;
  source: Dose['source'];
  tagId?: string;
  note?: string;
  skipped?: boolean;
  skipReason?: string;
  /** Who took it (shared medications). */
  personId?: string;
  /** The vial or pen it came from (peptide tools). */
  vialId?: string;
}

/** Save a dose and take it off the stock count. */
/** Log a dose. The same dose tapped again within a minute isn't logged twice: the first comes back, marked
 *  `duplicate` (pass `again` to log it anyway). */
export async function logDose(input: NewDose, opts: { again?: boolean } = {}): Promise<Dose & { duplicate?: boolean }> {
  const now = nowIso();
  const dose: Dose = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
  let first: Dose | undefined;
  await db.transaction('rw', db.doses, db.medications, async () => {
    if (!opts.again) {
      const recent = await db.doses.where('medicationId').equals(input.medicationId).filter((d) => Date.parse(d.createdAt) > Date.now() - SAME_TAP_MS).toArray();
      first = sameTap(recent, input, input.takenAt, (d) => d.takenAt);
      if (first) return;
    }
    await db.doses.add(dose);
    await adjustStock(dose.medicationId, dose.amount, -1, dose.skipped);
  });
  return first ? { ...first, duplicate: true } : dose;
}

/** Soft-delete a dose (used for Undo and Delete) and put its stock back. */
export async function removeDose(id: string) {
  await db.transaction('rw', db.doses, db.medications, async () => {
    const dose = await db.doses.get(id);
    if (!dose || dose.deletedAt) return;
    const now = nowIso();
    await db.doses.update(id, { deletedAt: now, updatedAt: now });
    await adjustStock(dose.medicationId, dose.amount, 1, dose.skipped);
  });
}

/** Undo a delete. */
export async function restoreDose(id: string) {
  await db.transaction('rw', db.doses, db.medications, async () => {
    const dose = await db.doses.get(id);
    if (!dose || !dose.deletedAt) return;
    await db.doses.update(id, { deletedAt: undefined, updatedAt: nowIso() });
    await adjustStock(dose.medicationId, dose.amount, -1, dose.skipped);
  });
}

/** Edit a dose's time, amount or note, keeping the stock count in step with any amount change. */
export async function updateDose(id: string, patch: Partial<Pick<Dose, 'takenAt' | 'amount' | 'note'>>) {
  await db.transaction('rw', db.doses, db.medications, async () => {
    const dose = await db.doses.get(id);
    if (!dose) return;
    if (patch.amount !== undefined && patch.amount !== dose.amount && !dose.deletedAt && !dose.skipped) {
      await adjustStock(dose.medicationId, dose.amount, 1);
      await adjustStock(dose.medicationId, patch.amount, -1);
    }
    await db.doses.update(id, { ...patch, updatedAt: nowIso() });
    // Vial-tracked peptides recount from the doses, now changed.
    await adjustStock(dose.medicationId, 0, 1);
  });
}
