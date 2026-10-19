import { db } from '../db';
import type { Photo } from '../schema';
import {
  BACKUP_TABLES, blobToDataUrl, dataUrlToBlob, makeBackup, mergeRows, type BackupFile, type BackupTable, type Row,
} from '../../logic/backup';
import { setSetting } from './settings';

const table = (t: BackupTable) => db.table(t);

/** Everything on this device as one backup file (photos optional: they make the file much bigger). */
export async function exportBackup({ includePhotos }: { includePhotos: boolean }): Promise<BackupFile> {
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
  return makeBackup(tables, db.verno);
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
  await db.transaction('rw', BACKUP_TABLES.map(table), async () => {
    for (const t of BACKUP_TABLES) await table(t).clear();
  });
}
