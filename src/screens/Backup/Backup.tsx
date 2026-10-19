import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useSettings } from '../../app/data';
import { useToast } from '../../app/toast';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { shareOrDownload } from '../../app/files';
import { exportBackup, importBackup, markBackedUp } from '../../db/repos/backup';
import { backupFilename, validateBackup, type BackupFile, type Counts } from '../../logic/backup';
import { bodyCsv, checkInsCsv, dosesCsv, medicationsCsv } from '../../logic/csv';
import { fmtAgo, fmtWhen } from '../../logic/format';
import { isIOS, isStandalone } from '../../platform';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';

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
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      const backup = await exportBackup({ includePhotos: includePhotos && photoCount > 0 });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      if (await shareOrDownload(backupFilename(), blob, `${APP_NAME} backup`)) {
        await markBackedUp();
        toast('Backup saved. Keep the file somewhere safe, like your cloud drive or email.');
      }
    } finally { setBusy(false); }
  };

  const exportCsv = async (kind: 'doses' | 'checkIns' | 'body' | 'meds') => {
    const meds = await db.medications.toArray();
    const csv = kind === 'doses' ? dosesCsv(await db.doses.toArray(), meds)
      : kind === 'checkIns' ? checkInsCsv(await db.checkIns.toArray())
      : kind === 'body' ? bodyCsv(await db.bodyEntries.toArray())
      : medicationsCsv(meds);
    const name = { doses: 'doses', checkIns: 'check-ins', body: 'body', meds: 'medications' }[kind];
    await shareOrDownload(`${APP_NAME}-${name}.csv`, new Blob([csv], { type: 'text/csv' }), `${APP_NAME} ${name}`);
  };

  const pick = async (file?: File) => {
    setError('');
    if (!file) return;
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { setError("This file isn't a backup. Choose the .json file you exported."); return; }
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
        <p className="text-sm text-muted">Backups aren't encrypted. Anyone with the file can read it.</p>
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
        {([['doses', 'Doses'], ['checkIns', 'Check-ins'], ['body', 'Weight and measurements'], ['meds', 'Medications']] as const).map(([k, label]) => (
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
              {Object.entries(pending.counts).filter(([k]) => k !== 'settings').map(([k, n]) => <li key={k}>{n} {LABELS[k] ?? k}</li>)}
            </ul>
            {!confirmReplace ? (
              <>
                <Button className="w-full min-h-[56px]" onClick={() => restore('merge')} disabled={busy}>Merge with this phone</Button>
                <p className="text-sm text-muted">Keeps everything already here and adds what's missing. Where both have the same record, the newer edit wins.</p>
                <Button variant="secondary" className="w-full" onClick={() => setConfirmReplace(true)} disabled={busy}>Replace this phone's data</Button>
              </>
            ) : (
              <>
                <p className="rounded-btn bg-caution-soft p-3">Everything currently on this phone will be removed and replaced with the backup. This can't be undone.</p>
                <Button variant="danger" className="w-full min-h-[56px]" onClick={() => restore('replace')} disabled={busy}>Replace everything</Button>
                <Button variant="secondary" className="w-full" onClick={() => setConfirmReplace(false)}>Go back</Button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
