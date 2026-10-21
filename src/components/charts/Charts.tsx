import { Bar, Line, Scatter } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, MedEvent, Medication, Vital } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import type { ScheduleSettings } from '../../logic/schedule';
import { getDailyTarget } from '../../logic/schedule';
import {
  adherenceByDay, average, averageSummary, bodySeries, changeSummary, chipCounts, dailyAverages, daysBetween, doseIntervals, doseTimes, histogram,
  median, rollingAverage, ymdToMs, type Pt,
} from '../../logic/stats';
import { cmTo, fmtLength, fmtWeight, kgTo, lengthUnit, MEASUREMENTS, weightUnit } from '../../logic/units';
import { fmtDuration, fmtHHmm, fmtMedName } from '../../logic/format';
import { medColour, resolveColour } from '../../logic/palette';
import { MedBadge } from '../MedBadge';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { ChartCard } from './ChartCard';
import { baseOptions, timeAxis, useChartTheme, type ChartTheme } from './setup';

const DAY = 86_400_000;
/** `realNames` shows real medication names instead of nicknames (the doctor report can choose). */
export interface RangeProps { start: number; end: number; s: ScheduleSettings; realNames?: boolean }
const nameFor = (realNames?: boolean) => (m: Medication) => (realNames ? m.name : shownName(m));
const fmtDay = (t: number) => format(t, 'EEE d MMM');
const hourLabel = (h: number) => fmtHHmm(`${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
const point = (th: ChartTheme, color: string) => ({ pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: color, pointBorderColor: th.surface, pointBorderWidth: 2, pointHitRadius: 12 });

// 1. Weight: daily weigh-ins plus a 7-day rolling average.
export function WeightChart({ entries, start, end, units, marks = [] }: RangeProps & { entries: BodyEntry[]; units: Units;
  /** Dose changes to mark on the chart (peptide tools: titration steps). */
  marks?: { at: number; text: string }[] }) {
  const shown = marks.filter((m) => m.at >= start && m.at <= end).sort((a, b) => a.at - b.at);
  const th = useChartTheme();
  const all = bodySeries(entries, 'weightKg', -Infinity, Infinity);
  const inRange = (p: Pt) => p.t >= start - DAY / 2 && p.t <= end + DAY / 2;
  const pts = all.filter(inRange);
  const avg = rollingAverage(all).filter(inRange);
  const u = weightUnit(units);
  return (
    <ChartCard title="Weight" key={th.key}
      empty={pts.length ? null : 'No weigh-ins in this range. Log your weight from Body or Today.'}
      summary={changeSummary(avg, (v) => fmtWeight(v, units)) ?? (pts.length === 1 ? `One weigh-in: ${fmtWeight(pts[0].v, units)}` : null)}
      table={{ head: ['Date', `Weight (${u})`, `7-day average (${u})`], rows: pts.map((p, i) => [fmtDay(p.t), kgTo(p.v, units), kgTo(avg[i].v, units)]).reverse() }}
      footer={shown.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm">
          {shown.map((m, i) => <li key={i} className="flex gap-2"><span className="font-semibold tnum w-4">{i + 1}</span><span className="text-muted tnum">{format(m.at, 'd MMM')}</span><span>{m.text}</span></li>)}
        </ol>
      )}>
      <Line
        data={{ datasets: [
          { label: '7-day average', data: avg.map((p) => ({ x: p.t, y: kgTo(p.v, units) })), borderColor: th.series[0], backgroundColor: th.series[0], pointStyle: 'line', borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.3 },
          { label: 'Weigh-ins', data: pts.map((p) => ({ x: p.t, y: kgTo(p.v, units) })), showLine: false, ...point(th, th.muted) },
        ] }}
        options={{ ...baseOptions(th),
          plugins: { ...baseOptions(th).plugins, legend: { ...baseOptions(th).plugins.legend, display: true, position: 'top', align: 'start' },
            tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y as number).toFixed(1)} ${u}` } },
            // @ts-expect-error custom plugin options
            vlines: { lines: shown.map((m, i) => ({ x: m.at, label: String(i + 1) })), color: th.muted, text: th.text } },
          scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, grace: '5%', ticks: { ...baseOptions(th).scales.y.ticks, callback: (v) => `${v} ${u}` } } } }}
      />
    </ChartCard>
  );
}

