import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { clearCheckInRequest, clearLogRequest, onCheckInRequest, onLogRequest } from '../../app/pendingLog';
import { shownMedName, shownName } from '../../logic/privacy';
import { CalendarDays, CalendarPlus, Coffee, HeartPulse, Lock, Nfc, Pill, Ruler, Scale, Smile, Wine } from 'lucide-react';
import { IconRow, MiniRing, Tile } from '../../components/ui/Visual';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useWorkouts, useFamily, useMedEvents, useMeds, useScheduleSettings, useSupplies, useTags, useVitals } from '../../app/data';
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
import { MentionsLine, OddRecordsLine, ScriptToday } from '../../components/Smart';
import { ChangeLine, StallLine, WearOffLines } from '../../components/Insights';
import { weightStall } from '../../logic/stall';
import { whatChanged } from '../../logic/changes';
import { appointmentsAround } from '../../logic/appointments';
import { ALCOHOL, CAFFEINE } from '../../logic/lifestyle';
import { addCheckIn, removeCheckIn } from '../../db/repos/checkIns';
import { useAppointments } from '../../app/data';
import { dayKey } from '../../logic/stats';
import { format } from 'date-fns';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';
import { planRecords, RestartCard, StepPrompt } from '../../components/DosePlan';
import { restartPrompt, stepStatus } from '../../logic/dosePlan';
import { AutoBackupPermission, BackupReminder, CheckInPrompt, InstallCard, UpdateCard } from './PromptCards';
import { HAS_BODY, HAS_PEPTIDES, HAS_VISITS } from '../../edition';
import { DigestCard, IntakeCard } from '../../components/Fitness';
import { weeklyDigest } from '../../logic/digest';
import { allExercises } from '../../logic/exercises';
import { setDigestNotify } from '../../app/native';
import { isNative } from '../../platform';
import { setSetting } from '../../db/repos/settings';
import { gettingStarted, showGettingStarted } from '../../logic/gettingStarted';
import { GettingStartedCard } from '../../components/GettingStarted';
import { readiness } from '../../logic/training';

const FoodToday = lazy(() => import('../Food').then((m) => ({ default: m.FoodToday })));

