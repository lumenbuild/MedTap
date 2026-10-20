import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Pretend to be the app, with a phone folder held in memory.
const files = new Map<string, string>();
const plugin = vi.hoisted(() => ({
  pickFolder: vi.fn(),
  folderAccess: vi.fn(),
  writeFile: vi.fn(),
  listFiles: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock('../src/nfc/native', () => ({ isNative: true, nativePlatform: 'android', MedTapNative: plugin }));

import { db } from '../src/db/db';
import { getSettings, setSetting } from '../src/db/repos/settings';
import { autoBackupState, BackupError, chooseFolder, folderName, runAutoBackup, stopAutoBackup, toRemove } from '../src/app/autoBackup';

const URI = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FMedTap';

beforeEach(async () => {
  await db.delete();
  await db.open();
  files.clear();
  vi.clearAllMocks();
  plugin.pickFolder.mockResolvedValue({ uri: URI, name: 'MedTap' });
  plugin.folderAccess.mockResolvedValue({ ok: true });
  plugin.writeFile.mockImplementation(async ({ name, text }: { name: string; text: string }) => { files.set(name, text); });
  plugin.listFiles.mockImplementation(async () => ({ names: [...files.keys()] }));
  plugin.deleteFile.mockImplementation(async ({ name }: { name: string }) => { files.delete(name); });
});

describe('automatic backups in the app', () => {
  it('choosing a folder saves a backup there straight away', async () => {
    expect(await autoBackupState()).toBe('off');
    expect(await chooseFolder()).toBe('done');
    expect(plugin.writeFile).toHaveBeenCalledWith(expect.objectContaining({ uri: URI }));
    const [name] = [...files.keys()];
    expect(name).toMatch(/^MedTap-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(files.get(name)!)).toMatchObject({ app: 'MedTap', encrypted: true });
    expect(await autoBackupState()).toBe('ok');
    expect(await folderName()).toBe('MedTap');
    expect((await getSettings()).lastAutoBackupAt).toBeDefined();
  });

  it('cancelling the picker says so, and changes nothing', async () => {
    plugin.pickFolder.mockRejectedValue(Object.assign(new Error('No folder chosen'), { code: 'cancelled' }));
    const e = await chooseFolder().catch((x) => x);
    expect(e).toBeInstanceOf(BackupError);
    expect(e.cancelled).toBe(true);
    expect(await autoBackupState()).toBe('off');
  });

  it('a folder that has gone asks to be chosen again', async () => {
    await chooseFolder();
    plugin.folderAccess.mockResolvedValue({ ok: false });
    expect(await autoBackupState()).toBe('needs-permission');
    expect(await runAutoBackup(true)).toBe('needs-permission');
  });

  it('a failed save explains why when tapped, and stays quiet in the background', async () => {
    await chooseFolder();
    plugin.writeFile.mockRejectedValue(new Error('No space left'));
    await expect(runAutoBackup(true)).rejects.toThrow(/No space left/);
    await setSetting('lastAutoBackupAt', undefined as unknown as string);
    expect(await runAutoBackup()).toBe('error');
  });

  it('only once a day unless asked, and keeps the newest files', async () => {
    for (const d of ['01', '02', '03', '04', '05']) files.set(`MedTap-backup-2026-01-${d}.json`, '{}');
    files.set('notes.txt', 'mine');
    await setSetting('autoBackupKeep', 3);
    await chooseFolder();
    expect(await runAutoBackup()).toBe('not-due');
    // Today's backup plus the two newest older ones; other files are left alone.
    expect(files.size).toBe(4);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['MedTap-backup-2026-01-04.json', 'MedTap-backup-2026-01-05.json', 'notes.txt']));
  });

  it('turning off forgets the folder', async () => {
    await chooseFolder();
    await stopAutoBackup();
    expect(await autoBackupState()).toBe('off');
    expect(await folderName()).toBeUndefined();
  });
});

describe('toRemove', () => {
  it('keeps the newest backups and ignores other files', () => {
    const names = ['MedTap-backup-2026-03-01.json', 'MedTap-backup-2026-03-03.json', 'MedTap-backup-2026-03-02.json', 'photo.jpg', 'MedTap-backup-2026-03-02 (1).json'];
    expect(toRemove(names, 2)).toEqual(['MedTap-backup-2026-03-01.json']);
    expect(toRemove(names, 0)).toEqual(['MedTap-backup-2026-03-02.json', 'MedTap-backup-2026-03-01.json']);
  });
});
