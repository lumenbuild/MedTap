// Automatic daily backups into a folder the person chooses (where the browser allows it).
// The folder permission lives in the device-only table, so it never ends up inside a backup file.
import { db } from '../db/db';
import { getSettings, setSetting } from '../db/repos/settings';
import { exportBackup, markBackedUp } from '../db/repos/backup';
import { backupFilename } from '../logic/backup';
import { sealBackup } from '../logic/crypto';
import { APP_NAME } from '../config';

export const canAutoBackup = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
const DIR = 'backupDir';
const DUE_MS = 20 * 3_600_000; // roughly daily, without drifting later each day

export type AutoResult = 'done' | 'not-due' | 'needs-permission' | 'off' | 'unsupported' | 'error';

/** The backup file's text. Always encrypted (built-in key) so it can't simply be opened and read. */
export async function backupText(includePhotos: boolean): Promise<string> {
  const backup = await exportBackup({ includePhotos });
  const sealed = await sealBackup(JSON.stringify(backup));
  return JSON.stringify({ app: APP_NAME, format: backup.format, encrypted: true, sealed });
}

export async function getFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await db.device.get(DIR))?.value as FileSystemDirectoryHandle | undefined;
}

/** Ask for a folder (needs a tap), then back up straight away. */
export async function chooseFolder(): Promise<AutoResult> {
  if (!canAutoBackup) return 'unsupported';
  const h = await window.showDirectoryPicker!({ id: 'medtap-backups', mode: 'readwrite', startIn: 'documents' });
  await db.device.put({ key: DIR, value: h });
  await setSetting('autoBackupEnabled', true);
  return runAutoBackup(true);
}

export async function stopAutoBackup() {
  await setSetting('autoBackupEnabled', false);
  await db.device.delete(DIR);
}

/** Browsers forget folder permission after a while; getting it back needs a tap. */
export async function regainPermission(): Promise<AutoResult> {
  const h = await getFolder();
  if (!h) return 'off';
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return 'needs-permission';
  return runAutoBackup(true);
}

export async function autoBackupState(): Promise<'off' | 'ok' | 'needs-permission' | 'unsupported'> {
  if (!canAutoBackup) return 'unsupported';
  const s = await getSettings();
  const h = await getFolder();
  if (!s.autoBackupEnabled || !h) return 'off';
  return (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'needs-permission';
}

/** Write today's backup if one is due, then keep only the newest `autoBackupKeep` files. Never asks for anything. */
export async function runAutoBackup(force = false): Promise<AutoResult> {
  if (!canAutoBackup) return 'unsupported';
  const s = await getSettings();
  const h = await getFolder();
  if (!s.autoBackupEnabled || !h) return 'off';
  if (!force && s.lastAutoBackupAt && Date.now() - Date.parse(s.lastAutoBackupAt) < DUE_MS) return 'not-due';
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return 'needs-permission';
    const text = await backupText(true);
    const name = backupFilename();
    const file = await h.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(new Blob([text], { type: 'application/json' }));
    await w.close();
    await prune(h, s.autoBackupKeep);
    await setSetting('lastAutoBackupAt', new Date().toISOString());
    await markBackedUp();
    return 'done';
  } catch (e) {
    console.error('Automatic backup failed', e);
    return 'error';
  }
}

async function prune(h: FileSystemDirectoryHandle, keep: number) {
  const pattern = new RegExp(`^${APP_NAME}-backup-\\d{4}-\\d{2}-\\d{2}\\.json$`);
  const names: string[] = [];
  for await (const entry of h.values()) if (entry.kind === 'file' && pattern.test(entry.name)) names.push(entry.name);
  names.sort().reverse(); // dates in the name sort newest first
  for (const n of names.slice(Math.max(1, keep))) await h.removeEntry(n);
}
