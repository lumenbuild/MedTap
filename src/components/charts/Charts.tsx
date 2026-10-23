import type { CSSProperties, ReactNode } from 'react';
import { Bar, Scatter } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, MedEvent, Medication, Vital } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import type { ScheduleSettings } from '../../logic/schedule';
import { getDailyTarget } from '../../logic/schedule';
import {
  adherenceByDay, average, bodySeries, chipCounts, dailyAverages, daysBetween, doseIntervals, doseTimes, histogram,
  median, rollingAverage, ymdToMs, type Pt,
} from '../../logic/stats';
import { cmTo, fmtLength, kgTo, lengthUnit, MEASUREMENTS, weightUnit } from '../../logic/units';
import { fmtDuration, fmtHHmm, fmtMedName } from '../../logic/format';
import { medColour, resolveColour } from '../../logic/palette';
import { MedBadge } from '../MedBadge';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { ChartCard, type Headline } from './ChartCard';
import { TrendChart, type TrendSeries } from './TrendChart';
import { baseOptions, timeAxis, useChartTheme, type ChartTheme } from './setup';

const DAY = 86_400_000;
/** `realNames` shows real medication names instead of nicknames (the doctor report can choose). */
export interface RangeProps { start: number; end: number; s: ScheduleSettings; realNames?: boolean }
const nameFor = (realNames?: boolean) => (m: Medication) => (realNames ? m.name : shownName(m));
const fmtDay = (t: number) => format(t, 'EEE d MMM');
const hourLabel = (h: number) => fmtHHmm(`${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
const point = (th: ChartTheme, color: string) => ({ pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: color, pointBorderColor: th.surface, pointBorderWidth: 2, pointHitRadius: 12 });

// 1. Weight, the one weight chart: weigh-ins, the 7-day average, the goal, and where it's heading (through the dose
// plan when there is one, else towards the goal) with its likely range.
export interface WeightForecast { points: { t: number; v: number; low?: number; high?: number }[]; text?: string }
export function WeightChart({ entries, start, end, units, marks = [], goalKg, forecast, extra }: RangeProps & { entries: BodyEntry[]; units: Units; extra?: ReactNode;
  /** Dose changes to mark on the chart (peptide tools: titration steps). */
  marks?: { at: number; text: string }[]; goalKg?: number; forecast?: WeightForecast | null }) {
  const all = bodySeries(entries, 'weightKg', -Infinity, Infinity);
  const inRange = (p: Pt) => p.t >= start - DAY / 2 && p.t <= end + DAY / 2;
  const pts = all.filter(inRange);
  const avg = rollingAverage(all).filter(inRange);
  const u = weightUnit(units);
  const k = (v: number) => kgTo(v, units);
  const fc = forecast?.points.length ? forecast : null;
  const to = fc ? Math.max(end, fc.points[fc.points.length - 1].t) : end;
  const series: TrendSeries[] = [
    { label: 'Weigh-ins', style: 'dots', points: pts.map((p) => ({ t: p.t, v: k(p.v) })) },
    { label: '7-day average', style: 'line', points: avg.map((p) => ({ t: p.t, v: k(p.v) })) },
    ...(fc ? [{ label: 'Forecast', style: 'forecast' as const, noTable: true, points: fc.points.map((p) => ({ t: p.t, v: k(p.v) })),
      band: fc.points.filter((p) => p.low !== undefined && p.high !== undefined).map((p) => ({ t: p.t, low: k(p.low!), high: k(p.high!) })) }] : []),
    ...(goalKg !== undefined ? [{ label: 'Goal', style: 'goal' as const, points: [{ t: start, v: k(goalKg) }, { t: to, v: k(goalKg) }] }] : []),
  ];
  const headline = trendHeadline(avg.length ? avg : pts, (v) => String(k(v)), u, start, end);
  return <TrendChart title="Weight" series={series} start={start} end={to} unit={u} marks={marks} summary={fc?.text ?? null} extra={extra} headline={headline}
    empty={pts.length ? null : 'No weigh-ins in this range.'} />;
}

/** The latest value, and how far it moved over the range shown ("−2.9 kg in 30 days"). */
export function trendHeadline(pts: Pt[], show: (v: number) => string, unit: string, start: number, end: number): Headline | null {
  if (!pts.length) return null;
  const last = pts[pts.length - 1], first = pts[0];
  const days = Math.max(1, Math.round((Math.min(end, last.t) - Math.max(start, first.t)) / DAY));
  const diff = Number(show(last.v)) - Number(show(first.v));
  if (pts.length < 2) return { value: show(last.v), unit };
  const r = Math.round(Math.abs(diff) * 10) / 10;
  return { value: show(last.v), unit, dir: r === 0 ? 'flat' : diff < 0 ? 'down' : 'up', delta: r === 0 ? `same as ${days} days ago` : `${diff < 0 ? '−' : '+'}${r} ${unit} in ${days} day${days === 1 ? '' : 's'}` };
}

// 2. Measurements: one small chart per measurement logged.
export function MeasurementCharts({ entries, start, end, units, skip = [] }: RangeProps & { entries: BodyEntry[]; units: Units; skip?: string[] }) {
  const th = useChartTheme();
  const series = MEASUREMENTS.filter((m) => !skip.includes(m.key)).map((m) => ({ ...m, pts: bodySeries(entries, m.key, start, end) })).filter((m) => m.pts.length);
  const u = lengthUnit(units);
  return (
    <ChartCard title="Measurements" height={null} key={th.key}
      empty={series.length ? null : 'No measurements in this range.'}
      table={{ head: ['Date', 'Measurement', `Value (${u})`], rows: series.flatMap((m) => m.pts.map((p) => [fmtDay(p.t), m.label, cmTo(p.v, units)])) }}>
      <div className={`grid gap-4 ${series.length > 1 ? 'grid-cols-2' : ''}`}>
        {series.map((m) => {
          const first = m.pts[0], last = m.pts[m.pts.length - 1];
          const diff = cmTo(last.v, units) - cmTo(first.v, units);
          return (
            <div key={m.key}>
              <p className="text-sm font-semibold">{m.label}</p>
              <p className="text-xs text-muted tnum">{fmtLength(last.v, units)}{m.pts.length > 1 && Math.abs(diff) >= 0.1 ? ` · ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}` : ''}</p>
              <div className="mt-1">
                <TrendChart bare noLegend hideX height={96} title={m.label} start={start} end={end} fmt={(v) => `${v} ${u}`}
                  series={[{ label: m.label, style: 'line', points: m.pts.map((p) => ({ t: p.t, v: cmTo(p.v, units) })) }]} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

/** A calendar of days as weeks (rows) by weekday (Monday to Sunday), full width, with weekday letters on top and the
 *  month beside the week it starts in. Cells get shorter for long ranges so 26 weeks still fit. */
export function WeekGrid({ days, cell, label }: { days: string[]; label: string;
  cell: (i: number) => { title: string; className?: string; style?: CSSProperties; inner?: ReactNode } }) {
  if (!days.length) return null;
  const lead = (new Date(`${days[0]}T12:00`).getDay() + 6) % 7; // Monday first
  const slots: (number | null)[] = [...Array.from({ length: lead }, () => null), ...days.map((_, i) => i)];
  while (slots.length % 7) slots.push(null);
  const weeks = Array.from({ length: slots.length / 7 }, (_, w) => slots.slice(w * 7, w * 7 + 7));
  const h = weeks.length <= 6 ? 30 : weeks.length <= 14 ? 20 : 12;
  let lastMonth = '';
  return (
    <div role="img" aria-label={label} className="grid gap-[3px]" style={{ gridTemplateColumns: '30px repeat(7, minmax(0, 1fr))' }}>
      <span />
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} aria-hidden="true" className="text-[11px] text-muted text-center leading-4">{d}</span>)}
      {weeks.map((wk, w) => {
        const firstDay = wk.find((x) => x !== null);
        const m = firstDay != null ? format(ymdToMs(days[firstDay]), 'MMM') : '';
        const showM = m !== lastMonth; if (showM) lastMonth = m;
        return [
          <span key={`m${w}`} aria-hidden="true" className="text-[11px] text-muted leading-none self-center">{showM ? m : ''}</span>,
          ...wk.map((x, d) => {
            if (x === null) return <span key={`${w}-${d}`} />;
            const c = cell(x);
            return <span key={`${w}-${d}`} title={c.title} className={`rounded-[4px] relative ${c.className ?? ''}`} style={{ height: h, ...c.style }}>{c.inner}</span>;
          }),
        ];
      })}
    </div>
  );
}

// 3. Adherence heatmap: a calendar grid of doses per day vs the user's own daily target.
export function AdherenceHeatmap({ meds, doses, start, end, s, realNames }: RangeProps & { meds: Medication[]; doses: Dose[] }) {
  const nameOf = nameFor(realNames);
  const capStart = Math.max(start, end - 182 * DAY); // at most 26 weeks so cells stay tappable
  const days = daysBetween(capStart, end, s);
  const rows = meds.map((m) => ({ med: m, cells: adherenceByDay(doses, m, days, s) })).filter((r) => r.cells.some((c) => c.count));
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
              <WeekGrid days={cells.map((c) => c.day)} label={`${nameOf(med)}: ${full !== null ? `all doses logged on ${full} of ${scheduled.length} scheduled days` : `doses on ${cells.filter((c) => c.count).length} of ${cells.length} days`}`}
                cell={(i) => {
                  const c = cells[i];
                  const t = c.target;
                  const off = t === 0 && c.count === 0; // not a scheduled day
                  const level = c.count === 0 ? 0 : t ? (c.count >= t ? 1 : 0.45) : 0.35 + 0.65 * (c.count / max);
                  const over = !!t && c.count > t;
                  return {
                    title: `${fmtDay(ymdToMs(c.day))}: ${off ? 'not scheduled' : `${c.count}${t ? ` of ${t}` : ''}`}`,
                    className: off ? 'border border-dashed border-border' : '',
                    style: { background: off ? 'transparent' : level ? medColour(med.color) : 'var(--surface-2)', opacity: level ? level : 1 },
                    inner: over ? <span className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: 'var(--surface)' }} /> : null,
                  };
                }} />
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

// 4. Dose timing: time of day each dose was taken, one small chart per medication, zoomed to the hours used, with a
// dotted line at the usual time of the first dose.
const shortHour = (h: number) => { const hh = ((Math.round(h) % 24) + 24) % 24; return `${hh % 12 || 12} ${hh < 12 ? 'am' : 'pm'}`; };
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
          const hs = pts.map((p) => p.hour);
          const raw = Math.max(4, Math.ceil(Math.max(...hs)) - Math.floor(Math.min(...hs)) + 2);
          const step = raw <= 6 ? 1 : raw <= 12 ? 2 : raw <= 18 ? 3 : 6;
          // Whole steps either side of the doses (so ticks fall on 6 am, 9 am, …), at least 4 hours tall.
          let lo = Math.max(0, Math.floor((Math.min(...hs) - 0.5) / step) * step), hi = Math.min(24, Math.ceil((Math.max(...hs) + 0.5) / step) * step);
          while (hi - lo < 4) { if (lo > 0) lo -= step; else hi += step; }
          const span = hi - lo;
          return (
            <div key={med.id}>
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-medium flex items-center gap-2"><MedBadge color={realNames ? med.color : shownColour(med)} icon={med.icon} size={22} />{nameOf(med)}</span>
                {med1 !== null && <span className="text-sm text-muted tnum">usually <span className="font-semibold text-text">{hourLabel(med1)}</span></span>}
              </p>
              <div style={{ height: Math.min(180, 70 + span * 9) }} className="mt-2">
                <Scatter data={{ datasets: [
                  { label: nameOf(med), data: pts.map((p) => ({ x: p.t, y: p.hour })), ...point(th, color), pointRadius: 4.5 },
                  ...(med1 !== null ? [{ label: 'Usual', data: [{ x: start, y: med1 }, { x: end, y: med1 }], showLine: true, borderColor: th.text, borderWidth: 1.5, borderDash: [2, 4], pointRadius: 0, pointHitRadius: 0 }] : []),
                ] }}
                  options={{ ...baseOptions(th), interaction: { mode: 'nearest', intersect: true },
                    plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, filter: (i) => i.dataset.label !== 'Usual', callbacks: { title: (c) => fmtDay(c[0].parsed.x as number), label: (c) => `${hourLabel(c.parsed.y as number)}` } } },
                    scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, min: lo, max: hi, reverse: true, ticks: { ...baseOptions(th).scales.y.ticks, stepSize: step, callback: (v) => shortHour(Number(v)) } } } }} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// 5. How you've felt: one small chart per measure (mood, energy, focus, appetite), on the same dates, each with its
// daily averages as dots and the 7-day average as a line; medication changes marked in every row and listed below.
export function FeelingsChart({ checkIns, events, meds, start, end, s, prevStart, realNames }: RangeProps & { checkIns: CheckIn[]; events: MedEvent[]; meds: Medication[]; prevStart: number | null }) {
  const th = useChartTheme();
  const nameOf = nameFor(realNames);
  const fields = [['mood', 'Mood'], ['energy', 'Energy'], ['focus', 'Focus'], ['appetite', 'Appetite']] as const;
  const marks = events.filter((e) => Date.parse(e.at) >= start && Date.parse(e.at) <= end).sort((a, b) => a.at.localeCompare(b.at));
  const periodDays = prevStart === null ? null : Math.round((end - start) / DAY);
  const medName = (id: string) => { const m = meds.find((x) => x.id === id); return m ? nameOf(m) : 'Medication'; };
  // Started/stopped summaries were written with the real name, so rebuild them with the name being shown.
  const markText = (e: MedEvent) => e.kind === 'changed' ? `${medName(e.medicationId)}: ${e.summary}`
    : `${e.kind === 'stopped' ? 'Stopped' : e.summary.startsWith('Restarted') ? 'Restarted' : 'Started'} ${medName(e.medicationId)}`;
  const rows = fields.map(([f, label]) => {
    const pts = dailyAverages(checkIns, f, start, end, s);
    const cur = average(checkIns, f, start, end);
    const prev = prevStart === null ? null : average(checkIns, f, prevStart, start);
    return { f, label, pts, cur, prev };
  }).filter((r) => r.pts.length);
  const days = [...new Set(rows.flatMap((r) => r.pts.map((p) => p.t)))].sort((a, b) => b - a);
  const markAt = marks.map((e) => ({ at: Date.parse(e.at), text: markText(e) }));
  return (
    <ChartCard title="How you've felt" height={null} key={th.key} empty={rows.length ? null : 'No check-ins in this range.'}
      summary={rows.length ? `Average of your check-ins each day, 1 (low) to 5 (high)${periodDays ? `, against the ${periodDays} days before` : ''}.` : null}
      table={{ head: ['Date', ...rows.map((r) => r.label)], rows: days.map((t) => [fmtDay(t), ...rows.map((r) => { const x = r.pts.find((p) => p.t === t); return x ? Math.round(x.v * 10) / 10 : '–'; })]) }}
      footer={markAt.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm">
          {markAt.map((m, i) => <li key={i} className="flex gap-2"><span className="font-semibold tnum w-4">{i + 1}</span><span className="text-muted tnum">{format(m.at, 'd MMM')}</span><span>{m.text}</span></li>)}
        </ol>
      )}>
      <div className="space-y-1">
        {rows.map((r, i) => {
          const d = r.cur !== null && r.prev !== null ? Math.round((r.cur - r.prev) * 10) / 10 : null;
          return (
            <div key={r.f}>
              <p className="flex items-baseline gap-2 tnum">
                <span className="font-medium w-[76px]">{r.label}</span>
                <span className="text-[20px] font-semibold">{r.cur !== null ? r.cur.toFixed(1) : '–'}</span>
                {d !== null && <span className="text-sm text-muted">{d === 0 ? 'same as before' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)}`}</span>}
              </p>
              <TrendChart bare noLegend labelFmt={(v) => v.toFixed(1)} hideX={i < rows.length - 1} height={i < rows.length - 1 ? 78 : 104} title={r.label} start={start} end={end} yMin={1} yMax={5} step={2}
                fmt={(v) => v.toFixed(1)} marks={i === 0 ? markAt : markAt.map((m) => ({ ...m }))}
                series={[
                  { label: `${r.label} each day`, style: 'dots', points: r.pts },
                  { label: `${r.label}, 7-day average`, style: 'line', points: rollingAverage(r.pts) },
                ]} />
            </div>
          );
        })}
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
              <p className="text-sm text-muted tnum">Usually {fmtDuration(med1 * 3_600_000).replace(/(\d)([dhm])\b/g, (_, n, u) => `${n} ${u === 'd' ? 'd' : u === 'h' ? 'h' : 'min'}`)} between doses ({gaps.length} gap{gaps.length === 1 ? '' : 's'}).{sched}</p>
              {gaps.length >= 4 && <div style={{ height: 150 }} className="mt-2">
                <Bar data={{ labels: bins.map((b) => `${b.from}–${b.to}h`), datasets: [{ label: nameOf(med), data: bins.map((b) => b.count), backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] }}
                  options={{ ...baseOptions(th), interaction: { mode: 'nearest', intersect: true },
                    plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} time${c.parsed.y === 1 ? '' : 's'}` } } },
                    scales: { x: { ...baseOptions(th).scales.x, grid: { display: false } }, y: { ...baseOptions(th).scales.y, beginAtZero: true, ticks: { ...baseOptions(th).scales.y.ticks, precision: 0 } } } }} />
              </div>}
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
    bp.length ? `${bp.length} blood pressure reading${bp.length === 1 ? '' : 's'}` : '',
    hr.length ? `${hr.length} heart rate` : '',
  ].filter(Boolean).join(', ');
  const at = (v: Vital) => Date.parse(v.at);
  return (
    <ChartCard title="Blood pressure and heart rate" height={null} key={th.key}
      empty={inRange.length ? null : 'No readings in this range.'}
      headline={bp.length ? { value: `${avg(bp.map((v) => v.systolic!))}/${avg(bp.map((v) => v.diastolic!))}`, unit: 'mmHg average', delta: hr.length ? `heart rate ${avg(hr.map((v) => v.heartRate!))} bpm` : undefined } : null}
      summary={summary ? summary[0].toUpperCase() + summary.slice(1) : null}
      table={{ head: ['When', 'Blood pressure (mmHg)', 'Heart rate (bpm)'], rows: [...inRange].reverse().map((v) =>
        [format(Date.parse(v.at), 'EEE d MMM, h:mm a'), v.systolic ? `${v.systolic}/${v.diastolic}` : '–', v.heartRate ?? '–']) }}>
      <div className="space-y-4">
        {bp.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Blood pressure (mmHg)</p>
            <div style={{ height: 170 }}>
              <Bar data={{ datasets: [{ label: 'Blood pressure', data: bp.map((v) => ({ x: at(v), y: [v.diastolic!, v.systolic!] })) as never, backgroundColor: th.text, borderRadius: 3, borderSkipped: false, barThickness: 6 }] }}
                options={{ ...baseOptions(th), interaction: { mode: 'nearest', intersect: false, axis: 'x' },
                  plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, displayColors: false, callbacks: {
                    title: (c) => format(c[0].parsed.x as number, 'EEE d MMM, h:mm a'),
                    label: (c) => { const r = (c.raw as { y: [number, number] }).y; return `${r[1]}/${r[0]} mmHg`; } } } },
                  scales: { x: { ...timeAxis(th, start, end), offset: false }, y: { ...baseOptions(th).scales.y, beginAtZero: false, grace: '8%', ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 5 } } } }} />
            </div>
            <p className="text-xs text-muted mt-1">Each bar runs from the lower number to the upper.</p>
          </div>
        )}
        {hr.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Heart rate (bpm)</p>
            <TrendChart bare height={130} title="Heart rate" start={start} end={end} fmt={(v) => `${Math.round(v)} bpm`}
              series={[{ label: 'Heart rate', style: 'line', points: hr.map((v) => ({ t: at(v), v: v.heartRate! })) }]} />
          </div>
        )}
      </div>
    </ChartCard>
  );
}
