import { Download, HardDriveDownload, Package, Smile } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import type { AppSettings } from '../../db/repos/settings';
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
        <p className="text-sm text-muted tnum">It's been {fmtAgo(now - Date.parse(dose.takenAt)).replace(' ago', '')} since your {med?.name ?? ''} dose.</p>
        <div className="flex gap-2 mt-3">
          <Button onClick={onCheckIn}>Check in</Button>
          <Button variant="secondary" onClick={() => setSetting('dismissedCheckInDoseId', dose.id)}>Not now</Button>
        </div>
      </div>
    </Card>
  );
}

export function BackupReminder() {
  return (
    <Card className="flex gap-3">
      <HardDriveDownload className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">Time for a backup</p>
        <p className="text-sm text-muted">It's been over a week. A backup keeps your history and tags safe if something happens to this phone.</p>
        <Button className="mt-3" onClick={() => go('/backup')}>Back up now</Button>
      </div>
    </Card>
  );
}

export function LowStock({ meds, settings }: { meds: Medication[]; settings: AppSettings }) {
  return (
    <>
      {meds.map((m) => (
        <Card key={m.id} className="flex gap-3 bg-caution-soft shadow-none">
          <Package className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="tnum"><strong>{m.name}</strong> is down to {m.stockCount}. You asked to know at {m.lowStockAt}.</p>
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={() => go(`/meds/${m.id}`)}>Update stock</Button>
              <Button variant="secondary" onClick={() => setSetting('dismissedLowStock', { ...settings.dismissedLowStock, [m.id]: m.stockCount! })}>Dismiss</Button>
            </div>
          </div>
        </Card>
      ))}
    </>
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