// 2. Measurements: one small chart per measurement logged.
export function MeasurementCharts({ entries, start, end, units }: RangeProps & { entries: BodyEntry[]; units: Units }) {
  const th = useChartTheme();
  const series = MEASUREMENTS.map((m) => ({ ...m, pts: bodySeries(entries, m.key, start, end) })).filter((m) => m.pts.length);
  const u = lengthUnit(units);
  return (
    <ChartCard title="Measurements" height={null} key={th.key}
      empty={series.length ? null : 'No measurements in this range.'}
      table={{ head: ['Date', 'Measurement', `Value (${u})`], rows: series.flatMap((m) => m.pts.map((p) => [fmtDay(p.t), m.label, cmTo(p.v, units)])) }}>
      <div className="grid grid-cols-2 gap-4">
        {series.map((m) => {
          const first = m.pts[0], last = m.pts[m.pts.length - 1];
          const diff = cmTo(last.v, units) - cmTo(first.v, units);
          return (
            <div key={m.key}>
              <p className="text-sm font-semibold">{m.label}</p>
              <p className="text-xs text-muted tnum">{fmtLength(last.v, units)}{m.pts.length > 1 && Math.abs(diff) >= 0.1 ? ` · ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}` : ''}</p>
              <div style={{ height: 90 }} className="mt-1">
                <Line data={{ datasets: [{ data: m.pts.map((p) => ({ x: p.t, y: cmTo(p.v, units) })), borderColor: th.series[0], borderWidth: 2, tension: 0.3, ...point(th, th.series[0]), pointRadius: m.pts.length > 12 ? 0 : 4 }] }}
                  options={{ ...baseOptions(th), plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} ${u}` } } },
                    scales: { x: { ...timeAxis(th, start, end), display: false }, y: { ...baseOptions(th).scales.y, grace: '10%', ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 3 } } } }} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// 3. Adherence heatmap: a calendar grid of doses per day vs the user's own daily target.
export function AdherenceHeatmap({ meds, doses, start, end, s, realNames }: RangeProps & { meds: Medication[]; doses: Dose[] }) {
  const nameOf = nameFor(realNames);
  const capStart = Math.max(start, end - 182 * DAY); // at most 26 weeks so cells stay tappable
  const days = daysBetween(capStart, end, s);
  const rows = meds.map((m) => ({ med: m, cells: adherenceByDay(doses, m, days, s) })).filter((r) => r.cells.some((c) => c.count));
  const lead = (new Date(`${days[0]}T12:00`).getDay() + 6) % 7; // Monday-first offset
  return (
    <ChartCard title="Doses per day" height={null}
      empty={rows.length ? null : 'No doses in this range.'}
      summary={start < capStart ? 'Showing the last 26 weeks.' : null}
      table={{ head: ['Date', ...rows.map((r) => nameOf(r.med))], rows: days.map((d, i) => [fmtDay(ymdToMs(d)), ...rows.map((r) => r.cells[i].target === 0 && !r.cells[i].count ? 'Not scheduled' : r.cells[i].target ? `${r.cells[i].count} of ${r.cells[i].target}` : r.cells[i].count)]).reverse() }}>
      <div className="space-y-5">
        {rows.map(({ med, cells }) => {
          const target = getDailyTarget(med);
          const max = Math.max(1, ...cells.map((c) => c.count));
          const scheduled = cells.filter((c) => c.target !== 0);
          const full = target ? scheduled.filter((c) => c.count >= (c.target ?? 0)).length : null;
          return (
            <div key={med.id}>
              <div className="flex items-center gap-2 mb-2">
                <MedBadge color={realNames ? med.color : shownColour(med)} icon={med.icon} size={24} />
                <span className="font-medium">{nameOf(med)}</span>
              </div>
              {full !== null && <p className="text-sm text-muted mb-2 tnum">All logged on {full} of {scheduled.length} scheduled day{scheduled.length === 1 ? '' : 's'}</p>}
              <div className="grid gap-[3px] w-max max-w-full overflow-x-auto" style={{ gridTemplateRows: 'repeat(7, 18px)', gridAutoFlow: 'column', gridAutoColumns: '18px' }} role="img"
                aria-label={`${nameOf(med)}: ${full !== null ? `all doses logged on ${full} of ${scheduled.length} scheduled days` : `doses on ${cells.filter((c) => c.count).length} of ${cells.length} days`}`}>
                {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} />)}
                {cells.map((c) => {
                  const t = c.target;
                  const off = t === 0 && c.count === 0; // not a scheduled day
                  const level = c.count === 0 ? 0 : t ? (c.count >= t ? 1 : 0.45) : 0.35 + 0.65 * (c.count / max);
                  const over = !!t && c.count > t;
                  return (
                    <span key={c.day} title={`${fmtDay(ymdToMs(c.day))}: ${off ? 'not scheduled' : `${c.count}${t ? ` of ${t}` : ''}`}`}
                      className={`rounded-[4px] relative ${off ? 'border border-dashed border-border' : ''}`}
                      style={{ background: off ? 'transparent' : level ? medColour(med.color) : 'var(--surface-2)', opacity: level ? level : 1 }}>
                      {over && <span className="absolute inset-[5px] rounded-full" style={{ background: 'var(--surface)' }} />}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-[3px] border border-dashed border-border" /> Not scheduled</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-[3px]" style={{ background: 'var(--surface-2)' }} /> None</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-[3px] bg-text opacity-45" /> Some</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-[3px] bg-text" /> Your daily number</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-[3px] bg-text relative"><span className="absolute inset-[4px] rounded-full bg-surface" /></span> More</span>
        </div>
      </div>
    </ChartCard>
  );
}

// 4. Dose timing: time of day each dose was taken, one small chart per medication.
export function DoseTimingCharts({ meds, doses, start, end, s, realNames }: RangeProps & { meds: Medication[]; doses: Dose[] }) {
  const nameOf = nameFor(realNames);
  const th = useChartTheme();
  const series = meds.map((m) => ({ med: m, pts: doseTimes(doses, m.id, start, end, s) })).filter((x) => x.pts.length);
  return (
    <ChartCard title="Dose timing" height={null} key={th.key}
      empty={series.length ? null : 'No doses in this range.'}
      summary={series.length ? 'When each dose was taken. A tight band means a steady routine.' : null}
      table={{ head: ['Date', 'Medication', 'Time'], rows: series.flatMap((x) => x.pts.map((p) => [fmtDay(p.t), nameOf(x.med), hourLabel(p.hour)])) }}>
      <div className="space-y-5">
        {series.map(({ med, pts }) => {
          const firsts = new Map<number, number>();
          for (const p of pts) firsts.set(p.t, Math.min(firsts.get(p.t) ?? 99, p.hour));
          const med1 = median([...firsts.values()]);
          const color = resolveColour(medColour(med.color));
          return (
            <div key={med.id}>
              <p className="font-medium">{nameOf(med)}</p>
              {med1 !== null && <p className="text-sm text-muted">First dose usually around {hourLabel(med1)} (median)</p>}
              <div style={{ height: 170 }} className="mt-2">
                <Scatter data={{ datasets: [{ label: nameOf(med), data: pts.map((p) => ({ x: p.t, y: p.hour })), ...point(th, color) }] }}
                  options={{ ...baseOptions(th), interaction: { mode: 'nearest', intersect: true },
                    plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${hourLabel(c.parsed.y as number)}` } } },
                    scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, min: 0, max: 24, reverse: true, ticks: { ...baseOptions(th).scales.y.ticks, stepSize: 6, callback: (v) => hourLabel(Number(v)) } } } }} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// 5. How you've felt: mood, energy, focus with markers for medication changes.
