// Automatic daily backups into a folder the person chooses.
// In the app: the phone's own folder picker (Android storage access, iPhone Files) through our native plugin.
// On the website: the browser's folder picker, where the browser has one.
// The folder (or its permission) lives in the device-only table, so it never ends up inside a backup file.
import { db } from '../db/db';
import { getSettings, setSetting } from '../db/repos/settings';
import { exportBackup, markBackedUp } from '../db/repos/backup';
import { backupFilename } from '../logic/backup';
import { sealBackup } from '../logic/crypto';
import { APP_NAME } from '../config';
import { isNative, MedTapNative } from '../nfc/native';

export const canAutoBackup = isNative || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');
const DIR = 'backupDir';
const DUE_MS = 20 * 3_600_000; // roughly daily, without drifting later each day

export type AutoResult = 'done' | 'not-due' | 'needs-permission' | 'off' | 'unsupported' | 'error';

/** A folder chosen in the app: a content:// tree on Android, a bookmark on iPhone. */
type NativeFolder = { native: true; uri: string; name: string };
type Folder = FileSystemDirectoryHandle | NativeFolder;
const isNativeFolder = (f: Folder): f is NativeFolder => (f as NativeFolder).native === true;

/** What went wrong, for the message on screen. */
export class BackupError extends Error {
  constructor(message: string, readonly cancelled = false) { super(message); }
}

/** The backup file's text. Always encrypted (built-in key) so it can't simply be opened and read. */
export async function backupText(includePhotos: boolean): Promise<string> {
  const backup = await exportBackup({ includePhotos });
  const sealed = await sealBackup(JSON.stringify(backup));
  return JSON.stringify({ app: APP_NAME, format: backup.format, encrypted: true, sealed });
}

async function getFolder(): Promise<Folder | undefined> {
  const f = (await db.device.get(DIR))?.value as Folder | undefined;
  // A folder from the other kind of picker (say, a web handle restored into the app) can't be used here.
  return f && isNativeFolder(f) === isNative ? f : undefined;
}

/** The chosen folder's name, to show on screen. */
export async function folderName(): Promise<string | undefined> {
  return (await getFolder())?.name || undefined;
}

/** Ask for a folder (needs a tap), then back up straight away. Throws a BackupError if no folder was chosen. */
export async function chooseFolder(): Promise<AutoResult> {
  if (!canAutoBackup) return 'unsupported';
  let f: Folder;
  try {
    if (isNative) {
      const r = await MedTapNative.pickFolder();
      f = { native: true, uri: r.uri, name: r.name };
    } else {
      f = await window.showDirectoryPicker!({ id: 'medtap-backups', mode: 'readwrite', startIn: 'documents' });
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'cancelled' || (e as DOMException).name === 'AbortError') throw new BackupError('No folder chosen', true);
    if ((e as DOMException).name === 'SecurityError') throw new BackupError("This browser won't let websites save into folders. Use Back up now instead.");
    throw new BackupError(`Couldn't open the folder picker (${(e as Error).message || String(e)})`);
  }
  await db.device.put({ key: DIR, value: f });
  await setSetting('autoBackupEnabled', true);
  return runAutoBackup(true);
}

export async function stopAutoBackup() {
  await setSetting('autoBackupEnabled', false);
  await db.device.delete(DIR);
}

/** Browsers forget folder permission after a while; getting it back needs a tap.
 *  In the app, losing access means the folder was moved or deleted, so choose one again. */
export async function regainPermission(): Promise<AutoResult> {
  const f = await getFolder();
  if (!f) return isNative ? chooseFolder() : 'off';
  if (isNativeFolder(f)) return chooseFolder();
  if ((await f.requestPermission({ mode: 'readwrite' })) !== 'granted') return 'needs-permission';
  return runAutoBackup(true);
}

async function hasAccess(f: Folder): Promise<boolean> {
  if (isNativeFolder(f)) return (await MedTapNative.folderAccess({ uri: f.uri })).ok;
  return (await f.queryPermission({ mode: 'readwrite' })) === 'granted';
}

export async function autoBackupState(): Promise<'off' | 'ok' | 'needs-permission' | 'unsupported'> {
  if (!canAutoBackup) return 'unsupported';
  const s = await getSettings();
  const f = await getFolder();
  if (!s.autoBackupEnabled || !f) return 'off';
  return (await hasAccess(f).catch(() => false)) ? 'ok' : 'needs-permission';
}

/** Write today's backup if one is due, then keep only the newest `autoBackupKeep` files. Never asks for anything. */
export async function runAutoBackup(force = false): Promise<AutoResult> {
  if (!canAutoBackup) return 'unsupported';
  const s = await getSettings();
  const f = await getFolder();
  if (!s.autoBackupEnabled || !f) return 'off';
  if (!force && s.lastAutoBackupAt && Date.now() - Date.parse(s.lastAutoBackupAt) < DUE_MS) return 'not-due';
  try {
    if (!(await hasAccess(f))) return 'needs-permission';
    const text = await backupText(true);
    const name = backupFilename();
    await (isNativeFolder(f) ? MedTapNative.writeFile({ uri: f.uri, name, text }) : writeWeb(f, name, text));
    await prune(f, s.autoBackupKeep).catch((e) => console.error('Removing old backups failed', e));
    await setSetting('lastAutoBackupAt', new Date().toISOString());
    await markBackedUp();
    return 'done';
  } catch (e) {
    console.error('Automatic backup failed', e);
    if (force) throw new BackupError(`Couldn't save into ${f.name || 'that folder'} (${(e as Error).message || String(e)}). Try choosing it again.`);
    return 'error';
  }
}

async function writeWeb(h: FileSystemDirectoryHandle, name: string, text: string) {
  const file = await h.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(new Blob([text], { type: 'application/json' }));
  await w.close();
}

/** Backup files in the folder to remove: all but the newest `keep` (at least one is always kept). */
export function toRemove(names: string[], keep: number): string[] {
  const pattern = new RegExp(`^${APP_NAME}-backup-\\d{4}-\\d{2}-\\d{2}\\.json$`);
  return names.filter((n) => pattern.test(n)).sort().reverse().slice(Math.max(1, keep)); // dates in the name sort newest first
}

async function prune(f: Folder, keep: number) {
  if (isNativeFolder(f)) {
    const { names } = await MedTapNative.listFiles({ uri: f.uri });
    for (const n of toRemove(names, keep)) await MedTapNative.deleteFile({ uri: f.uri, name: n });
    return;
  }
  const names: string[] = [];
  for await (const entry of f.values()) if (entry.kind === 'file') names.push(entry.name);
  for (const n of toRemove(names, keep)) await f.removeEntry(n);
}
