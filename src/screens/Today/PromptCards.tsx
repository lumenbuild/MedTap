import { BUILD, checkForUpdate, installUpdate, type Update } from '../../app/updates';
import { useEffect, useState } from 'react';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { Download, FolderSync, HardDriveDownload, Smile } from 'lucide-react';
import { autoBackupState, BackupError, regainPermission } from '../../app/autoBackup';
import { isNative } from '../../nfc/native';
import { useToast } from '../../app/toast';
import type { Dose, Medication } from '../../db/schema';
import { setSetting } from '../../db/repos/settings';
import { go } from '../../app/router';
import { useInstallPrompt } from '../../app/install';
import { fmtAgo } from '../../logic/format';
import { isAndroid, isStandalone } from '../../platform';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export function CheckInPrompt({ dose, med, now, onCheckIn }: { dose: Dose; med?: Medication; now: number; onCheckIn: () => void }) {
  return (
    <Card className="flex gap-3">
      <Smile className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">How are you feeling?</p>
        <p className="text-sm text-muted tnum">It's been {fmtAgo(now - Date.parse(dose.takenAt)).replace(' ago', '')} since your {med ? shownName(med) : ''} dose.</p>
        <div className="flex gap-2 mt-3">
          <Button onClick={onCheckIn}>Check in</Button>
          <Button variant="secondary" onClick={() => setSetting('dismissedCheckInDoseId', dose.id)}>Not now</Button>
        </div>
      </div>
    </Card>
  );
}

export function BackupReminder({ days }: { days: number }) {
  return (
    <Card className="flex gap-3">
      <HardDriveDownload className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">Time for a backup</p>
        <p className="text-sm text-muted">It's been over {days === 1 ? 'a day' : days === 7 ? 'a week' : `${days} days`}. A backup keeps your history and tags safe if something happens to this phone.</p>
        <Button className="mt-3" onClick={() => go('/backup')}>Back up now</Button>
      </div>
    </Card>
  );
}

/** Android only, never on the first screen: shown once the person has logged a dose. */
export function InstallCard({ hasDoses, dismissed }: { hasDoses: boolean; dismissed: boolean }) {
  const install = useInstallPrompt();
  if (!isAndroid || isStandalone || !install.available || !hasDoses || dismissed) return null;
  return (
    <Card className="flex gap-3">
      <Download className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">Install {APP_NAME}</p>
        <p className="text-sm text-muted">Opens like an app, works offline, and tag taps go straight to it.</p>
        <div className="flex gap-2 mt-3">
          <Button onClick={() => install.prompt()}>Install</Button>
          <Button variant="secondary" onClick={() => setSetting('installCardDismissed', true)}>Not now</Button>
        </div>
      </div>
    </Card>
  );
}

/** Browsers drop folder permission after a while; one tap brings automatic backups back. */
export function AutoBackupPermission({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    if (enabled) autoBackupState().then((s) => setNeeds(s === 'needs-permission')).catch(() => setNeeds(false));
    else setNeeds(false);
  }, [enabled]);
  if (!needs) return null;
  return (
    <Card className="flex gap-3">
      <FolderSync className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">Keep automatic backups going</p>
        <p className="text-sm text-muted">{isNative ? "Can't reach the backup folder any more. It may have been moved or deleted." : 'Your browser needs your OK again to save into the backup folder.'}</p>
        <Button className="mt-3" onClick={async () => {
          try {
            if ((await regainPermission()) === 'done') { toast('Backed up to your folder'); setNeeds(false); }
            else toast("Couldn't save into that folder. Try again from Settings → Backup and restore.");
          } catch (e) {
            toast(e instanceof BackupError ? e.message : "Couldn't save into that folder.");
          }
        }}>{isNative ? 'Choose folder' : 'Allow'}</Button>
      </div>
    </Card>
  );
}

/** Android app: a newer build is out. Opens the download; "Later" hides this build's card. */
export function UpdateCard({ dismissed }: { dismissed: number }) {
  const [u, setU] = useState<Update | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { checkForUpdate().then(setU).catch(() => setU(null)); }, []);
  if (!u || u.build <= dismissed) return null;
  const install = async () => {
    setNote(''); setPct(0);
    const r = await installUpdate(u, setPct);
    setPct(null);
    if (r === 'permission') setNote(`Allow "Install unknown apps" for ${APP_NAME} in the screen that opened, then come back and tap Install again.`);
    else if (r === 'failed') setNote('The download didn’t finish. Check the connection and try again, or use the download link.');
    else setNote('Confirm in Android’s installer. The app restarts on the new build with your data kept.');
  };
  return (
    <Card className="flex gap-3">
      <Download className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{APP_NAME} build {u.build} is ready</p>
        <p className="text-sm text-muted">You have build {BUILD}.{u.notes ? ` What's new: ${u.notes}.` : ''} It installs over the top and keeps your data.</p>
        {pct !== null && (
          <div className="mt-3" role="status">
            <div className="h-2 rounded-full bg-border overflow-hidden" aria-hidden="true"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(pct, 3)}%` }} /></div>
            <p className="text-sm text-muted mt-1">Downloading{pct > 0 ? ` ${pct}%` : '…'}</p>
          </div>
        )}
        {note && <p className="text-sm mt-2" role="status">{note}</p>}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button onClick={install} disabled={pct !== null}>Install</Button>
          <Button variant="secondary" onClick={() => setSetting('updateDismissed', u.build)}>Later</Button>
        </div>
        <a href={u.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] text-sm text-muted underline underline-offset-4">Or download it in the browser</a>
      </div>
    </Card>
  );
}
