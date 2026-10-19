import { useMemo, useState } from 'react';
import { CalendarPlus, Lock, Nfc, Pill, Ruler, Scale, Smile } from 'lucide-react';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDoses, useMeds, useScheduleSettings } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go } from '../../app/router';
import { addToCalendar } from '../../app/calendar';
import { byUrgency, getNextDue, getStatus } from '../../logic/schedule';
import { checkInPromptDose, lowStockMeds, needsBackup } from '../../logic/reminders';
import { fmtAgo, fmtAmount, fmtMedName, fmtTime } from '../../logic/format';
import { removeDose } from '../../db/repos/doses';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { IOSBanner } from '../../components/IOSBanner';
import { CheckInSheet, type CheckInSeed } from '../../components/CheckInSheet';
import { BodySheet, type BodySheetState } from '../../components/BodySheets';
import { HeroCard } from './HeroCard';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';
import { BackupReminder, CheckInPrompt, InstallCard, LowStock } from './PromptCards';

export function Today() {
  const meds = useMeds();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const ss = useScheduleSettings();
  const now = useNow();
  const toast = useToast();
  const [logFor, setLogFor] = useState<Medication | null>(null);
  const [editing, setEditing] = useState<Dose | null>(null);
  const [checkIn, setCheckIn] = useState<CheckInSeed | null>(null);
  const [bodySheet, setBodySheet] = useState<BodySheetState>(null);

  const medMap = useMemo(() => new Map((meds ?? []).map((m) => [m.id, m])), [meds]);

  if (!meds || !doses || !checkIns || !body || !ss) return <TodaySkeleton />;
  const [settings, s] = ss;
  const active = meds.filter((m) => !m.archived);
  // Order is fixed per minute so cards don't reshuffle under the user's thumb every second.
  const scheduled = byUrgency(active.filter((m) => m.schedule.type !== 'prn'), doses, Math.floor(now / 60_000) * 60_000, s);
  const prn = active.filter((m) => m.schedule.type === 'prn');

  const firstRecord = [...doses, ...checkIns, ...body].filter((r) => !r.deletedAt).reduce<number | null>((min, r) => {
    const t = Date.parse(r.createdAt);
    return min === null || t < min ? t : min;
  }, null);
  const promptDose = checkInPromptDose(doses, checkIns, now, settings.checkInDelayMin, settings.dismissedCheckInDoseId);
  const low = lowStockMeds(meds, settings.dismissedLowStock);
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;

  const onLogged = (d: Dose) => {
    const med = medMap.get(d.medicationId);
    setLogFor(null);
    toast(`Logged ${fmtAmount(d.amount, med?.unit ?? '')} at ${fmtTime(Date.parse(d.takenAt))}`, {
      onAction: async () => { await removeDose(d.id); toast('Dose removed. Nothing was logged.'); },
    });
  };
  const hero = (m: Medication, className?: string) => {
    const next = getNextDue(m, doses, now, s);
    const showCal = next !== null && next > now && getStatus(m, doses, now, s) === 'not-due';
    return (
      <div key={m.id} className={className}>
        <HeroCard med={m} doses={doses} s={s} now={now} onLog={() => setLogFor(m)}
          footer={showCal ? (
            <button onClick={() => addToCalendar(m, next!)} className="w-full min-h-[48px] mt-2 flex items-center justify-center gap-2 text-primary font-semibold">
              <CalendarPlus size={18} aria-hidden="true" /> Add {fmtTime(next!)} to calendar
            </button>
          ) : null} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <IOSBanner dismissed={settings.iosBannerDismissed} />

      {settings.pendingTags.length > 0 && (
        <Card className="flex items-center gap-3">
          <Nfc className="text-primary shrink-0" aria-hidden="true" />
          <p className="flex-1">{settings.pendingTags.length === 1 ? 'A new tag is' : `${settings.pendingTags.length} new tags are`} waiting to be linked.</p>
          <Button variant="secondary" onClick={() => go(`/tag/${settings.pendingTags[0]}`)}>Link</Button>
        </Card>
      )}

      {active.length === 0 && (
        <Card className="text-center py-8">
          <Pill className="mx-auto text-primary" size={32} aria-hidden="true" />
          <p className="mt-3">No medications yet. Add one to start logging doses.</p>
          <Button className="mt-4" onClick={() => go('/meds/new')}>Add medication</Button>
        </Card>
      )}

      {scheduled.length === 1 && hero(scheduled[0])}
      {scheduled.length > 1 && (
        <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 no-scrollbar" aria-label="Scheduled medications">
          {scheduled.map((m) => hero(m, 'snap-start shrink-0 w-[calc(100%-28px)]'))}
        </div>
      )}

      {promptDose && <CheckInPrompt dose={promptDose} med={medMap.get(promptDose.medicationId)} now={now} onCheckIn={() => setCheckIn({ relatedDoseId: promptDose.id })} />}
      <LowStock meds={low} settings={settings} />

      {prn.length > 0 && (
        <section className="space-y-2" aria-label="As needed">
          <h2 className="text-sm font-semibold text-muted px-1">As needed</h2>
          {prn.map((m) => <PrnCard key={m.id} med={m} doses={doses} s={s} now={now} onLog={() => setLogFor(m)} />)}
        </section>
      )}

      <div className="grid grid-cols-3 gap-2" aria-label="Quick actions">
        {([
          ['Check in', Smile, () => setCheckIn({})],
          ['Log weight', Scale, () => setBodySheet({ kind: 'weight' })],
          ['Add measurement', Ruler, () => setBodySheet({ kind: 'measure' })],
        ] as const).map(([label, Icon, on]) => (
          <button key={label} onClick={on} className="bg-surface rounded-card shadow-card min-h-[80px] flex flex-col items-center justify-center gap-1.5 px-2 text-sm font-medium text-center">
            <Icon className="text-primary" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {needsBackup(settings.lastBackupAt, firstRecord, now) && <BackupReminder />}
      <InstallCard hasDoses={doses.some((d) => !d.deletedAt)} dismissed={settings.installCardDismissed} />

      <Timeline doses={doses} checkIns={checkIns} body={body} meds={medMap} s={s} units={settings.units} now={now}
        onDose={setEditing} onCheckIn={(c: CheckIn) => setCheckIn({ editing: c })} onBody={(b: BodyEntry) => setBodySheet({ kind: 'edit', entry: b })} />

      <a href="#/backup" className="flex flex-wrap items-center justify-center gap-x-2 min-h-[48px] text-sm text-muted tnum">
        <span className="flex items-center gap-2"><Lock size={16} aria-hidden="true" /> Saved on this device</span>
        <span aria-hidden="true">·</span>
        <span>{last ? `Last backup ${fmtAgo(now - last)}` : 'No backup yet'}</span>
      </a>

      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title={logFor ? `Log ${fmtMedName(logFor)}` : ''}>
        {logFor && <LogDoseFlow med={logFor} doses={doses} s={s} now={now} onLogged={onLogged} onCancel={() => setLogFor(null)} />}
      </Sheet>
      <DoseEditSheet dose={editing} med={editing ? medMap.get(editing.medicationId) : undefined} onClose={() => setEditing(null)} />
      <CheckInSheet seed={checkIn} onClose={() => setCheckIn(null)} doses={doses} checkIns={checkIns} meds={meds} chips={settings.chips} s={s} />
      <BodySheet state={bodySheet} onClose={() => setBodySheet(null)} units={settings.units} />
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-[420px] rounded-card bg-surface-2 animate-pulse" />
      <div className="h-32 rounded-card bg-surface-2 animate-pulse" />
    </div>
  );
}
