import { useEffect, useMemo, useState } from 'react';
import { clearLogRequest, onLogRequest } from '../../app/pendingLog';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { CalendarPlus, Lock, Nfc, Pill } from 'lucide-react';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useWorkouts, useFamily, useMeds, useScheduleSettings, useSupplies, useVitals } from '../../app/data';
import { VitalsSheet, type VitalsSheetState } from '../../components/VitalsSheet';
import { dosesForPerson, medIsFor, personOf, storedPerson } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go } from '../../app/router';
import { addToCalendar } from '../../app/calendar';
import { byUrgency, getLastDose, getNextDue, getStatus } from '../../logic/schedule';
import { checkInPromptDose, needsBackup, refillAlerts } from '../../logic/reminders';
import { RefillCards } from '../../components/Refill';
import { VialAlerts } from '../Meds/VialCard';
import { GoalLines } from '../Body/Goals';
import { SupplyAlerts } from '../Supplies';
import { supplyAlerts } from '../../logic/peptide';
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
import { TodayRow } from './TodayRow';
import { WeekStrip } from '../Protocol/WeekStrip';
import { WeeklySummaryBlock } from '../Protocol/Predictions';
import { EffectToday, MentionsLine, OddRecordsLine, ScriptToday } from '../../components/Smart';
import { appointmentsAround } from '../../logic/appointments';
import { ALCOHOL, CAFFEINE, PERIOD } from '../../logic/lifestyle';
import { addCheckIn, removeCheckIn } from '../../db/repos/checkIns';
import { useAppointments } from '../../app/data';
import { dayKey } from '../../logic/stats';
import { format } from 'date-fns';
import { weeklySummary } from '../../logic/predict';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';
import { AutoBackupPermission, BackupReminder, CheckInPrompt, InstallCard, UpdateCard } from './PromptCards';
import { HAS_BODY, HAS_PEPTIDES, HAS_VISITS } from '../../edition';
import { DigestCard, IntakeCard } from '../../components/Fitness';
import { weeklyDigest } from '../../logic/digest';
import { allExercises } from '../../logic/exercises';
import { setDigestNotify } from '../../app/native';
import { isNative } from '../../platform';
import { setSetting } from '../../db/repos/settings';
import { readiness } from '../../logic/training';

