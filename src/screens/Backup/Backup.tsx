import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FolderSync, Upload } from 'lucide-react';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useSettings } from '../../app/data';
import { useToast } from '../../app/toast';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { shareOrDownload } from '../../app/files';
import { importBackup, markBackedUp } from '../../db/repos/backup';
import { listPeople } from '../../db/repos/people';
import { DEFAULT_PERSON } from '../../db/schema';
import { setSetting } from '../../db/repos/settings';
import { isSealed, unsealBackup } from '../../logic/crypto';
import { autoBackupState, BackupError, backupText, chooseFolder, folderName, regainPermission, runAutoBackup, stopAutoBackup } from '../../app/autoBackup';
import { isNative, nativePlatform } from '../../nfc/native';
import { backupFilename, validateBackup, type BackupFile, type Counts } from '../../logic/backup';
import { bodyCsv, checkInsCsv, dosesCsv, medicationsCsv, vitalsCsv } from '../../logic/csv';
import { fmtAgo, fmtWhen } from '../../logic/format';
import { isIOS, isStandalone } from '../../platform';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { HAS_BODY } from '../../edition';

const LABELS: Record<string, string> = {
  medications: 'medications', tags: 'tags', doses: 'doses', checkIns: 'check-ins', bodyEntries: 'body entries',
  medEvents: 'medication changes', photos: 'photos',
};

