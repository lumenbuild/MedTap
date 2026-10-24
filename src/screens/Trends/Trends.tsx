import { useState } from 'react';
import { FileText, FlaskConical } from 'lucide-react';
import { useWorkouts, useAppointments, useDaily, useBodyEntries, useCheckIns, useDoses, useFamily, useMedEvents, useMeds, useScheduleSettings, useVitals } from '../../app/data';
import { CheckInForecastBlock, EffectWindowCards } from '../../components/Smart';
import { HeartAfterCards, LinksSection, OnOffCards } from '../../components/Lifestyle';
import { DailyHabitsCard, NoticedBlock } from '../../components/TrendSections';
import { dailyHabits } from '../../logic/dailyHabits';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { MedBadge } from '../../components/MedBadge';
import { shownColour } from '../../logic/privacy';
import { checkInForecast, sleepImpact } from '../../logic/habits';
import { appointmentsAround } from '../../logic/appointments';
import { dayKey } from '../../logic/stats';
import { dosesForPerson, medIsFor, personOf } from '../../db/repos/people';
import { JumpBar } from '../../components/ui/JumpBar';
import { AskBox, ChangesCard } from '../../components/Insights';
import { whatChanged, dailySignals } from '../../logic/changes';
import { Tile } from '../../components/ui/Visual';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { RANGE_DAYS, rangeStart, type Range } from '../../logic/stats';
import { ChipPicker, Segmented } from '../../components/ui/Field';
import { AdherenceHeatmap, DoseTimingCharts, FeelingsChart, IntervalCharts } from '../../components/charts/Charts';
import { BlendCharts, DoseLevelsCards } from '../../components/charts/PeptideCharts';
import { shownName } from '../../logic/privacy';
import { HAS_BODY, HAS_VISITS } from '../../edition';

