import { useEffect, useMemo, useState } from 'react';
import { clearLogRequest, onLogRequest } from '../../app/pendingLog';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { CalendarPlus, HeartPulse, Lock, Nfc, Pill, Ruler, Scale, Smile } from 'lucide-react';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMeds, useScheduleSettings, useVitals } from '../../app/data';
import { VitalsSheet, type VitalsSheetState } from '../../components/VitalsSheet';
import { dosesForPerson, medIsFor, personOf } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go } from '../../app/router';
import { addToCalendar } from '../../app/calendar';
import { byUrgency, getLastDose, getNextDue, getStatus } from '../../logic/schedule';
import { checkInPromptDose, needsBackup, refillAlerts } from '../../logic/reminders';
import { RefillCards } from '../../components/Refill';
import { fmtAgo, fmtAmount, fmtTime, fmtWhen } from '../../logic/format';
import { removeDose } from '../../db/repos/doses';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { IOSBanner } from '../../components/IOSBanner';
import { TravelBanner } from '../../components/TravelBanner';
import { CheckInSheet, type CheckInSeed } from '../../components/CheckInSheet';
import { BodySheet, type BodySheetState } from '../../components/BodySheets';
import { HeroCard } from './HeroCard';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';
import { AutoBackupPermission, BackupReminder, CheckInPrompt, InstallCard } from './PromptCards';

