import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useLabs, useMedEvents, useMeds, useScheduleSettings, useVitals, useWorkouts } from '../../app/data';
import { MarkersCard } from '../../components/MarkersCard';
import { MuscleCard } from '../../components/Biohack';
import { BodyModelCards } from '../../components/BodyModel';
import { medIsFor, personOf } from '../../db/repos/people';
import { MuscleWatchCard } from '../../components/Fitness';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { fmtLength, fmtWeight, MEASUREMENTS } from '../../logic/units';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Field';
import { JumpBar } from '../../components/ui/JumpBar';
import { BodySheet, todayYmd, type BodySheetState } from '../../components/BodySheets';
import { MeasurementCharts, WeeklyChangeChart, WeightChart } from '../../components/charts/Charts';
import { GoalForecastCharts } from '../../components/charts/GoalCharts';
import { StallBlock } from '../../components/Insights';
import { ProgressPhotos } from './ProgressPhotos';
import { VitalsCard } from './VitalsCard';
import { goalLine, goalView, GoalsSection } from './Goals';
import { useNow } from '../../app/useNow';
import { HAS_BODY } from '../../edition';
import { fmtYmdDay } from '../../logic/format';
import { RANGE_DAYS, rangeStart, type Range } from '../../logic/stats';
import { weightPath } from '../../logic/predict';
import { weightStall } from '../../logic/stall';
import { shownName } from '../../logic/privacy';

const fmtYmd = (ymd: string) => (ymd === todayYmd() ? 'Today' : fmtYmdDay(ymd));

const RANGES: { value: Range; label: string }[] = [{ value: '7d', label: '7D' }, { value: '30d', label: '30D' }, { value: '90d', label: '90D' }, { value: 'all', label: 'All' }];

