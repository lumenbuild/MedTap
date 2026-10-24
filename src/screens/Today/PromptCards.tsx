import { BUILD, checkForUpdate, installUpdate, type Update } from '../../app/updates';
import { useEffect, useState } from 'react';
import { shownName } from '../../logic/privacy';
import { Annoyed, Download, Frown, FolderSync, HardDriveDownload, Laugh, Meh, Smile, X } from 'lucide-react';
import { IconRow } from '../../components/ui/Visual';
import { autoBackupState, BackupError, regainPermission } from '../../app/autoBackup';
import { isNative } from '../../nfc/native';
import { useToast } from '../../app/toast';
import type { Medication } from '../../db/schema';
import type { CheckInAsk } from '../../logic/reminders';
import { setSetting } from '../../db/repos/settings';
import { go } from '../../app/router';
import { useInstallPrompt } from '../../app/install';
import { fmtAgo, fmtTime } from '../../logic/format';
import { isAndroid, isStandalone } from '../../platform';
import { APP_NAME } from '../../config';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/** After a dose, or at a daily check-in time: one tap on a face starts a check-in with that mood. */
export function CheckInPrompt({ ask, med, now, onCheckIn }: { ask: CheckInAsk; med?: Medication; now: number; onCheckIn: (mood?: number) => void }) {
  const faces = [Frown, Annoyed, Meh, Smile, Laugh];
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{ask.kind === 'daily' ? 'How has today been?' : 'How are you feeling?'}</p>
        <button type="button" aria-label="Not now" className="w-11 h-11 -mr-2 flex items-center justify-center text-muted" onClick={() => setSetting('dismissedCheckInDoseId', ask.key)}><X size={20} /></button>
      </div>
      <p className="text-sm text-muted tnum -mt-2">
        {ask.dose ? `${fmtAgo(now - Date.parse(ask.dose.takenAt)).replace(' ago', '')} after ${med ? shownName(med) : 'your dose'}` : `Your ${fmtTime(ask.at)} check-in`}
      </p>
      <div className="grid grid-cols-5 gap-2" role="group" aria-label="Mood">
        {faces.map((F, i) => (
          <button key={i} type="button" aria-label={`Mood ${i + 1} of 5`} onClick={() => onCheckIn(i + 1)}
            className="min-h-[56px] rounded-card bg-surface-2 flex items-center justify-center active:scale-95 transition-transform"><F size={28} aria-hidden="true" /></button>
        ))}
      </div>
    </Card>
  );
}

/** Opens the check-in by itself when one comes due (once each, a moment after Today shows, and not over another
 *  sheet). */
export function CheckInAutoOpen({ ask, enabled, shown, busy, onOpen }: { ask?: CheckInAsk; enabled: boolean; shown: string | null; busy: boolean; onOpen: (ask: CheckInAsk) => void }) {
  const key = ask && enabled && !busy && shown !== ask.key ? ask.key : null;
  useEffect(() => {
    if (!key || !ask) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      void setSetting('checkInPopupShown', key);
      onOpen(ask);
    }, 1500);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function BackupReminder({ days }: { days: number }) {
  return (
    <Card>
      <IconRow Icon={HardDriveDownload} tone="primary" action={<Button onClick={() => go('/backup')}>Back up</Button>}>
        No backup for {days === 1 ? 'a day' : days === 7 ? 'a week' : `${days} days`}
      </IconRow>
    </Card>
  );
}

/** Android only, never on the first screen: shown once the person has logged a dose. */
export function InstallCard({ hasDoses, dismissed }: { hasDoses: boolean; dismissed: boolean }) {
  const install = useInstallPrompt();
  if (!isAndroid || isStandalone || !install.available || !hasDoses || dismissed) return null;
  return (
    <Card>
      <IconRow Icon={Download} tone="primary" action={<div className="flex gap-1"><Button onClick={() => install.prompt()}>Install</Button><button type="button" aria-label="Not now" className="w-11 h-11 flex items-center justify-center text-muted" onClick={() => setSetting('installCardDismissed', true)}><X size={20} /></button></div>}>
        Install {APP_NAME}
      </IconRow>
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
        <p className="font-semibold">{isNative ? 'Backup folder not found' : 'Allow backups again'}</p>
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
    if (r === 'permission') setNote(`Turn on "Allow from this source", then tap Install again.`);
    else if (r === 'failed') setNote('Download didn’t finish. Try again.');
    else setNote('Tap Install in the box that opened. Your data stays.');
  };
  return (
    <Card className="flex gap-3">
      <Download className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{APP_NAME} build {u.build} is ready</p>
        <p className="text-sm text-muted">{u.notes || `You have build ${BUILD}`}</p>
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

      </div>
    </Card>
  );
}