export function Trends() {
  const allMeds = useMeds();
  const allDoses = useDoses();
  const allCheckIns = useCheckIns();
  const allBody = useBodyEntries();
  const allEvents = useMedEvents();
  const allVitals = useVitals();
  const allAppts = useAppointments();
  const allDaily = useDaily();
  const allWorkouts = useWorkouts();
  const fam = useFamily();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const allFood = useLive(() => db.foodLogs.toArray(), []);
  const [medPick, setMedPick] = useState<string | null>(() => { try { return localStorage.getItem('trendsMed'); } catch { return null; } });
  const pickMed = (id: string) => { setMedPick(id); try { localStorage.setItem('trendsMed', id); } catch { /* per-device preference only */ } };
  const [range, setRange] = useState<Range | 'appt'>(() => {
    try { return (localStorage.getItem('trendsRange') as Range | 'appt') || '30d'; } catch { return '30d'; }
  });
  const pick = (r: Range | 'appt') => { setRange(r); try { localStorage.setItem('trendsRange', r); } catch { /* per-device preference only */ } };

  if (!allMeds || !allDoses || !allCheckIns || !allBody || !allEvents || !allVitals || !allAppts || !allDaily || !allWorkouts || !allFood || !ss || !fam) {
    return <div className="space-y-4" aria-busy="true" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-60 rounded-card bg-surface-2 animate-pulse" />)}</div>;
  }
  // Only the chosen family member's records.
  // Their medications plus shared ones, counting only their own doses of shared medications.
  const meds = allMeds.filter((m) => medIsFor(m, fam.personId));
  const medIds = new Set(meds.map((m) => m.id));
  const doses = dosesForPerson(allDoses.filter((d) => medIds.has(d.medicationId)), meds, fam.personId);
  const checkIns = allCheckIns.filter((c) => personOf(c) === fam.personId);
  const body = allBody.filter((b) => personOf(b) === fam.personId);
  const events = allEvents.filter((e) => medIds.has(e.medicationId));
  const vitals = allVitals.filter((v) => personOf(v) === fam.personId);
  const daily = allDaily.filter((d) => personOf(d) === fam.personId);

  const [settings, s] = ss;
  const times = [...doses.map((d) => Date.parse(d.takenAt)), ...checkIns.map((c) => Date.parse(c.at)), ...body.map((b) => Date.parse(`${b.date}T00:00`))];
  const earliest = times.length ? Math.min(...times) : null;
  // Round to the hour so charts don't redraw every minute; the range still includes everything logged so far.
  const end = Math.ceil(now / 3_600_000) * 3_600_000;
  // Since the last appointment: from its date, compared with the same length of time before it.
  const lastAppt = HAS_VISITS ? appointmentsAround(allAppts.filter((a) => personOf(a) === fam.personId), dayKey(now, s)).last : undefined;
  const r = range === 'appt' && !lastAppt ? '30d' : range;
  const start = r === 'appt' ? new Date(`${lastAppt!.date}T00:00`).getTime() : rangeStart(r, end, earliest);
  const days = r === 'appt' ? Math.max(1, Math.round((end - start) / 86_400_000)) : RANGE_DAYS[r];
  const prevStart = days === null ? null : start - days * 86_400_000;
  const active = meds.filter((m) => !m.archived || doses.some((d) => d.medicationId === m.id && Date.parse(d.takenAt) >= start));
  const common = { start, end, s };
  // Medicines: one at a time, so each chart below is about one medicine (the busiest in the range unless picked).
  const used = (m: (typeof meds)[number]) => doses.filter((d) => d.medicationId === m.id && Date.parse(d.takenAt) >= start).length;
  const byUse = [...active].sort((a, b) => used(b) - used(a));
  const med = byUse.find((m) => m.id === medPick) ?? byUse[0];
  const one = med ? [med] : [];
  const peptide = settings.peptideTools && med?.peptide ? one : [];
  const workouts = allWorkouts.filter((w) => personOf(w) === fam.personId);
  const training = HAS_BODY && settings.trainingTools;
  const habits = dailyHabits({ daily, foodLogs: allFood.filter((l) => personOf(l) === fam.personId), checkIns }, start, end, prevStart, s, {
    food: HAS_BODY && settings.foodTracking, intake: training, readiness: training,
    targets: { energy: settings.energyTargetKcal, protein: settings.proteinTargetG, water: settings.waterTargetMl },
  });
  const sleep = sleepImpact(meds.filter((m) => !m.peptide && !m.archived), doses, checkIns, now, s);
  const ciForecast = checkInForecast(meds, doses, checkIns, now, s);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <AskBox data={{ meds, doses, checkIns, body, daily, vitals, events }} now={now} />
      <div className="sticky top-0 z-10 -mx-6 px-6 py-2 bg-bg">
        <Segmented<Range | 'appt'> label="Date range" value={r} onChange={pick}
          options={[{ value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: '90d', label: '90D' }, { value: 'all', label: 'All' },
            ...(lastAppt ? [{ value: 'appt' as const, label: 'Appt' }] : [])]} />
        <JumpBar inline deps={[r, fam.personId, med?.id]} />
        {r === 'appt' && <p className="text-xs text-muted mt-1">Since your appointment on {new Date(`${lastAppt!.date}T12:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, compared with the {days} days before it.</p>}
      </div>
      <ChangesCard changes={whatChanged({ meds, doses, checkIns, daily, events }, now)} series={dailySignals({ meds, doses, checkIns, daily, events }, now)} />
      <FeelingsChart checkIns={checkIns} events={events} meds={meds} prevStart={prevStart} {...common}
        extra={<><NoticedBlock checkIns={checkIns} start={start} end={end} />{ciForecast && <CheckInForecastBlock f={ciForecast} />}</>} />
      {med && (
        <>
          <section className="border-t border-border pt-5" aria-labelledby="med-h">
            <h2 id="med-h" className="text-sm font-medium text-muted">Medicines</h2>
            {byUse.length > 1
              ? <div className="mt-2"><ChipPicker label="Medicine" value={med.id} onChange={pickMed} options={byUse.map((m) => ({ value: m.id, label: shownName(m) }))} /></div>
              : <p className="mt-2 flex items-center gap-2 font-medium"><MedBadge color={shownColour(med)} icon={med.icon} size={24} />{shownName(med)}</p>}
            <p className="text-sm text-muted mt-1">Everything below is about {shownName(med)}.</p>
          </section>
          <AdherenceHeatmap meds={one} doses={doses} oneMed {...common} />
          <DoseTimingCharts meds={one} doses={doses} oneMed {...common} />
          <IntervalCharts meds={one} doses={doses} oneMed {...common} />
          <EffectWindowCards meds={one} doses={doses} checkIns={checkIns} now={now} />
          <OnOffCards meds={one} doses={doses} checkIns={checkIns} now={now} s={s} />
          <HeartAfterCards meds={one} doses={doses} daily={daily} vitals={vitals} now={now} s={s} />
          {peptide.length > 0 && (
            <>
              <DoseLevelsCards meds={peptide} doses={doses} body={body} checkIns={checkIns} units={settings.units} now={now} />
              <BlendCharts meds={peptide} doses={doses} {...common} />
            </>
          )}
        </>
      )}
      <DailyHabitsCard habits={habits} foodLogs={allFood.filter((l) => personOf(l) === fam.personId)} energy={settings.energyUnit} start={start} end={end} prevDays={prevStart === null ? null : days} />
      <LinksSection checkIns={checkIns} daily={daily} body={body} workouts={workouts} sleep={sleep} units={settings.units} now={now} s={s} showBody={HAS_BODY} training={training} />
      <div className="border-t border-border pt-4 grid grid-cols-2 gap-2" role="group" aria-label="More">
        <Tile Icon={FileText} label="Doctor report" href="#/report" />
        <Tile Icon={FlaskConical} label={HAS_VISITS ? 'Appointments' : 'Lab results'} href={HAS_VISITS ? '#/appointments' : '#/labs'} />
      </div>
    </div>
  );
}
