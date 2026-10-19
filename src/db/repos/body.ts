import { db } from '../db';
import type { BodyEntry } from '../schema';

const nowIso = () => new Date().toISOString();

export type BodyFields = Partial<Omit<BodyEntry, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'deletedAt'>>;

/** One entry per day: adding weight or measurements for a date fills in that day's entry.
 *  Returns what was there before, so the change can be undone with `undoBody`. */
export async function upsertBody(date: string, fields: BodyFields): Promise<{ id: string; before: BodyEntry | null }> {
  return db.transaction('rw', db.bodyEntries, async () => {
    const existing = (await db.bodyEntries.where('date').equals(date).toArray()).find((b) => !b.deletedAt) ?? null;
    const now = nowIso();
    if (existing) {
      await db.bodyEntries.put({ ...existing, ...fields, updatedAt: now });
      return { id: existing.id, before: existing };
    }
    const entry: BodyEntry = { id: crypto.randomUUID(), date, ...fields, createdAt: now, updatedAt: now };
    await db.bodyEntries.add(entry);
    return { id: entry.id, before: null };
  });
}

/** Put a day's entry back how it was before an upsert. */
export async function undoBody(id: string, before: BodyEntry | null) {
  if (before) await db.bodyEntries.put({ ...before, updatedAt: nowIso() });
  else await removeBody(id);
}

/** Replace a day's entry entirely (used by the editor, where clearing a field should clear it). */
export async function saveBody(entry: BodyEntry) {
  await db.bodyEntries.put({ ...entry, updatedAt: nowIso() });
}

export async function removeBody(id: string) {
  const now = nowIso();
  await db.bodyEntries.update(id, { deletedAt: now, updatedAt: now });
}

export async function restoreBody(id: string) {
  await db.bodyEntries.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}
