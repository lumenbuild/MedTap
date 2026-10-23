import { db } from '../db';
import type { Medication, Photo } from '../schema';
import { hiddenMedIds, viewMeds, withoutHidden } from '../../logic/privateView';
import {
  BACKUP_TABLES, blobToDataUrl, dataUrlToBlob, makeBackup, mergeRows, type BackupFile, type BackupTable, type Row,
} from '../../logic/backup';
import { setSetting } from './settings';

const table = (t: BackupTable) => db.table(t);

/** Everything on this device as one backup file (photos optional: they make the file much bigger). */
export async function exportBackup({ includePhotos, privateView }: { includePhotos: boolean; privateView?: boolean }): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const t of BACKUP_TABLES) {
    if (t === 'photos') {
      if (!includePhotos) continue;
      const photos = await db.photos.toArray();
      tables.photos = await Promise.all(photos.map(async ({ blob, ...p }) => ({ ...p, dataUrl: await blobToDataUrl(blob) })));
    } else {
      tables[t] = (await table(t).toArray()) as Row[];
    }
  }
  if (privateView) privateTables(tables);
  return makeBackup(tables, db.verno);
}

/** A backup made in the private view holds only what that view shows (and nothing about the privacy PIN). */
function privateTables(tables: BackupFile['tables']) {
  const settings = (tables.settings ?? []) as unknown as { key: string; value: unknown }[];
  const hidePeptides = settings.find((r) => r.key === 'privacyHidePeptides')?.value !== false;
  const meds = (tables.medications ?? []) as unknown as Medication[];
  const hidden = hiddenMedIds(meds, hidePeptides);
  tables.medications = viewMeds(meds, hidePeptides) as unknown as Row[];
  for (const t of ['doses', 'tags', 'medEvents'] as const) if (tables[t]) tables[t] = withoutHidden(tables[t] as { medicationId?: string }[], hidden) as Row[];
  if (hidePeptides) tables.supplies = [];
  tables.settings = settings.filter((r) => !r.key.startsWith('privacy')).map((r) => (r.key === 'peptideTools' && hidePeptides ? { ...r, value: false } : r)) as unknown as Row[];
}

function revive(t: BackupTable, rows: Row[]): Row[] {
  if (t !== 'photos') return rows;
  return rows.map(({ dataUrl, ...p }) => ({ ...p, blob: dataUrlToBlob(String(dataUrl ?? '')) }) as unknown as Photo as unknown as Row);
}

/** Restore a validated backup. Merge keeps local data and adds or updates from the file; Replace wipes first. */
export async function importBackup(backup: BackupFile, mode: 'merge' | 'replace') {
  const present = BACKUP_TABLES.filter((t) => backup.tables[t]);
  await db.transaction('rw', BACKUP_TABLES.map(table), async () => {
    if (mode === 'replace') for (const t of BACKUP_TABLES) await table(t).clear();
    for (const t of present) {
      const incoming = revive(t, backup.tables[t]!);
      const rows = mode === 'replace' ? incoming : mergeRows(t, (await table(t).toArray()) as Row[], incoming);
      if (rows.length) await table(t).bulkPut(rows);
    }
  });
  // Restoring a backup on a new phone shouldn't show onboarding again.
  await setSetting('onboarded', true);
}

export async function markBackedUp() {
  await setSetting('lastBackupAt', new Date().toISOString());
}

export async function eraseAll() {
  await db.transaction('rw', [...BACKUP_TABLES.map(table), db.device], async () => {
    for (const t of BACKUP_TABLES) await table(t).clear();
    await db.device.clear();
  });
}