export function Today() {
  const meds = useMeds();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const vitals = useVitals();
  const supplies = useSupplies();
  const daily = useDaily();
  const workouts = useWorkouts();
  const own = useExercises();
  const appointments = useAppointments();
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
  // One tap: a check-in with just that chip, now (Undo removes it). Used in Trends' patterns.
  const quick = async (chip: string, what: string) => {
    const c = await addCheckIn({ at: new Date().toISOString(), chips: [chip], personId: storedPerson(fam.personId) });
    toast(`${what} logged`, { onAction: () => removeCheckIn(c.id) });
  };
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
  // The headline: whatever is due now; otherwise, with peptide tools on, the next injection; otherwise the most urgent.
  const dueNow = scheduled.find((m) => getStatus(m, doses, now, s) === 'due');
  const nextShot = settings.peptideTools ? scheduled.filter((m) => m.peptide && getNextDue(m, doses, now, s) !== null)
    .sort((a, b) => getNextDue(a, doses, now, s)! - getNextDue(b, doses, now, s)!)[0] : undefined;
  const headline = dueNow ?? nextShot ?? scheduled[0];

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

      {/* B2: the most urgent dose is the headline; every scheduled medicine is then one line, tap to log. */}
      {headline && hero(headline)}
      {headline?.peptide && settings.peptideTools && <WeekStrip med={headline} doses={viewDoses} s={s} now={now} />}
      {headline?.peptide && settings.peptideTools && !fam.everyone && (
        <section className="border-t border-border pt-4" aria-label={`${shownName(headline)}: last 7 days`}>
          <WeeklySummaryBlock w={weeklySummary(headline, viewDoses, viewCheckIns, HAS_BODY ? viewBody : [], now, s)} med={headline} units={settings.units} />
        </section>
      )}
      {scheduled.length > 1 && (
        <section aria-labelledby="today-meds" className="border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <h2 id="today-meds" className="text-sm font-medium text-muted">Today</h2>
            <p className="text-sm text-muted tnum">{scheduled.filter((m) => getStatus(m, doses, now, s) === 'done-today').length} of {scheduled.length} done</p>
          </div>
          <ul className="mt-1">
            {scheduled.map((m) => <TodayRow key={m.id} med={m} doses={viewDoses} s={s} now={now} person={whose(m)} onLog={() => setLogFor(m)} />)}
          </ul>
        </section>
      )}

      {!fam.everyone && (() => {
        const visit = HAS_VISITS && appointments ? appointmentsAround(appointments.filter(mine), dayKey(now, s)).next : undefined;
        const lines = [
          <EffectToday key="e" meds={viewMeds} doses={viewDoses} checkIns={viewCheckIns} now={now} />,
          <ScriptToday key="s" meds={viewMeds} doses={viewDoses} s={s} now={now} />,
          <MentionsLine key="m" vitals={viewVitals} daily={(daily ?? []).filter((d) => personOf(d) === fam.personId)} dismissed={settings.mentionsDismissed} now={now} />,
          <OddRecordsLine key="o" meds={viewMeds} doses={viewDoses} body={HAS_BODY ? viewBody : []} checkIns={viewCheckIns} vitals={viewVitals} dismissed={settings.oddDismissed} now={now} />,
        ];
        return (
          <section className="border-t border-border pt-4 space-y-2 empty:hidden" aria-label="Notes">
            {lines}
            {visit && Date.parse(`${visit.date}T00:00`) - now < 14 * 86_400_000 && (
              <a href="#/appointments" className="block text-[15px]">
                Appointment {format(new Date(`${visit.date}T12:00`), 'EEE d MMM')}{visit.with ? ` with ${visit.with}` : ''}. <span className="underline underline-offset-4 font-medium">Summary and questions</span>
              </a>
            )}
          </section>
        );
      })()}

      {promptDose && <CheckInPrompt dose={promptDose} med={medMap.get(promptDose.medicationId)} now={now} onCheckIn={() => setCheckIn({ relatedDoseId: promptDose.id })} />}
      <RefillCards alerts={refills} settings={settings} now={now} />
      {HAS_PEPTIDES && <VialAlerts meds={viewMeds} doses={doses} now={now} />}
      {settings.peptideTools && supplies && <SupplyAlerts alerts={supplyAlerts(supplies, meds, doses)} />}

      {prn.length > 0 && (
        <section className="border-t border-border pt-4" aria-label="As needed">
          <h2 className="text-sm font-medium text-muted">As needed</h2>
          {prn.map((m) => <PrnCard key={m.id} med={m} doses={viewDoses} s={s} now={now} onLog={() => setLogFor(m)} person={whose(m)} limits={!(fam.everyone && m.shared)} />)}
        </section>
      )}

      {fam.everyone ? (
        <p className="text-sm text-muted text-center px-4">Choose a person above to check in or log {HAS_BODY ? 'weight or ' : ''}blood pressure for them.</p>
      ) : (
      <div role="group" className="border-t border-border pt-2 flex flex-wrap gap-x-6" aria-label={fam.many ? `Log for ${fam.person}` : 'Log something else'}>
        {([
          ['Check in', 'Check in', () => setCheckIn({})],
          ['Blood pressure', 'Log blood pressure and pulse', () => setVitalSheet({})],
          ...(HAS_BODY ? [
            ['Weight', 'Log weight', () => setBodySheet({ kind: 'weight' })],
            ['Measure', 'Add measurement', () => setBodySheet({ kind: 'measure' })],
          ] as const : []),
          ['Coffee', 'Log caffeine now', () => quick(CAFFEINE, 'Caffeine')],
          ['Alcohol', 'Log alcohol now', () => quick(ALCOHOL, 'Alcohol')],
          ...(settings.cycleTracking ? [['Period', 'Period started today', () => quick(PERIOD, 'Period start')]] as const : []),
        ] as const).map(([label, name, on]) => (
          <button key={label} onClick={on} aria-label={name} className="min-h-[44px] text-[15px] font-medium underline underline-offset-4 decoration-border-strong">
            {label}
          </button>
        ))}
      </div>
      )}

      {!fam.everyone && daily && workouts && own && (() => {
        // Monday to Wednesday: last week against the week before.
        const wd = new Date(now).getDay();
        if (![1, 2, 3].includes(wd)) return null;
        const mine = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
        const dg = weeklyDigest({ meds: viewMeds, doses: viewDoses, checkIns: viewCheckIns, body: HAS_BODY ? viewBody : [], workouts: workouts.filter(mine), daily: daily.filter(mine), defs: allExercises(own) },
          now, s, { units: settings.units, body: HAS_BODY, training: HAS_BODY && settings.trainingTools });
        return dg ? <DigestCard d={dg} seen={settings.digestSeen} notify={settings.digestNotify} onClose={() => setSetting('digestSeen', dg.weekStart)}
          onNotify={isNative ? async () => { const on = await setDigestNotify(true); toast(on ? 'You’ll get your week each Monday at 8:30 am' : 'Notifications are off for this app. Turn them on in your phone’s settings.'); } : undefined} /> : null;
      })()}

      {HAS_BODY && settings.trainingTools && !fam.everyone && daily && (() => {
        const mineDaily = daily.filter((d) => !d.deletedAt && personOf(d) === fam.personId);
        const today = format(now, 'yyyy-MM-dd');
        return <IntakeCard personId={fam.personId} today={today} day={mineDaily.find((d) => d.date === today)} proteinTarget={settings.proteinTargetG} waterTarget={settings.waterTargetMl}
          ready={readiness(mineDaily, viewCheckIns, now, s)} />;
      })()}

      {HAS_BODY && !fam.everyone && <GoalLines goals={fam.people.find((p) => p.id === fam.personId)?.goals ?? []} entries={viewBody} units={settings.units} now={now} />}

      {needsBackup(settings.lastBackupAt, firstRecord, now, settings.backupReminderDays) && <BackupReminder days={settings.backupReminderDays} />}
      <AutoBackupPermission enabled={settings.autoBackupEnabled} />
      <UpdateCard dismissed={settings.updateDismissed} />
      <InstallCard hasDoses={doses.some((d) => !d.deletedAt)} dismissed={settings.installCardDismissed} />

      <Timeline doses={viewDoses} checkIns={viewCheckIns} body={HAS_BODY ? viewBody : []} vitals={viewVitals} onVital={(v) => setVitalSheet({ editing: v })} meds={viewMedMap} s={s} units={settings.units} now={now} personLabel={fam.everyone ? whose : undefined}
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
        soreness={HAS_BODY && settings.trainingTools} personId={checkIn?.editing ? personOf(checkIn.editing) : fam.personId} />
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
