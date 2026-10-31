import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { clearCheckInRequest, clearLogRequest, onCheckInRequest, onLogRequest } from '../../app/pendingLog';
import { shownMedName, shownName } from '../../logic/privacy';
import { CalendarPlus, Coffee, HeartPulse, Lock, Nfc, Pill, Ruler, Scale, Smile, Wine } from 'lucide-react';
import { Tile } from '../../components/ui/Visual';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useWorkouts, useFamily, useMeds, useScheduleSettings, useSupplies, useTags, useVitals } from '../../app/data';
import { VitalsSheet, type VitalsSheetState } from '../../components/VitalsSheet';
import { dosesForPerson, medIsFor, personOf, storedPerson } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go } from '../../app/router';
import { addToCalendar } from '../../app/calendar';
import { byUrgency, getLastDose, getNextDue, getStatus, isScheduledDay, nextUp } from '../../logic/schedule';
import { checkInDue, needsBackup, refillAlerts } from '../../logic/reminders';
import { RefillCards } from '../../components/Refill';
import { VialAlerts, vialAlerts } from '../Meds/VialCard';
import { GoalLines } from '../Body/Goals';
import { SupplyAlerts } from '../Supplies';
import { isPen, SUPPLY_LABELS, supplyAlerts } from '../../logic/peptide';
import { fmtAgo, fmtAmount, fmtTime, fmtWhen } from '../../logic/format';
import { logDose, removeDose } from '../../db/repos/doses';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { IOSBanner } from '../../components/IOSBanner';
import { TravelBanner } from '../../components/TravelBanner';
import { CheckInSheet, type CheckInSeed } from '../../components/CheckInSheet';
import { BodySheet, type BodySheetState } from '../../components/BodySheets';
import { HeroCard, HeroGroup } from './HeroCard';
import { currentVial } from '../../logic/peptide';
import { TodayRow } from './TodayRow';
import { ALCOHOL } from '../../logic/lifestyle';
import { intakesOf, isDrink, usualHabits, usualToAsk } from '../../logic/caffeine';
import { CaffeineCard, CaffeineSheet, SleepAsk, UsualCard } from '../../components/Caffeine';
import { DayStrip, MilestoneCard } from '../../components/Motivation';
import { milestones, streaks, todayRing } from '../../logic/motivation';
import { stepsTarget } from '../../logic/movement';
import { addCheckIn, removeCheckIn } from '../../db/repos/checkIns';
import { format } from 'date-fns';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';
import { planRecords, RestartCard, StepPrompt } from '../../components/DosePlan';
import { restartPrompt, stepStatus } from '../../logic/dosePlan';
import { TrainingHero, WeightHero } from './FocusHero';
import { AutoBackupPermission, BackupReminder, CheckInAutoOpen, CheckInPrompt, FocusQuick, InstallCard, NeedsAttention, UpdateCard } from './PromptCards';
import { focusAsk } from '../../logic/stimulant';
import { TopInsights } from '../../components/InsightList';
import { DailyBrief } from '../../components/Biohack';
import { HAS_MEDS, HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, HAS_PEPTIDES } from '../../edition';
import { IntakeCard } from '../../components/Fitness';
import { WeekTeaser } from '../../components/WeekReview';
import { allExercises } from '../../logic/exercises';
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
  const [vitalSheet, setVitalSheet] = useState<VitalsSheetState>(null);
  const ss = useScheduleSettings();
  const fam = useFamily();
  const now = useNow();
  const toast = useToast();
  const [logFor, setLogFor] = useState<Medication | null>(null);
  const [editing, setEditing] = useState<Dose | null>(null);
  const [checkIn, setCheckIn] = useState<CheckInSeed | null>(null);
  const [bodySheet, setBodySheet] = useState<BodySheetState>(null);
  const [drink, setDrink] = useState<{ editing?: CheckIn } | null>(null);

  const medMap = useMemo(() => new Map((meds ?? []).map((m) => [m.id, m])), [meds]);
  // Streaks, milestones and today's ring for the person shown, worked out again every ten minutes or when the
  // records change (not on every clock tick).
  const tenMin = Math.floor(now / 600_000);
  const motivation = useMemo(() => {
    if (!meds || !doses || !checkIns || !body || !fam || fam.everyone || !ss) return null;
    const [st, sc] = ss;
    const t = now;
    const me = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
    const pm = meds.filter((m) => medIsFor(m, fam.personId));
    const ids = new Set(pm.map((m) => m.id));
    const person = fam.people.find((p) => p.id === fam.personId);
    const training = HAS_TRAINING && st.trainingTools;
    const data = { meds: pm, doses: dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), pm, fam.personId), checkIns: checkIns.filter(me),
      workouts: (workouts ?? []).filter(me), daily: (daily ?? []).filter(me), body: HAS_BODY ? body.filter(me) : [], goals: person?.goals ?? [],
      perWeek: person?.fitnessGoals?.find((g) => g.kind === 'sessions')?.perWeek, defs: allExercises(own ?? []) };
    const run = streaks(data, t, sc, { training, checkIns: true });
    return { streaks: run, milestones: milestones(data, run, t, st.units, { training, body: HAS_BODY }),
      ring: todayRing(data, t, sc, { checkInTimes: st.checkInTimes, water: st.waterTargetMl, protein: st.proteinTargetG, intake: training, steps: st.stepsTargetOwn ?? stepsTarget(data.daily, t) }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenMin, meds, doses, checkIns, body, daily, workouts, own, fam, ss]);
  // A tapped reminder notification opens Log dose for that medication.
  useEffect(() => onLogRequest((id) => {
    const m = medMap.get(id);
    if (m) { clearLogRequest(); setLogFor(m); }
  }), [medMap]);
  // The widget's Check in button.
  useEffect(() => onCheckInRequest(() => { clearCheckInRequest(); setCheckIn({}); }), []);

  if (!meds || !doses || !checkIns || !body || !vitals || !ss || !fam) return <TodaySkeleton />;
  const [settings, s] = ss;
  const reached = motivation?.milestones.find((m) => m.kind === 'streak' && now - m.at < 3 * 86_400_000 && !settings.milestonesSeen.includes(m.id));
  const streakNews = reached ? { title: `New: ${reached.title}`, onDone: () => setSetting('milestonesSeen', [reached.id, ...settings.milestonesSeen].slice(0, 200)) } : undefined;
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
  // Caffeine for the person shown (in everyone's view the card and sheet aren't shown).
  const intakes = intakesOf(viewCheckIns);
  const cafPrefs = { limit: settings.caffeineLimitMg, bedtime: settings.bedtime, halfLifeH: settings.caffeineHalfLifeH, cutoff: settings.caffeineCutoff, checkFrom: settings.caffeineCheckFrom };
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
  // The headline: everything due now, otherwise every medicine due at the soonest upcoming time (tablets and
  // injections alike). With nothing planned ahead (all on a break), the most urgent one says so.
  const up = nextUp(active, doses, Math.floor(now / 60_000) * 60_000, s);
  const headline = up.meds.length === 1 ? up.meds[0] : up.meds.length === 0 ? scheduled[0] : undefined;
  const logAll = async (items: { med: Medication; amount: number }[]) => {
    const at = new Date().toISOString();
    const logged: Dose[] = [];
    for (const { med, amount } of items) {
      const v = med.peptide ? currentVial(med) : undefined;
      logged.push(await logDose({ medicationId: med.id, takenAt: at, amount, source: 'manual', vialId: v && v.id !== 'legacy' ? v.id : undefined }));
    }
    toast(`Logged ${items.map((x) => shownName(x.med)).join(', ')}`, { onAction: async () => { for (const d of logged) await removeDose(d.id); toast('Removed. Nothing was logged.'); } });
  };

  const firstRecord = [...doses, ...checkIns, ...body].filter((r) => !r.deletedAt).reduce<number | null>((min, r) => {
    const t = Date.parse(r.createdAt);
    return min === null || t < min ? t : min;
  }, null);
  // A check-in to ask for: after a dose or at one of the person's daily times.
  const ask = fam.everyone ? undefined : checkInDue(viewDoses, viewCheckIns, now, { delayMin: settings.checkInDelayMin, times: settings.checkInTimes, dismissed: settings.dismissedCheckInDoseId }, s);
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

      {HAS_MEDS && active.length === 0 && (
        <Card className="text-center py-8">
          <Pill className="mx-auto text-primary" size={32} aria-hidden="true" />
          <p className="mt-3">{fam.many && !fam.everyone ? `No medications for ${fam.person} yet.` : 'No medications yet.'} Add one to start logging doses.</p>
          <Button className="mt-4" onClick={() => go('/meds/new')}>Add medication</Button>
        </Card>
      )}

      {tags && (() => {
        const items = gettingStarted({ meds: viewMeds, tags, doses: viewDoses, checkIns: viewCheckIns, remindersEnabled: settings.remindersEnabled,
          lockEnabled: settings.lockEnabled, lastBackupAt: settings.lastBackupAt, native: isNative, focus: FOCUS,
          weighIns: viewBody.filter((b) => !b.deletedAt && b.weightKg !== undefined).length, hasGoal: !!fam.people.find((p) => p.id === fam.personId)?.goals?.length,
          workouts: (workouts ?? []).filter((w) => !w.deletedAt && personOf(w) === fam.personId).length });
        if (!showGettingStarted(items, settings.gettingStartedDismissed)) return null;
        const first = viewMeds.find((m) => !m.archived);
        return <GettingStartedCard items={items} onHide={() => setSetting('gettingStartedDismissed', true)} onStep={(id) => {
          if (id === 'med') go('/meds/new');
          else if (id === 'tag') go(!HAS_MEDS ? '/tags' : first ? `/meds/${first.id}` : '/meds/new');
          else if (id === 'weigh') setBodySheet({ kind: 'weight' });
          else if (id === 'goal') go('/body');
          else if (id === 'workout') go('/training/start');
          else if (id === 'dose') { if (first) setLogFor(first); else go('/meds/new'); }
          else if (id === 'checkin') setCheckIn({});
          else if (id === 'reminders') go('/settings/reminders');
          else if (id === 'lock') go('/settings/privacy');
          else go('/backup');
        }} />;
      })()}

      {/* B2: the most urgent dose is the headline; every scheduled medicine is then one line, tap to log. */}
      {FOCUS === 'weight' && !fam.everyone && <WeightHero entries={viewBody} tags={tags ?? []} units={settings.units} now={now} onLog={() => setBodySheet({ kind: 'weight' })} />}
      {FOCUS === 'training' && !fam.everyone && workouts && <TrainingHero workouts={workouts.filter((w) => personOf(w) === fam.personId)} tags={tags ?? []} now={now}
        ready={readiness((daily ?? []).filter((d) => !d.deletedAt && personOf(d) === fam.personId), viewCheckIns, now, s)} />}
      {up.meds.length > 1 && up.at !== null
        ? <HeroGroup meds={up.meds} doses={viewDoses} s={s} now={now} at={up.at} due={up.due} onLog={setLogFor} onLogAll={logAll} whose={fam.many ? whose : undefined} />
        : headline && hero(headline)}
      {scheduled.length > 1 && (
        <section aria-labelledby="today-meds" className="border-t border-border pt-4">
          {/* One ring for the day (doses due today, check-in, water, protein), with the streak, heading the list. */}
          <h2 id="today-meds" className="sr-only">Today</h2>
          {motivation && !fam.everyone && <DayStrip ring={motivation.ring} streaks={motivation.streaks} milestones={motivation.milestones} bare news={streakNews} />}
          <ul className="mt-1">
            {[...scheduled.filter((m) => isScheduledDay(m, now, s)), ...scheduled.filter((m) => !isScheduledDay(m, now, s))].map((m) => <TodayRow key={m.id} med={m} doses={viewDoses} s={s} now={now} person={whose(m)} onLog={() => setLogFor(m)} />)}
          </ul>
        </section>
      )}

      {!fam.everyone && (() => {
        if (!motivation) return null;
        // Streaks reached are said on the day ring's line; the rest (bests, workouts, goal steps) get a moment of their own.
        const unseen = motivation.milestones.filter((m) => m.kind !== 'streak' && now - m.at < 3 * 86_400_000 && !settings.milestonesSeen.includes(m.id));
        return <>
          {unseen.length > 0 && <MilestoneCard m={unseen[0]} more={unseen.length - 1}
            onDone={() => setSetting('milestonesSeen', [...unseen.map((m) => m.id), ...settings.milestonesSeen].slice(0, 200))} />}
          {scheduled.length <= 1 && <DayStrip ring={motivation.ring} streaks={motivation.streaks} milestones={motivation.milestones} news={streakNews} />}
        </>;
      })()}
      {!fam.everyone && settings.usualAsk && (
        <UsualCard asks={usualToAsk(usualHabits(intakes, now, s), intakes, now, settings.usualDismissed, s)} personId={storedPerson(fam.personId)} now={now} s={s}
          onNotToday={(k) => setSetting('usualDismissed', [k, ...settings.usualDismissed].slice(0, 60))} />
      )}

      {(() => {
        // A stimulant dose a while ago: one tap for focus (in place of the mood prompt for that same dose).
        const fa = fam.everyone ? null : focusAsk(active, viewDoses, checkIns, now);
        return <>
          {fa && <FocusQuick key={fa.dose.id} med={fa.med} dose={fa.dose} now={now} personId={storedPerson(fam.personId)} />}
          {ask && ask.dose?.id !== fa?.dose.id && <CheckInPrompt ask={ask} med={ask.dose && medMap.get(ask.dose.medicationId)} now={now} onCheckIn={(mood) => setCheckIn({ relatedDoseId: ask.dose?.id, mood })} />}
        </>;
      })()}
      <CheckInAutoOpen ask={ask} enabled={settings.checkInPopup} shown={settings.checkInPopupShown} busy={!!(checkIn || logFor || editing || bodySheet)}
        onOpen={(a) => setCheckIn({ relatedDoseId: a.dose?.id })} />
      {active.map((m) => {
        // Dosing plans: a step that's due, or a reason to start another course.
        const r = planRecords(m, viewDoses, checkIns, body);
        const v = stepStatus(m, r.doses, r.checkIns, r.body, now, s);
        const p = restartPrompt(m, r.checkIns, now, s);
        return [v?.ready ? <StepPrompt key={`step-${m.id}`} med={m} v={v} /> : null, p ? <RestartCard key={`course-${m.id}`} med={m} prompt={p} /> : null];
      })}
      {(() => {
        // Chores, gathered: one shows as it is, more fold into one line.
        const vials = HAS_PEPTIDES ? vialAlerts(viewMeds, doses, now) : [];
        const sup = settings.peptideTools && supplies ? supplyAlerts(supplies, meds, doses) : [];
        const items = [
          ...refills.map((r) => ({ key: `refill-${r.med.id}`, label: `${shownName(r.med)} ${r.runningOut || r.low ? 'running low' : r.scriptExpiring ? 'script' : 'bottle expiring'}`, node: <RefillCards alerts={[r]} settings={settings} now={now} /> })),
          ...vials.map(({ m, v }) => ({ key: `vial-${m.id}`, label: `${shownName(m)} ${isPen(m) ? 'pen' : 'vial'} ${v.expired ? 'past use-by' : v.dosesLeft === 0 ? 'empty' : 'nearly empty'}`, node: <VialAlerts meds={[m]} doses={doses} now={now} /> })),
          ...(sup.length ? [{ key: 'supplies', label: sup.length === 1 ? `${SUPPLY_LABELS[sup[0].supply.kind].name} low` : 'Supplies low', node: <SupplyAlerts alerts={sup} /> }] : []),
          ...(settings.pendingTags.length ? [{ key: 'tags', label: `${settings.pendingTags.length} tag${settings.pendingTags.length === 1 ? '' : 's'} to link`, node: (
            <Card className="flex items-center gap-3">
              <Nfc className="text-primary shrink-0" aria-hidden="true" />
              <p className="flex-1">{settings.pendingTags.length === 1 ? 'A new tag is' : `${settings.pendingTags.length} new tags are`} waiting to be linked.</p>
              <Button variant="secondary" onClick={() => go(`/tag/${settings.pendingTags[0]}`)}>Link</Button>
            </Card>
          ) }] : []),
          ...(needsBackup(settings.lastBackupAt, firstRecord, now, settings.backupReminderDays) ? [{ key: 'backup', label: 'Backup', node: <BackupReminder days={settings.backupReminderDays} /> }] : []),
        ];
        return <NeedsAttention items={items} />;
      })()}
      {!fam.everyone && <DailyBrief />}
      {!fam.everyone && <TopInsights />}

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
            // TapWeigh's headline card already has Log weight.
            ...(FOCUS === 'weight' ? [] : [['Weight', 'Log weight', Scale, () => setBodySheet({ kind: 'weight' })] as const]),
            ['Measure', 'Add measurement', Ruler, () => setBodySheet({ kind: 'measure' })],
          ] as const : []),
          ['Coffee', 'Log caffeine', Coffee, () => setDrink({})],
          ['Alcohol', 'Log alcohol now', Wine, () => quick(ALCOHOL, 'Alcohol')],
          // TapWeigh and TapLift are built around tags: one more tile for them.
          ...(HAS_MEDS ? [] : [['Tags', 'Your tags', Nfc, () => go('/tags')] as const]),
        ] as const).map(([label, name, Icon, on]) => <Tile key={label} Icon={Icon} label={label} name={name} onClick={on} />)}
      </div>
      )}

      {!fam.everyone && <WeekTeaser now={now} />}

      {HAS_FOOD && settings.foodTracking && !fam.everyone && (
        <Suspense fallback={null}><FoodToday personId={fam.personId} energy={settings.energyUnit} target={settings.energyTargetKcal} now={now} /></Suspense>
      )}

      {HAS_TRAINING && settings.trainingTools && !fam.everyone && daily && (() => {
        const mineDaily = daily.filter((d) => !d.deletedAt && personOf(d) === fam.personId);
        const today = format(now, 'yyyy-MM-dd');
        return <IntakeCard personId={fam.personId} today={today} day={mineDaily.find((d) => d.date === today)} proteinTarget={settings.proteinTargetG} waterTarget={settings.waterTargetMl}
          ready={null} amounts={settings.intakeAmounts} />;
      })()}

      {!fam.everyone && daily && <SleepAsk checkIns={viewCheckIns} daily={daily.filter(mine)} personId={storedPerson(fam.personId)} checkFrom={settings.caffeineCheckFrom} now={now} s={s} />}
      {!fam.everyone && <CaffeineCard intakes={intakes} prefs={cafPrefs} now={now} s={s} onLog={() => setDrink({})} />}

      {HAS_BODY && !fam.everyone && <GoalLines goals={fam.people.find((p) => p.id === fam.personId)?.goals ?? []} entries={viewBody} units={settings.units} now={now} />}

      <AutoBackupPermission enabled={settings.autoBackupEnabled} />
      <UpdateCard dismissed={settings.updateDismissed} />
      <InstallCard hasDoses={firstRecord !== null} dismissed={settings.installCardDismissed} />

      <Timeline doses={viewDoses} checkIns={viewCheckIns} body={HAS_BODY ? viewBody : []} vitals={viewVitals} onVital={(v) => setVitalSheet({ editing: v })} meds={viewMedMap} s={s} units={settings.units} now={now} personLabel={fam.everyone ? whose : undefined}
        onDose={setEditing} onCheckIn={(c: CheckIn) => (isDrink(c) ? setDrink({ editing: c }) : setCheckIn({ editing: c }))} onBody={(b: BodyEntry) => setBodySheet({ kind: 'edit', entry: b })} />

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
        soreness={HAS_TRAINING && settings.trainingTools} personId={checkIn?.editing ? personOf(checkIn.editing) : fam.personId} />
      <VitalsSheet state={vitalSheet} onClose={() => setVitalSheet(null)} personId={fam.personId} />
      <CaffeineSheet open={!!drink} editing={drink?.editing} onClose={() => setDrink(null)} intakes={intakes} prefs={cafPrefs} s={s} personId={storedPerson(fam.personId)} />
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