export function FeelingsChart({ checkIns, events, meds, start, end, s, prevStart, realNames }: RangeProps & { checkIns: CheckIn[]; events: MedEvent[]; meds: Medication[]; prevStart: number | null }) {
  const nameOf = nameFor(realNames);
  const th = useChartTheme();
  const fields = [['mood', 'Mood'], ['energy', 'Energy'], ['focus', 'Focus']] as const;
  const series = fields.map(([f, label], i) => ({ f, label, color: th.series[i], pts: dailyAverages(checkIns, f, start, end, s) }));
  const marks = events.filter((e) => Date.parse(e.at) >= start && Date.parse(e.at) <= end).sort((a, b) => a.at.localeCompare(b.at));
  const periodDays = prevStart === null ? null : Math.round((end - start) / DAY);
  const cur = average(checkIns, 'mood', start, end);
  const prev = prevStart === null ? null : average(checkIns, 'mood', prevStart, start);
  const any = series.some((x) => x.pts.length);
  const medName = (id: string) => { const m = meds.find((x) => x.id === id); return m ? nameOf(m) : 'Medication'; };
  // Started/stopped summaries were written with the real name, so rebuild them with the name being shown.
  const markText = (e: MedEvent) => e.kind === 'changed' ? `${medName(e.medicationId)}: ${e.summary}`
    : `${e.kind === 'stopped' ? 'Stopped' : e.summary.startsWith('Restarted') ? 'Restarted' : 'Started'} ${medName(e.medicationId)}`;
  return (
    <ChartCard title="How you've felt" key={th.key}
      empty={any ? null : 'No check-ins in this range. A check-in takes about 20 seconds.'}
      summary={averageSummary('Mood', cur, prev, periodDays)}
      table={{ head: ['Date', 'Mood', 'Energy', 'Focus'], rows: [...new Set(series.flatMap((x) => x.pts.map((p) => p.t)))].sort((a, b) => b - a)
        .map((t) => [fmtDay(t), ...series.map((x) => x.pts.find((p) => p.t === t)?.v.toFixed(1) ?? '–')]) }}
      footer={marks.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm">
          {marks.map((e, i) => <li key={e.id} className="flex gap-2"><span className="font-semibold tnum w-4">{i + 1}</span><span className="text-muted tnum">{format(Date.parse(e.at), 'd MMM')}</span><span>{markText(e)}</span></li>)}
        </ol>
      )}>
      <Line
        data={{ datasets: series.map((x) => ({ label: x.label, data: x.pts.map((p) => ({ x: p.t, y: p.v })), borderColor: x.color, borderWidth: 2, tension: 0.3, ...point(th, x.color), pointRadius: x.pts.length > 30 ? 0 : 4 })) }}
        options={{ ...baseOptions(th),
          plugins: { ...baseOptions(th).plugins, legend: { ...baseOptions(th).plugins.legend, display: true, position: 'top', align: 'start' },
            tooltip: { ...baseOptions(th).plugins.tooltip, mode: 'index', callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y as number).toFixed(1)}` } },
            // @ts-expect-error custom plugin options
            vlines: { lines: marks.map((e, i) => ({ x: Date.parse(e.at), label: String(i + 1) })), color: th.muted, text: th.text } },
          scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, min: 1, max: 5, ticks: { ...baseOptions(th).scales.y.ticks, stepSize: 1 } } } }}
      />
    </ChartCard>
  );
}

// 6. Appetite and weight: two charts on the same dates (never one chart with two scales).
/** Appetite from check-ins beside the weight trend. `weight={false}` (TapDose) shows appetite alone. */
export function AppetiteWeight({ checkIns, entries, start, end, s, units, weight = true }: RangeProps & { checkIns: CheckIn[]; entries: BodyEntry[]; units: Units; weight?: boolean }) {
  const th = useChartTheme();
  const app = dailyAverages(checkIns, 'appetite', start, end, s);
  const all = weight ? bodySeries(entries, 'weightKg', -Infinity, Infinity) : [];
  const w = rollingAverage(all).filter((p) => p.t >= start - DAY / 2 && p.t <= end + DAY / 2);
  const appAvg = average(checkIns, 'appetite', start, end);
  const summary = [appAvg !== null ? `Appetite averaged ${appAvg.toFixed(1)}` : null, changeSummary(w, (v) => fmtWeight(v, units))].filter(Boolean).join('. ');
  const mini = (label: string, pts: Pt[], color: string, y: object, fmt: (v: number) => string) => (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <div style={{ height: 120 }} className="mt-1">
        {pts.length ? (
          <Line data={{ datasets: [{ label, data: pts.map((p) => ({ x: p.t, y: p.v })), borderColor: color, borderWidth: 2, tension: 0.3, ...point(th, color), pointRadius: pts.length > 30 ? 0 : 4 }] }}
            options={{ ...baseOptions(th), plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => fmt(c.parsed.y as number) } } },
              scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, ...y } } }} />
        ) : <p className="text-sm text-muted">Nothing logged in this range.</p>}
      </div>
    </div>
  );
  return (
    <ChartCard title={weight ? 'Appetite and weight' : 'Appetite'} height={null} key={th.key}
      empty={app.length || w.length ? null : weight ? 'Log appetite in a check-in and your weight to compare them here.' : 'Log appetite in a check-in to see it here.'}
      summary={summary || null}
      table={weight
        ? { head: ['Date', 'Appetite (avg)', `Weight 7-day avg (${weightUnit(units)})`],
          rows: [...new Set([...app, ...w].map((p) => p.t))].sort((a, b) => b - a).map((t) => [fmtDay(t), app.find((p) => p.t === t)?.v.toFixed(1) ?? '–', w.find((p) => p.t === t) ? kgTo(w.find((p) => p.t === t)!.v, units) : '–']) }
        : { head: ['Date', 'Appetite (avg)'], rows: [...app].sort((a, b) => b.t - a.t).map((p) => [fmtDay(p.t), p.v.toFixed(1)]) }}>
      <div className="space-y-4">
        {mini('Appetite (daily average, 1–5)', app, th.series[1], { min: 1, max: 5, ticks: { ...baseOptions(th).scales.y.ticks, stepSize: 1 } }, (v) => `Appetite ${v.toFixed(1)}`)}
        {weight && mini(`Weight (7-day average, ${weightUnit(units)})`, w.map((p) => ({ t: p.t, v: kgTo(p.v, units) })), th.series[0], { grace: '5%' }, (v) => `${v.toFixed(1)} ${weightUnit(units)}`)}
      </div>
    </ChartCard>
  );
}

// 7. Noticed most: the most frequent check-in chips.
export function NoticedMost({ checkIns, start, end }: RangeProps & { checkIns: CheckIn[] }) {
  const th = useChartTheme();
  const counts = chipCounts(checkIns, start, end);
  const top = counts.slice(0, 8);
  return (
    <ChartCard title="Noticed most" key={th.key} height={Math.max(80, top.length * 34 + 16)}
      empty={top.length ? null : 'Nothing noted in check-ins in this range.'}
      summary={top.length ? `${top[0].chip}: ${top[0].count} time${top[0].count === 1 ? '' : 's'}${counts.length > 8 ? `. Showing the top 8 of ${counts.length}.` : ''}` : null}
      table={{ head: ['Noticed', 'Times'], rows: counts.map((c) => [c.chip, c.count]) }}>
      <Bar data={{ labels: top.map((c) => c.chip), datasets: [{ data: top.map((c) => c.count), backgroundColor: th.series[0], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] }}
        options={{ ...baseOptions(th), indexAxis: 'y', layout: { padding: { right: 28 } }, interaction: { mode: 'nearest', intersect: true },
          plugins: { ...baseOptions(th).plugins,
            // @ts-expect-error custom plugin options
            barValues: { enabled: true, color: th.text } },
          scales: { x: { ...baseOptions(th).scales.x, display: false, beginAtZero: true }, y: { ...baseOptions(th).scales.y, grid: { display: false }, ticks: { ...baseOptions(th).scales.y.ticks, color: th.text } } } }} />
    </ChartCard>
  );
}

// 8. Interval check: hours between consecutive doses on the same day.
export function IntervalCharts({ meds, doses, start, end, s, realNames }: RangeProps & { meds: Medication[]; doses: Dose[] }) {
  const nameOf = nameFor(realNames);
  const th = useChartTheme();
  const series = meds.map((m) => ({ med: m, gaps: doseIntervals(doses, m.id, start, end, s) })).filter((x) => x.gaps.length);
  return (
    <ChartCard title="Time between doses" height={null} key={th.key}
      empty={series.length ? null : 'Shows up once you log two or more doses of something in a day.'}
      table={{ head: ['Medication', 'Hours between doses', 'Times'], rows: series.flatMap((x) => histogram(x.gaps).map((b) => [nameOf(x.med), `${b.from}–${b.to}`, b.count])) }}>
      <div className="space-y-5">
        {series.map(({ med, gaps }) => {
          const bins = histogram(gaps, 0.5);
          const med1 = median(gaps)!;
          const color = resolveColour(medColour(med.color));
          const sched = med.schedule.type === 'interval' && med.schedule.intervalHours ? ` Your schedule is every ${med.schedule.intervalHours} hours.` : '';
          return (
            <div key={med.id}>
              <p className="font-medium">{realNames ? fmtMedName(med) : shownMedName(med)}</p>
              <p className="text-sm text-muted tnum">Median gap {fmtDuration(med1 * 3_600_000)} across {gaps.length} gap{gaps.length === 1 ? '' : 's'}.{sched}</p>
              <div style={{ height: 150 }} className="mt-2">
                <Bar data={{ labels: bins.map((b) => `${b.from}–${b.to}h`), datasets: [{ label: nameOf(med), data: bins.map((b) => b.count), backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] }}
                  options={{ ...baseOptions(th), interaction: { mode: 'nearest', intersect: true },
                    plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} time${c.parsed.y === 1 ? '' : 's'}` } } },
                    scales: { x: { ...baseOptions(th).scales.x, grid: { display: false } }, y: { ...baseOptions(th).scales.y, beginAtZero: true, ticks: { ...baseOptions(th).scales.y.ticks, precision: 0 } } } }} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}


