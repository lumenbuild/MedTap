import { db } from '../db';
import { DEFAULT_PERSON, type Photo } from '../schema';
import { storedPerson } from './people';

const nowIso = () => new Date().toISOString();
const MAX_SIDE = 1600;

/** Shrink a camera photo so hundreds fit on the phone. Falls back to the original if the browser can't decode it. */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out ?? file;
  } catch {
    return file;
  }
}

export async function addPhoto(date: string, file: Blob, personId = DEFAULT_PERSON): Promise<Photo> {
  const blob = await shrink(file);
  const now = nowIso();
  const p: Photo = { id: crypto.randomUUID(), date, blob, type: blob.type, personId: storedPerson(personId), createdAt: now, updatedAt: now };
  await db.photos.add(p);
  return p;
}

/** A photo of a vial's label or certificate of analysis (peptide tools). */
export async function addVialPhoto(vialId: string, file: Blob, personId = DEFAULT_PERSON): Promise<Photo> {
  const blob = await shrink(file);
  const now = nowIso();
  const p: Photo = { id: crypto.randomUUID(), date: now.slice(0, 10), blob, type: blob.type, personId: storedPerson(personId), vialId, createdAt: now, updatedAt: now };
  await db.photos.add(p);
  return p;
}

export async function removePhoto(id: string) {
  const now = nowIso();
  await db.photos.update(id, { deletedAt: now, updatedAt: now });
}

export async function restorePhoto(id: string) {
  await db.photos.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}