/** Body: each body measure once, with its chart, its goal and where to log it. Trends has no body charts. */
export function Body() {
  const ss = useScheduleSettings();
  const all = useBodyEntries();
  const fam = useFamily();
  const meds = useMeds();
  const doses = useDoses();
  const events = useMedEvents();
  const checkIns = useCheckIns();
  const daily = useDaily();
  const labs = useLabs(); const vitals = useVitals();
  const workouts = useWorkouts();
  const [sheet, setSheet] = useState<BodySheetState>(null);
  const now = useNow(60_000);
  const [range, setRange] = useState<Range>(() => { try { return (localStorage.getItem('bodyRange') as Range) || '90d'; } catch { return '90d'; } });
  const pick = (r: Range) => { setRange(r); try { localStorage.setItem('bodyRange', r); } catch { /* per-device preference only */ } };
  if (!ss || !all || !fam || !meds || !doses || !events || !checkIns || !daily || !workouts) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const entries = all.filter((b) => !b.deletedAt && personOf(b) === fam.personId).sort((a, b) => b.date.localeCompare(a.date));
  const end = Math.ceil(now / 3_600_000) * 3_600_000;
  const earliest = entries.length ? Date.parse(`${entries[entries.length - 1].date}T00:00`) : null;
  const start = rangeStart(range, end, earliest);
  const common = { start, end, s };
  const rangePicker = (
    <div className="sticky top-0 z-10 -mx-6 px-6 py-2 bg-bg">
      <Segmented<Range> label="Date range" value={range} onChange={pick} options={RANGES} />
      {HAS_BODY && <JumpBar inline deps={[range, fam.personId]} />}
    </div>
  );

  if (!HAS_BODY) return (
    <div className="space-y-4">
      <PersonSwitcher />
      {rangePicker}
      <VitalsCard personId={fam.personId} {...common} />
      {labs && vitals && <MarkersCard personId={fam.personId} heightCm={fam.people.find((p) => p.id === fam.personId)?.heightCm} labs={labs.filter((l) => personOf(l) === fam.personId)}
        vitals={vitals.filter((v) => personOf(v) === fam.personId)} body={HAS_BODY ? entries : []} daily={daily.filter((x) => personOf(x) === fam.personId)} units={settings.units} now={now} />}
    </div>
  );

  const units = settings.units;
  const goals = fam.people.find((p) => p.id === fam.personId)?.goals ?? [];
  const latestOf = (k: (typeof MEASUREMENTS)[number]['key']) => entries.find((e) => e[k] !== undefined);
  const measured = MEASUREMENTS.map((m) => ({ ...m, entry: latestOf(m.key) })).filter((m) => m.entry);
  const latestComp = entries.find((e) => e.bodyFatPct !== undefined || e.leanKg !== undefined || e.muscleKg !== undefined);
  const myMeds = meds.filter((m) => medIsFor(m, fam.personId));
  const peptideMeds = settings.peptideTools ? myMeds.filter((m) => m.peptide) : [];
  const peptide = peptideMeds.find((m) => !m.archived);
  const myDoses = doses.filter((d) => myMeds.some((m) => m.id === d.medicationId));
  // The weight chart: dose changes of injected medicines marked, the goal, and where it's heading (through the dose
  // plan when there is one, else towards the goal).
  const marks = events.filter((e) => e.kind === 'changed' && peptideMeds.some((m) => m.id === e.medicationId))
    .map((e) => ({ at: Date.parse(e.at), text: `${shownName(peptideMeds.find((m) => m.id === e.medicationId)!)}: ${e.summary}` }));
  const wGoal = goals.find((g) => g.metric === 'weightKg');
  const path = peptideMeds[0] ? weightPath(peptideMeds[0], myDoses, entries, now, 12, wGoal?.target) : null;
  const gv = wGoal ? goalView(wGoal, entries, now) : null;
  const last = path?.points[path.points.length - 1];
  const ahead = path ? path.points.filter((p) => p.t <= end + Math.min(end - start, 120 * 86_400_000)) : [];
  const forecast = path && last && ahead.length > 1
    ? { points: ahead, text: `About ${fmtWeight(last.v, units)} in ${path.points.length - 1} weeks through your plan` }
    : gv && gv.f.level !== undefined && gv.f.eta ? { points: [{ t: now, v: gv.f.level }, { t: gv.f.eta, v: wGoal!.target }], text: goalLine(gv, units) } : null;
  const stall = weightStall({ body: entries, checkIns: checkIns.filter((c) => personOf(c) === fam.personId), daily: daily.filter((d) => personOf(d) === fam.personId),
    doses: myDoses, meds: myMeds, workouts: workouts.filter((w) => personOf(w) === fam.personId) }, now);
  const charted = goals.filter((g) => g.metric !== 'weightKg').map((g) => g.metric as string);
  const days = RANGE_DAYS[range];

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      {rangePicker}
      <WeightChart entries={entries} units={units} {...common} marks={marks} goalKg={wGoal?.target} goalEta={gv?.f.eta} forecast={forecast}
        extra={stall ? <StallBlock stall={stall} /> : null}
        actions={<>
          <Button className="w-full min-h-[56px]" onClick={() => setSheet({ kind: 'weight' })}>Log weight</Button>
          <p className="text-xs text-muted mt-2">Weigh at the same time of day, ideally in the morning before eating, for the most useful trend.</p>
        </>} />
      <WeeklyChangeChart entries={entries} units={units} goalKg={wGoal?.target} now={now} />
      <BodyModelCards units={units} />

      <GoalsSection personId={fam.personId} goals={[...goals].sort((a, b) => Number(b.metric === 'weightKg') - Number(a.metric === 'weightKg'))} entries={entries} units={units} now={now}
        chartFor={(g) => g.metric === 'weightKg' ? null : <GoalForecastCharts goals={[g]} entries={entries} units={units} now={now} />} />

      <MeasurementCharts entries={entries} units={units} {...common} skip={charted}
        empty={measured.length ? `None in the last ${days ?? 'few'} days. Latest: ${measured.map((m) => `${m.label.toLowerCase()} ${fmtLength(m.entry![m.key]!, units)} (${fmtYmd(m.entry!.date)})`).join(', ')}.`
          : 'Log any of waist, hips, chest, neck, upper arm, thigh or calf, and body fat or lean mass if you have them. Only the ones you want.'}
        actions={<>
          {latestComp && (
            <p className="text-[15px] tnum mb-3">
              {[latestComp.bodyFatPct !== undefined ? `Body fat ${latestComp.bodyFatPct}%` : null, latestComp.leanKg !== undefined ? `lean ${fmtWeight(latestComp.leanKg, units)}` : null,
                latestComp.muscleKg !== undefined ? `muscle ${fmtWeight(latestComp.muscleKg, units)}` : null].filter(Boolean).join(' · ')}
              <span className="text-xs text-muted"> {fmtYmd(latestComp.date)}</span>
            </p>
          )}
          <Button variant="secondary" className="w-full" onClick={() => setSheet({ kind: 'measure' })}>Add measurements or body fat</Button>
        </>} />

      {entries.some((e) => e.bodyFatPct !== undefined || e.leanKg !== undefined) && <MuscleWatchCard body={entries} units={units} med={peptide} doses={doses} now={now} />}

      <VitalsCard personId={fam.personId} {...common} />
      {labs && vitals && <MarkersCard personId={fam.personId} heightCm={fam.people.find((p) => p.id === fam.personId)?.heightCm} labs={labs.filter((l) => personOf(l) === fam.personId)}
        vitals={vitals.filter((v) => personOf(v) === fam.personId)} body={HAS_BODY ? entries : []} daily={daily.filter((x) => personOf(x) === fam.personId)} units={settings.units} now={now} />}
      <MuscleCard />

      <ProgressPhotos personId={fam.personId} />

      {entries.length > 0 && (
        <Card>
          <details className="group">
            <summary className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium text-muted cursor-pointer list-none">Every entry ({entries.length}) <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <ul className="mt-1 -mx-2">
              {entries.slice(0, 120).map((e) => {
                const n = MEASUREMENTS.filter((m) => e[m.key] !== undefined).length + (e.bodyFatPct !== undefined || e.leanKg !== undefined || e.muscleKg !== undefined ? 1 : 0);
                return (
                  <li key={e.id}>
                    <button onClick={() => setSheet({ kind: 'edit', entry: e })} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                      <span className="flex-1">
                        <span className="block font-medium">{fmtYmd(e.date)}</span>
                        <span className="block text-sm text-muted tnum">
                          {[e.weightKg !== undefined ? fmtWeight(e.weightKg, units) : null, n ? `${n} measurement${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        </Card>
      )}

      <BodySheet state={sheet} onClose={() => setSheet(null)} units={units} personId={fam.personId} />
    </div>
  );
}
