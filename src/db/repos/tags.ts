import { db } from '../db';
import type { Tag } from '../schema';
import { removePendingTag } from './settings';

const nowIso = () => new Date().toISOString();

/** Link a tag ID to a medication (and, for a tag stuck on a vial, that vial). Re-linking an existing tag moves it. */
export async function linkTag(id: string, medicationId: string, label?: string, vialId?: string): Promise<Tag> {
  const existing = await db.tags.get(id);
  const tag: Tag = { ...existing, id, medicationId, label: label?.trim() || existing?.label, createdAt: existing?.createdAt ?? nowIso(), vialId };
  await db.tags.put(tag);
  await removePendingTag(id);
  return tag;
}

export async function renameTag(id: string, label: string) {
  await db.tags.update(id, { label: label.trim() || undefined });
}

export async function unlinkTag(id: string): Promise<Tag | undefined> {
  const tag = await db.tags.get(id);
  await db.tags.delete(id);
  return tag;
}

export async function restoreTag(tag: Tag) {
  await db.tags.put(tag);
}

/** A new vial was mixed and the tag moved to it: point the medication's vial tags at `vialId` (the same sticker, reused;
 *  nothing is rewritten, because the tag only holds its own ID). Returns the tags as they were, for undo. */
export async function moveVialTags(medicationId: string, vialId: string, onlyTagId?: string): Promise<Tag[]> {
  const tags = await db.tags.where('medicationId').equals(medicationId).filter((t) => !!t.vialId && (!onlyTagId || t.id === onlyTagId)).toArray();
  await db.tags.bulkPut(tags.map((t) => ({ ...t, vialId })));
  return tags;
}

export async function markScanned(id: string) {
  await db.tags.update(id, { lastScannedAt: nowIso() });
}
