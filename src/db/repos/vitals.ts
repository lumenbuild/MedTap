import { db } from '../db';
import type { Vital } from '../schema';

const nowIso = () => new Date().toISOString();
export type VitalInput = Omit<Vital, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function addVital(input: VitalInput): Promise<Vital> {
  const now = nowIso();
  const v: Vital = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.vitals.add(v);
  return v;
}

/** Replace the editable fields wholesale so cleared values really clear. */
export async function updateVital(id: string, input: VitalInput) {
  const old = await db.vitals.get(id);
  if (!old) return;
  await db.vitals.put({ id, createdAt: old.createdAt, ...input, updatedAt: nowIso() });
}

export async function removeVital(id: string) {
  const now = nowIso();
  await db.vitals.update(id, { deletedAt: now, updatedAt: now });
}

export async function restoreVital(id: string) {
  await db.vitals.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}