export function Today() {
  const meds = useMeds();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const tags = useTags();
  const body = useBodyEntries();
  const vitals = useVitals();
  const supplies = useSupplies();
  const daily = useDaily();
  const workouts = useWorkouts();
  const own = useExercises();
  const appointments = useAppointments();
  const events = useMedEvents();
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
  // The heavier detectors run once a minute (or when the records change), not on every clock tick.
  const minute = Math.floor(now / 60_000);
  const insights = useMemo(() => {
    if (!meds || !doses || !checkIns || !body || !fam || fam.everyone || !ss) return null;
    const t = minute * 60_000;
    const me = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
    const pm = meds.filter((m) => medIsFor(m, fam.personId));
    const ids = new Set(pm.map((m) => m.id));
    const pd = dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), pm, fam.personId);
    const pc = checkIns.filter(me), pb = body.filter(me), daily1 = (daily ?? []).filter(me);
    return {
      stall: HAS_BODY && workouts ? weightStall({ body: pb, checkIns: pc, daily: daily1, doses: pd, meds: pm, workouts: workouts.filter(me) }, t) : null,
      recent: whatChanged({ meds: pm, doses: pd, checkIns: pc, daily: daily1, events: (events ?? []).filter((e) => ids.has(e.medicationId)) }, t).filter((c) => t - c.at < 10 * 86_400_000)[0],
    };
  }, [minute, meds, doses, checkIns, body, daily, workouts, events, fam, ss]);
  // A tapped reminder notification opens Log dose for that medication.
  useEffect(() => onLogRequest((id) => {
    const m = medMap.get(id);
    if (m) { clearLogRequest(); setLogFor(m); }
  }), [medMap]);
  // The widget's Check in button.
  useEffect(() => onCheckInRequest(() => { clearCheckInRequest(); setCheckIn({}); }), []);

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

      {tags && (() => {
        const items = gettingStarted({ meds: viewMeds, tags, doses: viewDoses, checkIns: viewCheckIns, remindersEnabled: settings.remindersEnabled,
          lockEnabled: settings.lockEnabled, lastBackupAt: settings.lastBackupAt, native: isNative });
        if (!showGettingStarted(items, settings.gettingStartedDismissed)) return null;
        const first = viewMeds.find((m) => !m.archived);
        return <GettingStartedCard items={items} onHide={() => setSetting('gettingStartedDismissed', true)} onStep={(id) => {
          if (id === 'med') go('/meds/new');
          else if (id === 'tag') go(first ? `/meds/${first.id}` : '/meds/new');
          else if (id === 'dose') { if (first) setLogFor(first); else go('/meds/new'); }
          else if (id === 'checkin') setCheckIn({});
          else if (id === 'reminders') go('/settings/reminders');
          else if (id === 'lock') go('/settings/privacy');
          else go('/backup');
        }} />;
      })()}

      {/* B2: the most urgent dose is the headline; every scheduled medicine is then one line, tap to log. */}
      {headline && hero(headline)}
      {scheduled.length > 1 && (
        <section aria-labelledby="today-meds" className="border-t border-border pt-4">
          {(() => {
            const done = scheduled.filter((m) => getStatus(m, doses, now, s) === 'done-today').length;
            return (
              <div className="flex items-center justify-between">
                <h2 id="today-meds" className="text-sm font-medium text-muted">Today</h2>
                <MiniRing value={done} max={scheduled.length} tone={done === scheduled.length ? 'good' : 'primary'} label={`${done} of ${scheduled.length} done`} />
              </div>
            );
          })()}
          <ul className="mt-1">
            {scheduled.map((m) => <TodayRow key={m.id} med={m} doses={viewDoses} s={s} now={now} person={whose(m)} onLog={() => setLogFor(m)} />)}
          </ul>
        </section>
      )}

      {!fam.everyone && (() => {
        const visit = HAS_VISITS && appointments ? appointmentsAround(appointments.filter(mine), dayKey(now, s)).next : undefined;
        const mineDaily = (daily ?? []).filter((d) => personOf(d) === fam.personId);
        const { stall, recent } = insights ?? {};
        const lines = [
          <WearOffLines key="w" meds={viewMeds} doses={viewDoses} checkIns={viewCheckIns} daily={mineDaily} now={now} s={s} />,
          stall ? <StallLine key="st" stall={stall} /> : null,
          recent ? <ChangeLine key="ch" c={recent} /> : null,
          <ScriptToday key="s" meds={viewMeds} doses={viewDoses} s={s} now={now} />,
          <MentionsLine key="m" vitals={viewVitals} daily={(daily ?? []).filter((d) => personOf(d) === fam.personId)} dismissed={settings.mentionsDismissed} now={now} />,
          <OddRecordsLine key="o" meds={viewMeds} doses={viewDoses} body={HAS_BODY ? viewBody : []} checkIns={viewCheckIns} vitals={viewVitals} dismissed={settings.oddDismissed} now={now} />,
        ];
        return (
          <section className="border-t border-border pt-3 empty:hidden" aria-label="Notes">
            {lines}
            {visit && Date.parse(`${visit.date}T00:00`) - now < 14 * 86_400_000 && (
              <IconRow Icon={CalendarDays} tone="primary" href="#/appointments">
                Appointment {format(new Date(`${visit.date}T12:00`), 'EEE d MMM')}{visit.with ? ` · ${visit.with}` : ''}
              </IconRow>
            )}
          </section>
        );
      })()}

      {promptDose && <CheckInPrompt dose={promptDose} med={medMap.get(promptDose.medicationId)} now={now} onCheckIn={(mood) => setCheckIn({ relatedDoseId: promptDose.id, mood })} />}
      {active.map((m) => {
        // Dosing plans: a step that's due, or a reason to start another course.
        const r = planRecords(m, viewDoses, checkIns, body);
        const v = stepStatus(m, r.doses, r.checkIns, r.body, now, s);
        const p = restartPrompt(m, r.checkIns, now, s);
        return [v?.ready ? <StepPrompt key={`step-${m.id}`} med={m} v={v} /> : null, p ? <RestartCard key={`course-${m.id}`} med={m} prompt={p} /> : null];
      })}
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
        <p className="text-sm text-muted text-center px-4">Pick a person above to log for them.</p>
      ) : (
      <div role="group" className="border-t border-border pt-4 grid grid-cols-4 gap-2" aria-label={fam.many ? `Log for ${fam.person}` : 'Log something else'}>
        {([
          ['Check in', 'Check in', Smile, () => setCheckIn({})],
          ['BP', 'Log blood pressure and pulse', HeartPulse, () => setVitalSheet({})],
          ...(HAS_BODY ? [
            ['Weight', 'Log weight', Scale, () => setBodySheet({ kind: 'weight' })],
            ['Measure', 'Add measurement', Ruler, () => setBodySheet({ kind: 'measure' })],
          ] as const : []),
          ['Coffee', 'Log caffeine now', Coffee, () => quick(CAFFEINE, 'Caffeine')],
          ['Alcohol', 'Log alcohol now', Wine, () => quick(ALCOHOL, 'Alcohol')],
        ] as const).map(([label, name, Icon, on]) => <Tile key={label} Icon={Icon} label={label} name={name} onClick={on} />)}
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

      {HAS_BODY && settings.foodTracking && !fam.everyone && (
        <Suspense fallback={null}><FoodToday personId={fam.personId} energy={settings.energyUnit} target={settings.energyTargetKcal} now={now} /></Suspense>
      )}

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
