import { db } from '../db';
import { DEFAULT_PERSON, type BodyEntry } from '../schema';

const nowIso = () => new Date().toISOString();

export type BodyFields = Partial<Omit<BodyEntry, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'deletedAt'>>;

/** One entry per day: adding weight or measurements for a date fills in that day's entry.
 *  Returns what was there before, so the change can be undone with `undoBody`. */
export async function upsertBody(date: string, fields: BodyFields, personId = DEFAULT_PERSON): Promise<{ id: string; before: BodyEntry | null }> {
  return db.transaction('rw', db.bodyEntries, async () => {
    const existing = (await db.bodyEntries.where('date').equals(date).toArray())
      .find((b) => !b.deletedAt && (b.personId ?? DEFAULT_PERSON) === personId) ?? null;
    const now = nowIso();
    if (existing) {
      await db.bodyEntries.put({ ...existing, ...fields, updatedAt: now });
      return { id: existing.id, before: existing };
    }
    const entry: BodyEntry = { id: crypto.randomUUID(), date, ...fields, personId: personId === DEFAULT_PERSON ? undefined : personId, createdAt: now, updatedAt: now };
    await db.bodyEntries.add(entry);
    return { id: entry.id, before: null };
  });
}

/** Put a day's entry back how it was before an upsert. */
export async function undoBody(id: string, before: BodyEntry | null) {
  if (before) await db.bodyEntries.put({ ...before, updatedAt: nowIso() });
  else await removeBody(id);
}

/** Replace a day's entry entirely (used by undo, to put back exactly what was there). */
export async function saveBody(entry: BodyEntry) {
  await db.bodyEntries.put({ ...entry, updatedAt: nowIso() });
}

/** The editor's save: the fields it shows are set or cleared, and everything it doesn't show (a scale's visceral
 *  fat, body water, metabolic age) is kept. Returns the entry as it was, for undo. */
export async function editBody(id: string, date: string, shown: string[], fields: BodyFields): Promise<BodyEntry | undefined> {
  const before = await db.bodyEntries.get(id);
  if (!before) return undefined;
  const next: BodyEntry = { ...before, date };
  for (const k of shown) delete (next as unknown as Record<string, unknown>)[k];
  Object.assign(next, fields);
  await saveBody(next);
  return before;
}

export async function removeBody(id: string) {
  const now = nowIso();
  await db.bodyEntries.update(id, { deletedAt: now, updatedAt: now });
}

export async function restoreBody(id: string) {
  await db.bodyEntries.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}