// 9. Blood pressure and heart rate: two charts on the same dates (different units, so never one chart with two scales).
export function VitalsCharts({ vitals, start, end }: RangeProps & { vitals: Vital[] }) {
  const th = useChartTheme();
  const inRange = vitals.filter((v) => !v.deletedAt && Date.parse(v.at) >= start && Date.parse(v.at) <= end).sort((a, b) => a.at.localeCompare(b.at));
  const bp = inRange.filter((v) => v.systolic && v.diastolic);
  const hr = inRange.filter((v) => v.heartRate);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const summary = [
    bp.length ? `Blood pressure averaged ${avg(bp.map((v) => v.systolic!))}/${avg(bp.map((v) => v.diastolic!))} mmHg over ${bp.length} reading${bp.length === 1 ? '' : 's'}` : '',
    hr.length ? `heart rate averaged ${avg(hr.map((v) => v.heartRate!))} bpm` : '',
  ].filter(Boolean).join('; ');
  const line = (label: string, pts: { x: number; y: number }[], color: string) =>
    ({ label, data: pts, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.2, ...point(th, color), pointRadius: pts.length > 40 ? 0 : 4 });
  return (
    <ChartCard title="Blood pressure and heart rate" height={null} key={th.key}
      empty={inRange.length ? null : 'No readings in this range. Log one from Today or Body.'}
      summary={summary ? summary[0].toUpperCase() + summary.slice(1) : null}
      table={{ head: ['When', 'Blood pressure (mmHg)', 'Heart rate (bpm)'], rows: [...inRange].reverse().map((v) =>
        [format(Date.parse(v.at), 'EEE d MMM, h:mm a'), v.systolic ? `${v.systolic}/${v.diastolic}` : '–', v.heartRate ?? '–']) }}>
      <div className="space-y-4">
        {bp.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Blood pressure (mmHg)</p>
            <div style={{ height: 170 }} className="mt-1">
              <Line data={{ datasets: [
                line('Top (systolic)', bp.map((v) => ({ x: Date.parse(v.at), y: v.systolic! })), th.series[0]),
                line('Bottom (diastolic)', bp.map((v) => ({ x: Date.parse(v.at), y: v.diastolic! })), th.series[1]),
              ] }}
                options={{ ...baseOptions(th),
                  plugins: { ...baseOptions(th).plugins, legend: { ...baseOptions(th).plugins.legend, display: true, position: 'top', align: 'start' },
                    tooltip: { ...baseOptions(th).plugins.tooltip, mode: 'index', callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}` } } },
                  scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, grace: '10%' } } }} />
            </div>
          </div>
        )}
        {hr.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Heart rate (bpm)</p>
            <div style={{ height: 130 }} className="mt-1">
              <Line data={{ datasets: [line('Heart rate', hr.map((v) => ({ x: Date.parse(v.at), y: v.heartRate! })), th.series[2])] }}
                options={{ ...baseOptions(th), plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} bpm` } } },
                  scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, grace: '10%' } } }} />
            </div>
          </div>
        )}
      </div>
    </ChartCard>
  );
}
