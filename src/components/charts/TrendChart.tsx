// The one time-series chart. Every "over time" view uses it, so marks, colour, tooltips and tables behave the same
// everywhere: one y-axis; a single series in ink (no legend, the title names it); 2+ series in fixed categorical slots
// with a legend and labels at the line ends; 2px lines, 8px dots with a surface ring; forecasts dashed, likely ranges as
// a light wash, goals as a dotted ink line; a crosshair on hover; and the same data as a table.
import { Line } from 'react-chartjs-2';
import type { Plugin } from 'chart.js';
import { format } from 'date-fns';
import { ChartCard } from './ChartCard';
import { baseOptions, timeAxis, useChartTheme, type ChartTheme } from './setup';

export interface TrendPoint { t: number; v: number }
export type TrendStyle = 'line' | 'dots' | 'forecast' | 'goal';
export interface TrendSeries {
  label: string;
  points: TrendPoint[];
  style: TrendStyle;
  /** Categorical slot (fixed per metric, never by rank). Omitted: ink for lines, muted for dots. */
  slot?: number;
  /** For a forecast: its likely low/high at each point, drawn as a light band. */
  band?: { t: number; low: number; high: number }[];
  /** Leave out of the table (e.g. raw readings already summarised by the line). */
  noTable?: boolean;
}

export interface TrendChartProps {
  title: string; summary?: string | null; empty?: string | null;
  series: TrendSeries[];
  start: number; end: number;
  unit?: string; fmt?: (v: number) => string;
  yMin?: number; yMax?: number; step?: number;
  /** Numbered vertical markers (dose changes), listed under the chart. */
  marks?: { at: number; text: string }[];
  height?: number;
  /** Only the chart (no card, title or table): for a figure inside another section. */
  bare?: boolean;
}

const fmtDay = (t: number) => format(t, 'EEE d MMM');

/** The value at the end of each line, in text colour beside a dot of the line's colour; skipped where labels would collide. */
const endLabels: Plugin<'line'> = {
  id: 'endLabels',
  afterDatasetsDraw(chart, _a, opts: { enabled?: boolean; text?: string; surface?: string }) {
    if (!opts?.enabled) return;
    const { ctx, chartArea } = chart;
    const placed: number[] = [];
    ctx.save();
    ctx.font = '600 12px "Geist Variable", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      const lbl = (ds as { endLabel?: string }).endLabel;
      if (!lbl || meta.hidden || !meta.data.length) return;
      const last = meta.data[meta.data.length - 1];
      if (last.x < chartArea.left || last.x > chartArea.right) return;
      if (placed.some((y) => Math.abs(y - last.y) < 14)) return;
      placed.push(last.y);
      const w = ctx.measureText(lbl).width;
      const x = Math.min(last.x + 8, chart.width - w - 4);
      ctx.fillStyle = opts.surface ?? '#fff';
      ctx.fillRect(x - 2, last.y - 8, w + 4, 16);
      ctx.fillStyle = opts.text ?? '#111';
      ctx.fillText(lbl, x, last.y);
    });
    ctx.restore();
  },
};

/** A thin vertical line at the hovered date. */
const crosshair: Plugin<'line'> = {
  id: 'crosshair',
  afterDatasetsDraw(chart, _a, opts: { color?: string }) {
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.strokeStyle = opts?.color ?? '#999';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    ctx.restore();
  },
};

function colourOf(th: ChartTheme, s: TrendSeries, multi: boolean) {
  if (s.style === 'goal') return th.text;
  if (s.slot !== undefined && multi) return th.series[s.slot % th.series.length];
  return s.style === 'dots' ? th.muted : th.text;
}

