import { db } from '../db';
import type { Supply, SupplyKind } from '../schema';

const nowIso = () => new Date().toISOString();

/** Set how many are on hand now (for the sharps container: how many are in it). One record per kind. */
export async function setSupply(kind: SupplyKind, count: number, extra: Pick<Supply, 'capacity' | 'warnAt'> = {}) {
  const now = nowIso();
  const old = await db.supplies.get(kind);
  await db.supplies.put({ ...(old ?? { createdAt: now }), ...extra, id: kind, kind, base: { count, at: now }, updatedAt: now, deletedAt: undefined });
}

export async function updateSupply(kind: SupplyKind, patch: Pick<Supply, 'capacity' | 'warnAt'>) {
  await db.supplies.update(kind, { ...patch, updatedAt: nowIso() });
}

export async function stopTracking(kind: SupplyKind) {
  const now = nowIso();
  await db.supplies.update(kind, { deletedAt: now, updatedAt: now });
}
