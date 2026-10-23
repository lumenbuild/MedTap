import { useState } from 'react';
import { FileText, FlaskConical } from 'lucide-react';
import { useWorkouts, useAppointments, useDaily, useBodyEntries, useCheckIns, useDoses, useFamily, useMedEvents, useMeds, useScheduleSettings, useVitals } from '../../app/data';
import { CheckInForecastCard, EffectWindowCards, SleepImpactCard } from '../../components/Smart';
import { TrainingTrends } from '../../components/Fitness';
import { CycleCard, HeartAfterCards, OnOffCards, StepsWeightCard, SubstanceCard } from '../../components/Lifestyle';
import { checkInForecast, sleepImpact } from '../../logic/habits';
import { appointmentsAround } from '../../logic/appointments';
import { dayKey } from '../../logic/stats';
import { dosesForPerson, medIsFor, personOf } from '../../db/repos/people';
import { JumpBar } from '../../components/ui/JumpBar';
import { AskBox, ChangesCard, StallBlock } from '../../components/Insights';
import { whatChanged } from '../../logic/changes';
import { weightStall } from '../../logic/stall';
import { cycleForecast } from '../../logic/cycle';
import { Tile } from '../../components/ui/Visual';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { RANGE_DAYS, rangeStart, type Range } from '../../logic/stats';
import { Segmented } from '../../components/ui/Field';
import {
  AdherenceHeatmap, VitalsCharts, DoseTimingCharts, FeelingsChart, IntervalCharts, MeasurementCharts, NoticedMost, WeightChart,
} from '../../components/charts/Charts';
import { GoalForecastCharts } from '../../components/charts/GoalCharts';
import { BlendCharts, DoseLevelsCards } from '../../components/charts/PeptideCharts';
import { weightPath } from '../../logic/predict';
import { goalLine, goalView } from '../Body/Goals';
import { fmtWeight } from '../../logic/units';
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
  const [range, setRange] = useState<Range | 'appt'>(() => {
    try { return (localStorage.getItem('trendsRange') as Range | 'appt') || '30d'; } catch { return '30d'; }
  });
  const pick = (r: Range | 'appt') => { setRange(r); try { localStorage.setItem('trendsRange', r); } catch { /* per-device preference only */ } };

  if (!allMeds || !allDoses || !allCheckIns || !allBody || !allEvents || !allVitals || !allAppts || !allDaily || !allWorkouts || !ss || !fam) {
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
  // Peptide tools: dose changes of injected medications marked on the weight chart.
  const peptideMeds = settings.peptideTools ? meds.filter((m) => m.peptide) : [];
  const weightMarks = events.filter((e) => e.kind === 'changed' && peptideMeds.some((m) => m.id === e.medicationId))
    .map((e) => ({ at: Date.parse(e.at), text: `${shownName(peptideMeds.find((m) => m.id === e.medicationId)!)}: ${e.summary}` }))
    .concat(allAppts.filter((a) => HAS_VISITS && !a.deletedAt && personOf(a) === fam.personId).map((a) => ({ at: new Date(`${a.date}T12:00`).getTime(), text: `Appointment${a.with ? ` with ${a.with}` : ''}` })));
  const sleep = sleepImpact(meds.filter((m) => !m.peptide && !m.archived), doses, checkIns, now, s);
  const ciForecast = checkInForecast(meds, doses, checkIns, now, s);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <AskBox data={{ meds, doses, checkIns, body, daily, vitals, events }} now={now} />
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-bg">
        <Segmented<Range | 'appt'> label="Date range" value={r} onChange={pick}
          options={[{ value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: '90d', label: '90D' }, { value: 'all', label: 'All' },
            ...(lastAppt ? [{ value: 'appt' as const, label: 'Appt' }] : [])]} />
        <JumpBar inline deps={[r, fam.personId]} />
        {r === 'appt' && <p className="text-xs text-muted mt-1">Since your appointment on {new Date(`${lastAppt!.date}T12:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, compared with the {days} days before it.</p>}
      </div>
      <ChangesCard changes={whatChanged({ meds, doses, checkIns, daily, events }, now)} />
      {HAS_BODY && (
        <>
          {(() => {
            // One chart per measure: weight carries its goal and forecast; other goals get their own chart, which then
            // stands in for that measurement's small chart.
            const goals = fam.people.find((p) => p.id === fam.personId)?.goals ?? [];
            const wGoal = goals.find((g) => g.metric === 'weightKg');
            const path = peptideMeds[0] ? weightPath(peptideMeds[0], doses, body, now, 12, wGoal?.target) : null;
            const gv = wGoal ? goalView(wGoal, body, now) : null;
            const last = path?.points[path.points.length - 1];
            // Look as far ahead as the range looks back, so history keeps its room.
            const ahead = path ? path.points.filter((p) => p.t <= end + (end - start)) : [];
            const forecast = path && last && ahead.length > 1
              ? { points: ahead, text: `About ${fmtWeight(last.v, settings.units)} in ${path.points.length - 1} weeks through your plan` }
              : gv && gv.f.level !== undefined && gv.f.eta ? { points: [{ t: now, v: gv.f.level }, { t: gv.f.eta, v: wGoal!.target }], text: goalLine(gv, settings.units) } : null;
            const others = goals.filter((g) => g.metric !== 'weightKg');
            const stall = weightStall({ body, checkIns, daily, doses, meds, workouts: allWorkouts.filter((w) => personOf(w) === fam.personId) }, now);
            return (
              <>
                <WeightChart entries={body} units={settings.units} {...common} marks={weightMarks} goalKg={wGoal?.target} forecast={forecast}
                  extra={stall ? <StallBlock stall={stall} /> : null} />
                <GoalForecastCharts goals={others} entries={body} units={settings.units} now={now} />
                <MeasurementCharts entries={body} units={settings.units} {...common} skip={others.map((g) => g.metric)} />
              </>
            );
          })()}
        </>
      )}
      {ciForecast && <CheckInForecastCard f={ciForecast} />}
      <AdherenceHeatmap meds={active} doses={doses} {...common} />
      <DoseTimingCharts meds={active} doses={doses} {...common} />
      <FeelingsChart checkIns={checkIns} events={events} meds={meds} prevStart={prevStart} {...common} />
      <VitalsCharts vitals={vitals} {...common} />
      <NoticedMost checkIns={checkIns} {...common} />
      <EffectWindowCards meds={active} doses={doses} checkIns={checkIns} now={now} />
      {sleep && <SleepImpactCard r={sleep} />}
      <OnOffCards meds={active} doses={doses} checkIns={checkIns} now={now} s={s} />
      <SubstanceCard checkIns={checkIns} now={now} s={s} />
      {settings.cycleTracking && <CycleCard checkIns={checkIns} now={now} forecast={cycleForecast(checkIns, HAS_BODY ? body : [], meds, doses, now)} />}
      <HeartAfterCards meds={active} doses={doses} daily={daily} vitals={vitals} now={now} s={s} />
      {HAS_BODY && <StepsWeightCard daily={daily} body={body} units={settings.units} now={now} />}
      {HAS_BODY && settings.trainingTools && <TrainingTrends daily={daily} body={body} checkIns={checkIns} workouts={allWorkouts.filter((w) => personOf(w) === fam.personId)} start={start} end={end} s={s} targets={{ protein: settings.proteinTargetG, water: settings.waterTargetMl }} />}
      <IntervalCharts meds={active} doses={doses} {...common} />
      {peptideMeds.length > 0 && (
        <>
          <BlendCharts meds={peptideMeds} doses={doses} {...common} />
          <DoseLevelsCards meds={peptideMeds} doses={doses} body={body} checkIns={checkIns} units={settings.units} now={now} />
        </>
      )}
      <div className="border-t border-border pt-4 grid grid-cols-2 gap-2" role="group" aria-label="More">
        <Tile Icon={FileText} label="Doctor report" href="#/report" />
        <Tile Icon={FlaskConical} label={HAS_VISITS ? 'Appointments' : 'Lab results'} href={HAS_VISITS ? '#/appointments' : '#/labs'} />
      </div>
    </div>
  );
}