export function TrendChart(p: TrendChartProps) {
  const th = useChartTheme();
  const fmt = p.fmt ?? ((v: number) => `${Math.round(v * 10) / 10}${p.unit ? ` ${p.unit}` : ''}`);
  const lines = p.series.filter((s) => s.style === 'line' && s.points.length);
  const multi = lines.length >= 2;
  const marks = (p.marks ?? []).filter((m) => m.at >= p.start && m.at <= p.end).sort((a, b) => a.at - b.at);
  const any = p.series.some((s) => s.style !== 'goal' && s.points.length);

  const datasets = p.series.flatMap((s): Record<string, unknown>[] => {
    const c = colourOf(th, s, multi);
    const data = s.points.map((x) => ({ x: x.t, y: x.v }));
    const many = s.points.length > 30;
    const base = { label: s.label, data, borderColor: c, backgroundColor: c, borderWidth: 2, borderCapStyle: 'round' as const, borderJoinStyle: 'round' as const, cubicInterpolationMode: 'monotone' as const, pointStyle: 'line' as const,
      pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: th.surface, pointBorderWidth: 2, pointHitRadius: 12 };
    if (s.style === 'dots') return [{ ...base, order: 2, borderColor: `${c}8c`, backgroundColor: `${c}8c`, pointBackgroundColor: `${c}8c`, pointStyle: 'circle' as const, showLine: false, pointRadius: many ? 3 : 4 }];
    if (s.style === 'goal') return [{ ...base, borderWidth: 1.5, borderDash: [2, 4], pointHitRadius: 0, pointHoverRadius: 0, cubicInterpolationMode: 'default' as const, tension: 0, endLabel: s.label }];
    if (s.style === 'forecast') {
      const band = s.band ?? [];
      return [
        ...(band.length ? [
          { label: '', data: band.map((b) => ({ x: b.t, y: b.low })), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: false, borderColor: 'transparent' },
          { label: 'Likely range', data: band.map((b) => ({ x: b.t, y: b.high })), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: '-1', pointStyle: 'rect' as const, borderColor: `${th.muted}40`, backgroundColor: `${th.muted}26` },
        ] : []),
        { ...base, borderDash: [6, 4] },
      ];
    }
    return [{ ...base, order: 0, pointRadius: many ? 0 : 4, endLabel: multi ? s.label : undefined }];
  });

  const times = [...new Set(p.series.filter((s) => !s.noTable && s.style !== 'goal').flatMap((s) => s.points.map((x) => Math.round(x.t / 3_600_000))))].sort((a, b) => b - a);
  const tableSeries = p.series.filter((s) => !s.noTable && s.style !== 'goal' && s.points.length);
  const table = { head: ['Date', ...tableSeries.map((s) => `${s.label}${p.unit ? ` (${p.unit})` : ''}`)],
    rows: times.map((h) => [fmtDay(h * 3_600_000), ...tableSeries.map((s) => { const x = s.points.find((q) => Math.round(q.t / 3_600_000) === h); return x ? Math.round(x.v * 100) / 100 : '–'; })]) };

  const o = baseOptions(th);
  const chart = (
    <Line
      data={{ datasets: datasets as never }}
      plugins={[endLabels, crosshair]}
      options={{ ...o,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { right: multi ? 56 : 8 } },
        plugins: { ...o.plugins,
          legend: { ...o.plugins.legend, display: multi || p.series.filter((s) => s.style !== 'dots' && s.points.length).length >= 2, position: 'top', align: 'start',
            labels: { ...o.plugins.legend.labels, usePointStyle: false, boxWidth: 14, boxHeight: 4, filter: (item) => !!item.text } },
          tooltip: { ...o.plugins.tooltip, mode: 'nearest', axis: 'x', intersect: false,
            filter: (i) => !!i.dataset.label && i.dataset.label !== 'Likely range',
            callbacks: { title: (c) => fmtDay(c[0].parsed.x as number), label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y as number)}` } },
          // @ts-expect-error custom plugin options
          endLabels: { enabled: true, text: th.text, surface: th.surface },
          crosshair: { color: th.muted },
          vlines: { lines: marks.map((m, i) => ({ x: m.at, label: String(i + 1) })), color: th.muted, text: th.text } },
        scales: { x: timeAxis(th, p.start, p.end),
          y: { ...o.scales.y, min: p.yMin, max: p.yMax, grace: p.yMin === undefined ? '5%' : 0,
            ticks: { ...o.scales.y.ticks, maxTicksLimit: 5, stepSize: p.step, callback: (v) => `${v}${p.unit && !p.step ? ` ${p.unit}` : ''}` } } } }}
    />
  );
  if (p.bare) return <div style={{ height: p.height ?? 170 }} key={th.key}>{chart}</div>;
  return (
    <ChartCard title={p.title} key={th.key} height={p.height ?? 220} empty={any ? null : p.empty ?? 'Nothing logged in this range.'} summary={p.summary} table={table}
      footer={marks.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm">
          {marks.map((m, i) => <li key={i} className="flex gap-2"><span className="font-semibold tnum w-4">{i + 1}</span><span className="text-muted tnum">{format(m.at, 'd MMM')}</span><span>{m.text}</span></li>)}
        </ol>
      )}>
      {chart}
    </ChartCard>
  );
}

/** Fixed categorical slots for metrics that share a chart, so a metric keeps its colour wherever it appears. */
export const METRIC_SLOT = { mood: 0, energy: 1, focus: 2, appetite: 3, systolic: 4, diastolic: 5 } as const;
