// The one time-series chart. Every "over time" view uses it, so marks, colour, tooltips and tables behave the same
// everywhere: one y-axis (its unit once, on the top tick); a single series in ink (the title names it); 2+ series in
// fixed categorical slots with labels at the line ends; lines without dots except the latest value, which is labelled;
// forecasts dashed after a "Today" line, likely ranges as a light wash, goals as a dotted ink line; a key above when
// there's more than one kind of mark; a crosshair on hover; and the same data as a table.
import type { ReactNode } from 'react';
import { Line } from 'react-chartjs-2';
import type { Plugin } from 'chart.js';
import { format } from 'date-fns';
import { ChartCard, ChartLegend, type Headline, type LegendItem } from './ChartCard';
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
  /** Shown under the chart (e.g. what's different during a stall). */
  extra?: ReactNode;
  /** Buttons under the chart, shown even when it's empty (Log weight). */
  actions?: ReactNode;
  /** The number the chart is about, big above it. */
  headline?: Headline | null;
  /** A light wash under a single line (default on). */
  wash?: boolean;
  /** Hide the date axis (a row in a stack of charts that share the bottom one's). */
  hideX?: boolean;
  /** Bare charts: leave out the key (the caller explains the marks). */
  noLegend?: boolean;
  /** How the value at a line's end is written (default: one decimal at most, no unit). */
  labelFmt?: (v: number) => string;
  /** Label the line's lowest or highest point too ("Lowest 91.8"), when it isn't the latest. */
  extreme?: 'min' | 'max';
  /** Milestones on the line: a ringed dot and a short tag ("−5 kg"). */
  tags?: { t: number; v: number; text: string }[];
  /** Where the goal is likely reached: a flag on the goal line at that date, or an arrow at the edge if it's beyond. */
  goalFlag?: { v: number; at?: number; text: string; below?: boolean };
}

const fmtDay = (t: number) => format(t, 'EEE d MMM');

/** A label at the end of each line (its name when lines share a chart, else its latest value), in text colour;
 *  skipped where labels would collide. */
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
      if (placed.some((y) => Math.abs(y - last.y) < 15)) return;
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

/** Milestone tags and the best point: a ringed dot on the line with a few words above it (or below, near the top). */
const pointTags: Plugin<'line'> = {
  id: 'pointTags',
  afterDatasetsDraw(chart, _a, opts: { tags?: { t: number; v: number; text: string }[]; text?: string; surface?: string; ink?: string }) {
    const tags = opts?.tags ?? [];
    if (!tags.length) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.font = '600 11px "Geist Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: { x: number; y: number }[] = [];
    for (const g of tags) {
      const x = scales.x.getPixelForValue(g.t), y = scales.y.getPixelForValue(g.v);
      if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) continue;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = opts.ink ?? '#111'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = opts.surface ?? '#fff'; ctx.stroke();
      const w = ctx.measureText(g.text).width + 8;
      const ty = y - 16 < chartArea.top + 8 ? y + 16 : y - 16;
      if (placed.some((p) => Math.abs(p.x - x) < w && Math.abs(p.y - ty) < 14)) continue;
      placed.push({ x, y: ty });
      const tx = Math.min(Math.max(x, chartArea.left + w / 2), chartArea.right - w / 2);
      ctx.fillStyle = opts.surface ?? '#fff';
      ctx.fillRect(tx - w / 2, ty - 8, w, 16);
      ctx.fillStyle = opts.text ?? '#111';
      ctx.fillText(g.text, tx, ty);
    }
    ctx.restore();
  },
};

