import { db } from '../db';
import type { CheckIn } from '../schema';

const nowIso = () => new Date().toISOString();

export type CheckInInput = Omit<CheckIn, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function addCheckIn(input: CheckInInput): Promise<CheckIn> {
  const now = nowIso();
  const c: CheckIn = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.checkIns.add(c);
  return c;
}

export async function updateCheckIn(id: string, input: CheckInInput) {
  // Replace the editable fields wholesale so cleared answers really clear.
  const old = await db.checkIns.get(id);
  if (!old) return;
  await db.checkIns.put({ id, createdAt: old.createdAt, ...input, updatedAt: nowIso() });
}

export async function removeCheckIn(id: string) {
  const now = nowIso();
  await db.checkIns.update(id, { deletedAt: now, updatedAt: now });
}

export async function restoreCheckIn(id: string) {
  await db.checkIns.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}
