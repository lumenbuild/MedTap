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
