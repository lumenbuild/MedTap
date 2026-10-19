// Backup file format and restore rules. Pure: no database access here.
import { APP_NAME } from '../config';

export const BACKUP_FORMAT = 1;

export const BACKUP_TABLES = ['medications', 'tags', 'doses', 'checkIns', 'bodyEntries', 'medEvents', 'settings', 'photos'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export type Row = Record<string, unknown>;

export interface BackupFile {
  app: string;
  format: number;
  /** Dexie schema version of the app that made it. */
  schemaVersion: number;
  exportedAt: string;
  tables: Partial<Record<BackupTable, Row[]>>;
}

export type Counts = Partial<Record<BackupTable, number>>;

export const keyOf = (table: BackupTable) => (table === 'settings' ? 'key' : 'id');

export function backupFilename(now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${APP_NAME}-backup-${d}.json`;
}

export function makeBackup(tables: Partial<Record<BackupTable, Row[]>>, schemaVersion: number, now = new Date()): BackupFile {
  return { app: APP_NAME, format: BACKUP_FORMAT, schemaVersion, exportedAt: now.toISOString(), tables };
}

/** Check a parsed file before touching the database. Errors are written for the person, not a developer. */
export function validateBackup(data: unknown, currentSchema: number):
  { ok: true; backup: BackupFile; counts: Counts } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!data || typeof data !== 'object') return bad("This file isn't a backup.");
  const b = data as Partial<BackupFile>;
  if (typeof b.format !== 'number' || !b.tables || typeof b.tables !== 'object') return bad("This file isn't a backup.");
  if (b.format > BACKUP_FORMAT || (b.schemaVersion ?? 0) > currentSchema) {
    return bad('This backup was made by a newer version of the app. Update the app (reload the page), then try again.');
  }
  const tables: BackupFile['tables'] = {};
  const counts: Counts = {};
  for (const t of BACKUP_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return bad('This backup is damaged and can’t be restored.');
    const key = keyOf(t);
    if (!rows.every((r) => r && typeof r === 'object' && typeof (r as Row)[key] === 'string')) {
      return bad('This backup is damaged and can’t be restored.');
    }
    tables[t] = rows as Row[];
    counts[t] = t === 'settings' ? rows.length : (rows as Row[]).filter((r) => !r.deletedAt).length;
  }
  return { ok: true, backup: { app: String(b.app ?? ''), format: b.format, schemaVersion: b.schemaVersion ?? 1, exportedAt: String(b.exportedAt ?? ''), tables }, counts };
}

/** Rows to write when merging: new ids are added; for an id on both sides, the newer `updatedAt` wins.
 *  Rows without `updatedAt` (tags, events, settings) keep the local copy. */
export function mergeRows(table: BackupTable, local: Row[], incoming: Row[]): Row[] {
  const key = keyOf(table);
  const byKey = new Map(local.map((r) => [r[key] as string, r]));
  const out: Row[] = [];
  for (const r of incoming) {
    const mine = byKey.get(r[key] as string);
    if (!mine) { out.push(r); continue; }
    const a = typeof mine.updatedAt === 'string' ? Date.parse(mine.updatedAt) : NaN;
    const b = typeof r.updatedAt === 'string' ? Date.parse(r.updatedAt) : NaN;
    if (b > a) out.push(r);
  }
  return out;
}

// Blob ⇄ base64 data URL, so photos survive JSON. Works in browsers and Node.
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(data ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
