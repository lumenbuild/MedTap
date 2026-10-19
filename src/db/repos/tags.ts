import { db } from '../db';
import type { Tag } from '../schema';
import { removePendingTag } from './settings';

const nowIso = () => new Date().toISOString();

/** Link a tag ID to a medication. Re-linking an existing tag moves it. */
export async function linkTag(id: string, medicationId: string, label?: string): Promise<Tag> {
  const existing = await db.tags.get(id);
  const tag: Tag = { ...existing, id, medicationId, label: label?.trim() || existing?.label, createdAt: existing?.createdAt ?? nowIso() };
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

export async function markScanned(id: string) {
  await db.tags.update(id, { lastScannedAt: nowIso() });
}
