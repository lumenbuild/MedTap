import { BUILD, checkForUpdate, installUpdate, type Update } from '../../app/updates';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { shownName } from '../../logic/privacy';
import { AlertCircle, Annoyed, ChevronDown, Download, Frown, FolderSync, HardDriveDownload, Laugh, Meh, Smile, X } from 'lucide-react';
import { IconRow } from '../../components/ui/Visual';
import { autoBackupState, BackupError, regainPermission } from '../../app/autoBackup';
import { isNative } from '../../nfc/native';
import { useToast } from '../../app/toast';
import type { Medication } from '../../db/schema';
import type { CheckInAsk } from '../../logic/reminders';
import { setSetting } from '../../db/repos/settings';
import { addCheckIn, removeCheckIn } from '../../db/repos/checkIns';
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

/** A stimulant dose taken a while ago: one tap rates focus since (1 scattered to 5 sharp), saved as a check-in tied to
 *  the dose. These build up "which dose and time works best". */
export function FocusQuick({ med, dose, now, personId }: { med: Medication; dose: { id: string; takenAt: string }; now: number; personId?: string }) {
  const toast = useToast();
  const key = `focusAsked:${dose.id}`;
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  if (gone) return null;
  const done = () => { try { localStorage.setItem(key, '1'); } catch { /* fine */ } setGone(true); };
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Focus since your {shownName(med)}?</p>
        <button type="button" aria-label="Not now" className="w-11 h-11 -mr-2 flex items-center justify-center text-muted" onClick={done}><X size={20} /></button>
      </div>
      <p className="text-sm text-muted tnum -mt-2">{fmtAgo(now - Date.parse(dose.takenAt)).replace(' ago', '')} after the {fmtTime(Date.parse(dose.takenAt))} dose</p>
      <div className="grid grid-cols-5 gap-2" role="group" aria-label="Focus, 1 scattered to 5 sharp">
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} type="button" aria-label={`Focus ${v} of 5`} onClick={async () => {
            const c = await addCheckIn({ at: new Date().toISOString(), focus: v, chips: [], relatedDoseId: dose.id, personId });
            done();
            toast(`Focus ${v} noted`, { onAction: () => removeCheckIn(c.id) });
          }} className="min-h-[56px] rounded-card bg-surface-2 text-[20px] font-semibold tnum active:scale-95 transition-transform">{v}</button>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-muted"><span>Scattered</span><span>Sharp</span></div>
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

/** Stock, vials, supplies, backups, tags to link: one of them is shown as it is; two or more fold into one line that
 *  opens to show each. Today stays about the day rather than a stack of chores. */
export function NeedsAttention({ items }: { items: { key: string; label: string; node: ReactNode }[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  if (items.length === 1) return <>{items[0].node}</>;
  return (
    <section aria-label="Needs attention" className="space-y-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="w-full flex items-center gap-3 rounded-card bg-caution-soft p-3 min-h-[56px] text-left">
        <AlertCircle size={22} aria-hidden="true" className="text-caution shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-medium">{items.length} things need attention</span>
          <span className="block text-sm truncate">{items.map((x) => x.label).join(' · ')}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && items.map((x) => <Fragment key={x.key}>{x.node}</Fragment>)}
    </section>
  );
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