export function Today() {
  const meds = useMeds();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const vitals = useVitals();
  const [vitalSheet, setVitalSheet] = useState<VitalsSheetState>(null);
  const ss = useScheduleSettings();
  const fam = useFamily();
  const now = useNow();
  const toast = useToast();
  const [logFor, setLogFor] = useState<Medication | null>(null);
  const [editing, setEditing] = useState<Dose | null>(null);
  const [checkIn, setCheckIn] = useState<CheckInSeed | null>(null);
  const [bodySheet, setBodySheet] = useState<BodySheetState>(null);

  const medMap = useMemo(() => new Map((meds ?? []).map((m) => [m.id, m])), [meds]);
  // A tapped reminder notification opens Log dose for that medication.
  useEffect(() => onLogRequest((id) => {
    const m = medMap.get(id);
    if (m) { clearLogRequest(); setLogFor(m); }
  }), [medMap]);

  if (!meds || !doses || !checkIns || !body || !vitals || !ss || !fam) return <TodaySkeleton />;
  const [settings, s] = ss;
  // Whose medications are shown: one family member, or everyone (carer view, each card labelled).
  const mine = <T extends { personId?: string }>(r: T) => fam.everyone || personOf(r) === fam.personId;
  // Shared medications (e.g. Panadol) appear for everyone; in one person's view only their doses of them count.
  const viewMeds = meds.filter((m) => fam.everyone || medIsFor(m, fam.personId));
  const viewMedIds = new Set(viewMeds.map((m) => m.id));
  const medDoses = doses.filter((d) => viewMedIds.has(d.medicationId));
  const viewDoses = fam.everyone ? medDoses : dosesForPerson(medDoses, viewMeds, fam.personId);
  const viewCheckIns = checkIns.filter(mine);
  const viewBody = body.filter(mine);
  const viewVitals = vitals.filter(mine);
  const viewMedMap = new Map(viewMeds.map((m) => [m.id, m]));
  const whose = (r: { personId?: string; shared?: boolean }) => {
    if (!fam.everyone) return r.shared && fam.many ? 'Shared' : undefined;
    if (!r.shared) return fam.nameOf(personOf(r));
    const last = getLastDose(doses, (r as Medication).id, now);
    return last ? `Shared · last taken by ${fam.nameOf(personOf(last))}` : 'Shared';
  };
  const active = viewMeds.filter((m) => !m.archived);
  // Order is fixed per minute so cards don't reshuffle under the user's thumb every second.
  const scheduled = byUrgency(active.filter((m) => m.schedule.type !== 'prn'), doses, Math.floor(now / 60_000) * 60_000, s);
  const prn = active.filter((m) => m.schedule.type === 'prn');

  const firstRecord = [...doses, ...checkIns, ...body].filter((r) => !r.deletedAt).reduce<number | null>((min, r) => {
    const t = Date.parse(r.createdAt);
    return min === null || t < min ? t : min;
  }, null);
  const promptDose = fam.everyone ? undefined : checkInPromptDose(viewDoses, viewCheckIns, now, settings.checkInDelayMin, settings.dismissedCheckInDoseId);
  const refills = refillAlerts(viewMeds, doses, Math.floor(now / 60_000) * 60_000, s, settings.refillWarnDays, settings.dismissedLowStock);
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;

  const onLogged = (d: Dose) => {
    const med = medMap.get(d.medicationId);
    setLogFor(null);
    if (d.skipped) {
      toast(`Marked ${med ? shownName(med) : 'dose'} as skipped`, { onAction: () => removeDose(d.id) });
      return;
    }
    toast(`Logged ${fmtAmount(d.amount, med?.unit ?? '')} at ${fmtTime(Date.parse(d.takenAt))}`, {
      onAction: async () => { await removeDose(d.id); toast('Dose removed. Nothing was logged.'); },
    });
  };
  const hero = (m: Medication, className?: string) => {
    const next = getNextDue(m, doses, now, s);
    const showCal = next !== null && next > now && ['not-due', 'not-today', 'done-today'].includes(getStatus(m, doses, now, s));
    return (
      <div key={m.id} className={className}>
        <HeroCard med={m} doses={viewDoses} s={s} now={now} onLog={() => setLogFor(m)} person={whose(m)}
          footer={showCal ? (
            <button onClick={() => addToCalendar(m, next!, !fam.many ? undefined : m.shared ? (fam.everyone ? undefined : fam.person) : fam.nameOf(personOf(m)))} className="w-full min-h-[48px] mt-2 flex items-center justify-center gap-2 text-primary font-semibold">
              <CalendarPlus size={18} aria-hidden="true" /> Add {fmtWhen(next!, now)} to calendar
            </button>
          ) : null} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PersonSwitcher allowEveryone />
      <IOSBanner dismissed={settings.iosBannerDismissed} />
      <TravelBanner settings={settings} />

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
          <p className="mt-3">{fam.many && !fam.everyone ? `No medications for ${fam.person} yet.` : 'No medications yet.'} Add one to start logging doses.</p>
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
      <RefillCards alerts={refills} settings={settings} now={now} />

      {prn.length > 0 && (
        <section className="space-y-2" aria-label="As needed">
          <h2 className="text-sm font-semibold text-muted px-1">As needed</h2>
          {prn.map((m) => <PrnCard key={m.id} med={m} doses={viewDoses} s={s} now={now} onLog={() => setLogFor(m)} person={whose(m)} limits={!(fam.everyone && m.shared)} />)}
        </section>
      )}

      {fam.everyone ? (
        <p className="text-sm text-muted text-center px-4">Choose a person above to check in or log weight or blood pressure for them.</p>
      ) : (
      <div className="grid grid-cols-4 gap-2" aria-label={fam.many ? `Quick actions for ${fam.person}` : 'Quick actions'}>
        {([
          ['Check in', 'Check in', Smile, () => setCheckIn({})],
          ['Weight', 'Log weight', Scale, () => setBodySheet({ kind: 'weight' })],
          ['Measure', 'Add measurement', Ruler, () => setBodySheet({ kind: 'measure' })],
          ['BP and pulse', 'Log blood pressure and pulse', HeartPulse, () => setVitalSheet({})],
        ] as const).map(([label, name, Icon, on]) => (
          <button key={label} onClick={on} aria-label={name} className="bg-surface rounded-card shadow-card min-h-[80px] flex flex-col items-center justify-center gap-1.5 px-1 text-sm font-medium text-center leading-tight">
            <Icon className="text-primary" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      )}

      {needsBackup(settings.lastBackupAt, firstRecord, now, settings.backupReminderDays) && <BackupReminder days={settings.backupReminderDays} />}
      <AutoBackupPermission enabled={settings.autoBackupEnabled} />
      <InstallCard hasDoses={doses.some((d) => !d.deletedAt)} dismissed={settings.installCardDismissed} />

      <Timeline doses={viewDoses} checkIns={viewCheckIns} body={viewBody} vitals={viewVitals} onVital={(v) => setVitalSheet({ editing: v })} meds={viewMedMap} s={s} units={settings.units} now={now} personLabel={fam.everyone ? whose : undefined}
        onDose={setEditing} onCheckIn={(c: CheckIn) => setCheckIn({ editing: c })} onBody={(b: BodyEntry) => setBodySheet({ kind: 'edit', entry: b })} />

      <a href="#/backup" className="flex flex-wrap items-center justify-center gap-x-2 min-h-[48px] text-sm text-muted tnum">
        <span className="flex items-center gap-2"><Lock size={16} aria-hidden="true" /> Saved on this device</span>
        <span aria-hidden="true">·</span>
        <span>{last ? `Last backup ${fmtAgo(now - last)}` : 'No backup yet'}</span>
      </a>

      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title={logFor ? `Log ${shownMedName(logFor)}` : ''}>
        {logFor && <LogDoseFlow med={logFor} doses={doses} s={s} now={now} onLogged={onLogged} onCancel={() => setLogFor(null)}
          people={fam.people} defaultPersonId={fam.everyone ? null : fam.personId} />}
      </Sheet>
      <DoseEditSheet dose={editing} med={editing ? medMap.get(editing.medicationId) : undefined} onClose={() => setEditing(null)} />
      <CheckInSheet seed={checkIn} onClose={() => setCheckIn(null)} doses={viewDoses} checkIns={viewCheckIns} meds={viewMeds} chips={settings.chips} s={s}
        personId={checkIn?.editing ? personOf(checkIn.editing) : fam.personId} />
      <VitalsSheet state={vitalSheet} onClose={() => setVitalSheet(null)} personId={fam.personId} />
      <BodySheet state={bodySheet} onClose={() => setBodySheet(null)} units={settings.units} personId={bodySheet?.entry ? personOf(bodySheet.entry) : fam.personId} />
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
