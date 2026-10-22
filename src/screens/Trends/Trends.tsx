import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMedEvents, useMeds, useScheduleSettings, useVitals } from '../../app/data';
import { dosesForPerson, medIsFor, personOf } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { RANGE_DAYS, rangeStart, type Range } from '../../logic/stats';
import { Segmented } from '../../components/ui/Field';
import {
  AdherenceHeatmap, AppetiteWeight, VitalsCharts, DoseTimingCharts, FeelingsChart, IntervalCharts, MeasurementCharts, NoticedMost, WeightChart,
} from '../../components/charts/Charts';
import { GoalForecastCharts } from '../../components/charts/GoalCharts';
import { BlendCharts, DoseLevelsCards, EstimatedLevelCharts } from '../../components/charts/PeptideCharts';
import { shownName } from '../../logic/privacy';
import { HAS_BODY } from '../../edition';

export function Trends() {
  const allMeds = useMeds();
  const allDoses = useDoses();
  const allCheckIns = useCheckIns();
  const allBody = useBodyEntries();
  const allEvents = useMedEvents();
  const allVitals = useVitals();
  const fam = useFamily();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [range, setRange] = useState<Range>(() => {
    try { return (localStorage.getItem('trendsRange') as Range) || '30d'; } catch { return '30d'; }
  });
  const pick = (r: Range) => { setRange(r); try { localStorage.setItem('trendsRange', r); } catch { /* per-device preference only */ } };

  if (!allMeds || !allDoses || !allCheckIns || !allBody || !allEvents || !allVitals || !ss || !fam) {
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

  const [settings, s] = ss;
  const times = [...doses.map((d) => Date.parse(d.takenAt)), ...checkIns.map((c) => Date.parse(c.at)), ...body.map((b) => Date.parse(`${b.date}T00:00`))];
  const earliest = times.length ? Math.min(...times) : null;
  // Round to the hour so charts don't redraw every minute; the range still includes everything logged so far.
  const end = Math.ceil(now / 3_600_000) * 3_600_000;
  const start = rangeStart(range, end, earliest);
  const days = RANGE_DAYS[range];
  const prevStart = days === null ? null : start - days * 86_400_000;
  const active = meds.filter((m) => !m.archived || doses.some((d) => d.medicationId === m.id && Date.parse(d.takenAt) >= start));
  const common = { start, end, s };
  // Peptide tools: dose changes of injected medications marked on the weight chart.
  const peptideMeds = settings.peptideTools ? meds.filter((m) => m.peptide) : [];
  const weightMarks = events.filter((e) => e.kind === 'changed' && peptideMeds.some((m) => m.id === e.medicationId))
    .map((e) => ({ at: Date.parse(e.at), text: `${shownName(peptideMeds.find((m) => m.id === e.medicationId)!)}: ${e.summary}` }));

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-bg">
        <Segmented<Range> label="Date range" value={range} onChange={pick}
          options={[{ value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: '90d', label: '90D' }, { value: 'all', label: 'All' }]} />
      </div>
      {HAS_BODY && (
        <>
          <GoalForecastCharts goals={fam.people.find((p) => p.id === fam.personId)?.goals ?? []} entries={body} units={settings.units} now={now} />
          <WeightChart entries={body} units={settings.units} {...common} marks={weightMarks} />
          <MeasurementCharts entries={body} units={settings.units} {...common} />
        </>
      )}
      <AdherenceHeatmap meds={active} doses={doses} {...common} />
      <DoseTimingCharts meds={active} doses={doses} {...common} />
      <FeelingsChart checkIns={checkIns} events={events} meds={meds} prevStart={prevStart} {...common} />
      <AppetiteWeight checkIns={checkIns} entries={body} units={settings.units} weight={HAS_BODY} {...common} />
      <VitalsCharts vitals={vitals} {...common} />
      <NoticedMost checkIns={checkIns} {...common} />
      <IntervalCharts meds={active} doses={doses} {...common} />
      {peptideMeds.length > 0 && (
        <>
          <EstimatedLevelCharts meds={peptideMeds} doses={doses} {...common} />
          <BlendCharts meds={peptideMeds} doses={doses} {...common} />
          <DoseLevelsCards meds={peptideMeds} doses={doses} body={body} checkIns={checkIns} units={settings.units} now={now} />
        </>
      )}
      <a href="#/report" className="border-t border-border py-4 flex items-center gap-3 min-h-[56px]">
        <FileText className="text-primary" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-semibold">Report for your doctor</span>
          <span className="block text-sm text-muted">Print or save as PDF</span>
        </span>
      </a>
      <p className="text-sm text-muted text-center px-4">These charts show what you've recorded. They don't interpret it. Talk to your prescriber about what it means for you.</p>
    </div>
  );
}