/** The goal flag: where the goal is likely reached, on the goal line; past the edge, an arrow with the date. */
const goalFlag: Plugin<'line'> = {
  id: 'goalFlag',
  afterDatasetsDraw(chart, _a, opts: { v?: number; at?: number; text?: string; below?: boolean; color?: string; surface?: string }) {
    if (opts?.v === undefined || !opts.text) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(opts.v);
    if (y < chartArea.top || y > chartArea.bottom) return;
    const x = opts.at !== undefined ? scales.x.getPixelForValue(opts.at) : undefined;
    ctx.save();
    ctx.font = '600 11px "Geist Variable", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color ?? '#111';
    ctx.strokeStyle = opts.color ?? '#111';
    const label = (text: string, lx: number, align: CanvasTextAlign) => {
      const w = ctx.measureText(text).width;
      const left = align === 'right' ? lx - w : lx;
      // Above the goal line, or below it where the line comes from above (out of the forecast's way).
      const ty = opts.below ? y + 14 : y - 14;
      ctx.fillStyle = opts.surface ?? '#fff'; ctx.fillRect(left - 3, ty - 8, w + 6, 16);
      ctx.fillStyle = opts.color ?? '#111'; ctx.textAlign = align; ctx.fillText(text, lx, ty);
    };
    if (x !== undefined && x >= chartArea.left && x <= chartArea.right) {
      // A small flag on a pole at the date.
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 10, y - 14); ctx.lineTo(x, y - 10); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      label(opts.text, x > chartArea.right - 120 ? x - 4 : x + 14, x > chartArea.right - 120 ? 'right' : 'left');
    } else {
      // Beyond the chart: an arrow at the right edge, pointing on.
      const ax = chartArea.right;
      ctx.beginPath(); ctx.moveTo(ax - 8, y - 5); ctx.lineTo(ax, y); ctx.lineTo(ax - 8, y + 5); ctx.closePath(); ctx.fill();
      label(opts.text, ax - 12, 'right');
    }
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

/** "Today": a dashed line where the record ends and the forecast begins. */
const todayLine: Plugin<'line'> = {
  id: 'todayLine',
  afterDatasetsDraw(chart, _a, opts: { at?: number; color?: string; text?: string }) {
    if (!opts?.at) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(opts.at);
    if (x <= chartArea.left + 2 || x >= chartArea.right - 2) return;
    ctx.save();
    ctx.strokeStyle = opts.color ?? '#999';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, chartArea.top + 14); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.text ?? '#333';
    ctx.font = '500 11px "Geist Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Today', x, chartArea.top + 9);
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

  const short = p.labelFmt ?? ((v: number) => `${Number((Math.round(v * 10) / 10).toFixed(1)).toString()}`);
  const datasets = p.series.flatMap((s): Record<string, unknown>[] => {
    const c = colourOf(th, s, multi);
    const data = s.points.map((x) => ({ x: x.t, y: x.v }));
    const n = s.points.length;
    // Lines carry no dots (they read as breaks) except the latest value; a short record keeps its few dots.
    const isLast = (ctx: { dataIndex: number }) => ctx.dataIndex === n - 1;
    const lineDot = (r: number) => (ctx: { dataIndex: number }) => (isLast(ctx) ? r + 1 : n <= 12 ? r - 1 : 0);
    const base = { label: s.label, data, borderColor: c, backgroundColor: c, borderWidth: 2.5, borderCapStyle: 'round' as const, borderJoinStyle: 'round' as const, cubicInterpolationMode: 'monotone' as const,
      pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: th.surface, pointBorderWidth: 2, pointHitRadius: 12 };
    const lastV = n ? s.points[n - 1].v : 0;
    if (s.style === 'dots') return [{ ...base, order: 2, borderColor: `${c}8c`, backgroundColor: `${c}8c`, pointBackgroundColor: `${c}8c`, pointBorderWidth: 0, showLine: false, pointRadius: n > 30 ? 2.5 : 3.5 }];
    if (s.style === 'goal') return [{ ...base, borderWidth: 1.5, borderDash: [2, 4], pointHitRadius: 0, pointHoverRadius: 0, cubicInterpolationMode: 'default' as const, tension: 0, endLabel: `${s.label} ${short(lastV)}` }];
    if (s.style === 'forecast') {
      const band = s.band ?? [];
      return [
        ...(band.length ? [
          { label: '', data: band.map((b) => ({ x: b.t, y: b.low })), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: false, borderColor: 'transparent' },
          { label: 'Likely range', data: band.map((b) => ({ x: b.t, y: b.high })), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: '-1', borderColor: 'transparent', backgroundColor: `${th.muted}29` },
        ] : []),
        { ...base, borderWidth: 2, borderDash: [6, 4], pointRadius: (ctx: { dataIndex: number }) => (ctx.dataIndex === n - 1 ? 3.5 : 0), endLabel: multi ? undefined : short(lastV) },
      ];
    }
    // Only the latest dot gets a ring (a ring on every dot cuts the line into dashes). A single line gets a light wash
    // under it, fading to nothing at the bottom, so its shape reads at a glance.
    const wash = !multi && p.wash !== false ? {
      fill: 'start' as const,
      backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
        const area = ctx.chart.chartArea;
        if (!area) return 'transparent';
        const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, `${c}1f`); g.addColorStop(1, `${c}00`);
        return g;
      },
    } : {};
    return [{ ...base, ...wash, order: 0, borderWidth: 2.25, pointRadius: lineDot(3), pointBorderWidth: (ctx: { dataIndex: number }) => (isLast(ctx) ? 2 : 0), endLabel: multi ? s.label : short(lastV) }];
  });

  const legend: LegendItem[] = p.series.filter((s) => s.points.length).flatMap((s): LegendItem[] => {
    const c = colourOf(th, s, multi);
    if (s.style === 'dots') return [{ label: s.label, colour: `${c}8c`, kind: 'dot' }];
    if (s.style === 'goal') return [{ label: s.label, colour: c, kind: 'dotted' }];
    if (s.style === 'forecast') return [{ label: s.label, colour: c, kind: 'dashed' }, ...(s.band?.length ? [{ label: 'Likely range', colour: `${th.muted}40`, kind: 'band' as const }] : [])];
    return [{ label: s.label, colour: c, kind: 'line' }];
  });
  // The best point on the main line, labelled when it isn't the latest (the latest has its own label).
  const main = lines[0];
  const inView = main ? main.points.filter((x) => x.t >= p.start && x.t <= p.end) : [];
  const ext = p.extreme && inView.length >= 3 ? inView.reduce((m, x) => (p.extreme === 'min' ? x.v < m.v : x.v > m.v) ? x : m, inView[0]) : undefined;
  const tags = [...(p.tags ?? []), ...(ext && ext !== inView[inView.length - 1] ? [{ t: ext.t, v: ext.v, text: `${p.extreme === 'min' ? 'Lowest' : 'Highest'} ${short(ext.v)}` }] : [])];
  const fc = p.series.find((s) => s.style === 'forecast' && s.points.length);
  const today = fc ? fc.points[0].t : undefined;

  const times = [...new Set(p.series.filter((s) => !s.noTable && s.style !== 'goal').flatMap((s) => s.points.map((x) => Math.round(x.t / 3_600_000))))].sort((a, b) => b - a);
  const tableSeries = p.series.filter((s) => !s.noTable && s.style !== 'goal' && s.points.length);
  const table = { head: ['Date', ...tableSeries.map((s) => `${s.label}${p.unit ? ` (${p.unit})` : ''}`)],
    rows: times.map((h) => [fmtDay(h * 3_600_000), ...tableSeries.map((s) => { const x = s.points.find((q) => Math.round(q.t / 3_600_000) === h); return x ? Math.round(x.v * 100) / 100 : '–'; })]) };

  const o = baseOptions(th);
  const chart = (
    <Line
      data={{ datasets: datasets as never }}
      plugins={[endLabels, crosshair, todayLine, pointTags, goalFlag]}
      options={{ ...o,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { right: multi ? 64 : 36, top: today ? 4 : 0 } },
        plugins: { ...o.plugins,
          legend: { display: false },
          tooltip: { ...o.plugins.tooltip, mode: 'nearest', axis: 'x', intersect: false,
            filter: (i) => !!i.dataset.label && i.dataset.label !== 'Likely range',
            callbacks: { title: (c) => fmtDay(c[0].parsed.x as number), label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y as number)}` } },
          // @ts-expect-error custom plugin options
          endLabels: { enabled: true, text: th.text, surface: th.surface },
          crosshair: { color: th.muted },
          todayLine: { at: today, color: th.muted, text: th.muted },
          pointTags: { tags, text: th.text, surface: th.surface, ink: th.text },
          goalFlag: p.goalFlag ? { ...p.goalFlag, color: th.text, surface: th.surface } : {},
          // Numbered when the list under the chart explains them; a plain line in a compact chart.
          vlines: { lines: marks.map((m, i) => ({ x: m.at, label: p.bare ? undefined : String(i + 1) })), color: th.muted, text: th.text } },
        scales: { x: { ...timeAxis(th, p.start, p.end), display: !p.hideX },
          y: { ...o.scales.y, min: p.yMin, max: p.yMax, grace: p.yMin === undefined ? '5%' : 0,
            ticks: { ...o.scales.y.ticks, maxTicksLimit: (p.height ?? 300) < 120 ? 3 : 6, stepSize: p.step,
              // The unit once, on the top value.
              callback: (v, i, all) => `${Number(Number(v).toFixed(2))}${p.unit && i === all.length - 1 ? ` ${p.unit}` : ''}` } } } }}
    />
  );
  if (p.bare) return (
    <div key={th.key}>
      {!p.noLegend && legend.length > 1 && <div className="mb-2"><ChartLegend items={legend} /></div>}
      <div style={{ height: p.height ?? 200 }}>{chart}</div>
    </div>
  );
  return (
    <ChartCard title={p.title} key={th.key} height={p.height ?? 300} headline={p.headline} legend={legend} actions={p.actions} empty={any ? null : p.empty ?? 'Nothing logged in this range.'} summary={p.summary} table={table}
      footer={<>
        {marks.length > 0 && (
          <ol className="mt-3 space-y-1 text-sm">
            {marks.map((m, i) => <li key={i} className="flex gap-2"><span className="font-semibold tnum w-4">{i + 1}</span><span className="text-muted tnum">{format(m.at, 'd MMM')}</span><span>{m.text}</span></li>)}
          </ol>
        )}
        {p.extra}
      </>}>
      {chart}
    </ChartCard>
  );
}