export function Backup() {
  const settings = useSettings();
  const now = useNow(60_000);
  const toast = useToast();
  const photoCount = useLive(() => db.photos.count()) ?? 0;
  const [includePhotos, setIncludePhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ backup: BackupFile; counts: Counts } | null>(null);
  const [error, setError] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [auto, setAuto] = useState<Awaited<ReturnType<typeof autoBackupState>>>('off');
  const [folder, setFolder] = useState<string>();
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setAuto(await autoBackupState().catch(() => 'needs-permission' as const));
    setFolder(await folderName().catch(() => undefined));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const doExport = async () => {
    setBusy(true);
    try {
      const blob = new Blob([await backupText(includePhotos && photoCount > 0)], { type: 'application/json' });
      if (await shareOrDownload(backupFilename(), blob, `${APP_NAME} backup`)) {
        await markBackedUp();
        toast('Backup saved. Keep the file somewhere safe, like your cloud drive or email.');
      }
    } finally { setBusy(false); }
  };

  /** Every tap ends with a message: saved, cancelled, or what went wrong. */
  const autoAction = async (fn: () => Promise<string>) => {
    setAutoError('');
    setAutoBusy(true);
    try {
      const r = await fn();
      if (r === 'done') toast(`Backed up to ${(await folderName().catch(() => undefined)) ?? 'your folder'}`);
      else if (r === 'needs-permission') setAutoError(isNative ? "Can't reach that folder. Choose it again, or pick another." : 'Allow access to the folder to keep automatic backups going.');
      else if (r === 'error') setAutoError("Couldn't save into that folder. Try choosing it again.");
      else if (r === 'unsupported') setAutoError("This browser can't save backups by itself. Use Back up now instead.");
      else if (r === 'off') setAutoError('Choose a folder first.');
    } catch (e) {
      if (e instanceof BackupError && e.cancelled) toast('No folder chosen');
      else setAutoError(e instanceof BackupError ? e.message : `Something went wrong (${String(e)}).`);
    } finally { setAutoBusy(false); }
    refresh();
  };

  const exportCsv = async (kind: 'doses' | 'checkIns' | 'body' | 'vitals' | 'meds') => {
    const meds = await db.medications.toArray();
    const people = await listPeople();
    const person = (id?: string) => people.find((p) => p.id === (id ?? DEFAULT_PERSON))?.name ?? 'Me';
    const csv = kind === 'doses' ? dosesCsv(await db.doses.toArray(), meds, person)
      : kind === 'checkIns' ? checkInsCsv(await db.checkIns.toArray(), person)
      : kind === 'body' ? bodyCsv(await db.bodyEntries.toArray(), person)
      : kind === 'vitals' ? vitalsCsv(await db.vitals.toArray(), person)
      : medicationsCsv(meds, person);
    const name = { doses: 'doses', checkIns: 'check-ins', body: 'body', vitals: 'blood-pressure', meds: 'medications' }[kind];
    await shareOrDownload(`${APP_NAME}-${name}.csv`, new Blob([csv], { type: 'text/csv' }), `${APP_NAME} ${name}`);
  };

  const pick = async (file?: File) => {
    setError('');
    if (!file) return;
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { setError("This file isn't a backup. Choose the .json file you exported."); return; }
    if (isSealed(data)) {
      try { data = JSON.parse(await unsealBackup(data.sealed)); } catch { setError("This backup couldn't be opened. It may be damaged, or not made by this app."); return; }
    }
    check(data);
  };
  const check = (data: unknown) => {
    const v = validateBackup(data, db.verno);
    if (!v.ok) { setError(v.error); return; }
    setPending({ backup: v.backup, counts: v.counts });
  };
  const restore = async (mode: 'merge' | 'replace') => {
    if (!pending) return;
    setBusy(true);
    try {
      await importBackup(pending.backup, mode);
      setPending(null);
      setConfirmReplace(false);
      toast(mode === 'merge' ? 'Backup merged. Your tags are linked again.' : 'Backup restored. Your tags are linked again.');
      go('/today');
    } catch (e) {
      setError(`Couldn't restore this backup. Nothing was changed. (${String(e)})`);
    } finally { setBusy(false); }
  };

  const last = settings?.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;

  return (
    <div className="space-y-4">
      {isIOS && isStandalone && (
        <Card className="bg-caution-soft shadow-none space-y-2">
          <h2 className="font-semibold">Move your data to Safari</h2>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>Tap <strong>Back up now</strong> below and save the file to Files.</li>
            <li>Open {APP_NAME} in Safari.</li>
            <li>Go to Settings → Backup and restore → <strong>Restore from a file</strong>.</li>
          </ol>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Back up</h2>
        <p className="text-muted tnum" role="status">
          {last ? <>Last backup {fmtAgo(now - last)} · {fmtWhen(last, now)}</> : 'No backup yet.'}
        </p>
        <p className="text-sm">One file with everything, including your tags, so a new phone can pick up where this one left off.</p>
        {photoCount > 0 && (
          <label className="flex items-center gap-3 min-h-[48px]">
            <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
            <span>Include {photoCount} progress photo{photoCount === 1 ? '' : 's'} (bigger file)</span>
          </label>
        )}
        <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={doExport} disabled={busy}>
          <Download size={20} aria-hidden="true" /> Back up now
        </Button>
        <p className="text-sm text-muted">Backup files are encrypted, so they can't be read by opening them. Any copy of {APP_NAME} can restore them, no password needed.</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><FolderSync size={20} className="text-primary" aria-hidden="true" /> Automatic backups</h2>
        {auto === 'unsupported' ? (
          <p className="text-sm">This browser can't save backups by itself{isIOS ? ' (iPhones don\'t allow it)' : ''}. Use <strong>Back up now</strong> and {APP_NAME} will remind you.</p>
        ) : auto === 'off' ? (
          <>
            <p className="text-sm">Choose a folder, such as one your cloud drive syncs, and {APP_NAME} saves a backup there each day you open it, keeping the last {settings?.autoBackupKeep ?? 7}.</p>
            {nativePlatform === 'android' && <p className="text-sm text-muted">Pick or make a folder, such as Documents/{APP_NAME}, then tap <strong>Use this folder</strong>. Android doesn't allow the Download folder itself.</p>}
            <Button className="w-full" onClick={() => autoAction(chooseFolder)} disabled={autoBusy}>{autoBusy ? 'Saving…' : 'Choose a folder'}</Button>
          </>
        ) : auto === 'needs-permission' ? (
          <>
            <p className="text-sm rounded-btn bg-caution-soft p-3">
              {isNative ? `${APP_NAME} can't reach ${folder ?? 'the backup folder'} any more. It may have been moved or deleted.` : 'The browser needs your OK again to save into the backup folder.'}
            </p>
            <Button className="w-full" onClick={() => autoAction(regainPermission)} disabled={autoBusy}>{isNative ? 'Choose the folder again' : 'Allow automatic backups'}</Button>
            <Button variant="secondary" className="w-full" onClick={async () => { await stopAutoBackup(); refresh(); }}>Turn off</Button>
          </>
        ) : (
          <>
            <p className="text-sm tnum" role="status">
              On{folder ? <>, saving to <strong>{folder}</strong></> : ''}. {settings?.lastAutoBackupAt ? `Last saved ${fmtAgo(now - Date.parse(settings.lastAutoBackupAt))}.` : 'Nothing saved yet.'}
            </p>
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Keep</span>
              <select value={settings?.autoBackupKeep ?? 7} onChange={(e) => setSetting('autoBackupKeep', Number(e.target.value))}
                className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3">
                {[3, 7, 14, 30].map((n) => <option key={n} value={n}>The last {n} days</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => autoAction(() => runAutoBackup(true))} disabled={autoBusy}>{autoBusy ? 'Saving…' : 'Back up now'}</Button>
              <Button variant="secondary" onClick={() => autoAction(chooseFolder)} disabled={autoBusy}>Change folder</Button>
            </div>
            <Button variant="secondary" className="w-full" onClick={async () => { await stopAutoBackup(); refresh(); }}>Turn off</Button>
          </>
        )}
        {autoError && <p role="alert" className="text-sm rounded-btn bg-caution-soft p-3">{autoError}</p>}
        <label className="block space-y-1.5 pt-1">
          <span className="block text-sm font-medium">Remind me to back up when it's been</span>
          <select value={settings?.backupReminderDays ?? 7} onChange={(e) => setSetting('backupReminderDays', Number(e.target.value))}
            className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3">
            {[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n === 1 ? '1 day' : `${n} days`}</option>)}
          </select>
        </label>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Restore from a file</h2>
        <p className="text-sm">Choose a backup file. You'll see what's in it before anything changes.</p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Backup file"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={20} aria-hidden="true" /> Choose backup file
        </Button>
        {error && <p role="alert" className="text-sm rounded-btn bg-caution-soft p-3">{error}</p>}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Spreadsheets</h2>
        <p className="text-sm text-muted">CSV files you can open in Excel, Numbers or Google Sheets. These can't be restored.</p>
        {([['doses', 'Doses'], ['checkIns', 'Check-ins'], ...(HAS_BODY ? [['body', 'Weight and measurements'] as const] : []), ['vitals', 'Blood pressure and heart rate'], ['meds', 'Medications']] as const).map(([k, label]) => (
          <button key={k} onClick={() => exportCsv(k)} className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-btn bg-surface-2 text-left font-medium">
            <FileSpreadsheet size={20} className="text-primary" aria-hidden="true" /> {label}
          </button>
        ))}
      </Card>

      <Sheet open={!!pending} onClose={() => { setPending(null); setConfirmReplace(false); }} title="Restore this backup?">
        {pending && (
          <div className="space-y-4">
            <p className="text-muted">
              Made {pending.backup.exportedAt ? fmtWhen(Date.parse(pending.backup.exportedAt), now) : 'at an unknown time'}. It contains:
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 tnum">
              {Object.entries(pending.counts).filter(([k]) => k !== 'settings' && (HAS_BODY || !['bodyEntries', 'photos'].includes(k))).map(([k, n]) => <li key={k}>{n} {LABELS[k] ?? k}</li>)}
            </ul>
            {!confirmReplace ? (
              <>
                <p className="text-sm text-muted"><strong className="text-text">Merge</strong> keeps everything already here and adds what's missing. Where both have the same record, the newer edit wins.</p>
                <SheetActions>
                  <Button className="w-full min-h-[56px]" onClick={() => restore('merge')} disabled={busy}>Merge with this phone</Button>
                  <Button variant="secondary" className="w-full" onClick={() => setConfirmReplace(true)} disabled={busy}>Replace this phone's data</Button>
                </SheetActions>
              </>
            ) : (
              <>
                <p className="rounded-btn bg-caution-soft p-3">Everything currently on this phone will be removed and replaced with the backup. This can't be undone.</p>
                <SheetActions>
                  <Button variant="danger" className="w-full min-h-[56px]" onClick={() => restore('replace')} disabled={busy}>Replace everything</Button>
                  <Button variant="secondary" className="w-full" onClick={() => setConfirmReplace(false)}>Go back</Button>
                </SheetActions>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

