import { useEffect, useState } from 'react';
import {
  BarElement, CategoryScale, Chart, Filler, Legend, LinearScale, LineElement, PointElement, TimeScale, Tooltip, type Plugin,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { enAU } from 'date-fns/locale';
import { resolveColour } from '../../logic/palette';

Chart.register(BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, TimeScale, Tooltip);

export const DATE_LOCALE = enAU;

/** Vertical markers (medication changes, the user's interval) drawn as hairlines with a small numbered tag. */
export interface VLine { x: number; label?: string }
export const vlinesPlugin: Plugin<'line' | 'bar' | 'scatter'> = {
  id: 'vlines',
  afterDatasetsDraw(chart, _args, opts: { lines?: VLine[]; color?: string; text?: string }) {
    const lines = opts?.lines ?? [];
    if (!lines.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = opts.color ?? '#888';
    ctx.fillStyle = opts.text ?? '#333';
    ctx.font = '600 11px "Geist Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of lines) {
      const px = x.getPixelForValue(l.x);
      if (px < chartArea.left - 1 || px > chartArea.right + 1) continue;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top + (l.label ? 14 : 0));
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      if (l.label) ctx.fillText(l.label, px, chartArea.top + 10);
    }
    ctx.restore();
  },
};
Chart.register(vlinesPlugin);

/** Value at the tip of each horizontal bar, in text colour (never the series colour). */
export const barValuesPlugin: Plugin<'bar'> = {
  id: 'barValues',
  afterDatasetsDraw(chart, _args, opts: { color?: string; enabled?: boolean }) {
    if (!opts?.enabled) return;
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = opts.color ?? '#333';
    ctx.font = '600 12px "Geist Variable", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i];
      ctx.fillText(String(v), bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};
Chart.register(barValuesPlugin);

export interface ChartTheme {
  key: string; text: string; muted: string; grid: string; surface: string; series: string[]; reduceMotion: boolean;
}

function readTheme(): ChartTheme {
  const v = (n: string) => resolveColour(`var(${n})`);
  const series = Array.from({ length: 8 }, (_, i) => v(`--med-${i + 1}`));
  const dark = document.documentElement.dataset.theme === 'dark'
    || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  return {
    key: dark ? 'dark' : 'light', text: v('--text'), muted: v('--text-muted'), grid: v('--border'), surface: v('--surface'), series,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** Resolved colours for canvas charts; updates when the theme or OS appearance changes. */
export function useChartTheme(): ChartTheme {
  const [t, setT] = useState(readTheme);
  useEffect(() => {
    const update = () => setT(readTheme());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => { mo.disconnect(); mq.removeEventListener('change', update); };
  }, []);
  return t;
}

/** Shared options: recessive horizontal guides, muted ticks, Geist, tooltips on hover/tap, no motion if reduced. */
export function baseOptions(th: ChartTheme) {
  const font = { family: '"Geist Variable", system-ui, sans-serif', size: 12 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: th.reduceMotion ? (false as const) : { duration: 250 },
    interaction: { mode: 'nearest' as const, intersect: false },
    plugins: {
      legend: { display: false, labels: { color: th.text, font, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
      tooltip: {
        backgroundColor: th.text, titleColor: th.surface, bodyColor: th.surface, padding: 10, cornerRadius: 10,
        titleFont: { ...font, weight: 600 as const }, bodyFont: font, displayColors: true, boxPadding: 4,
      },
    },
    scales: {
      // Horizontal guides only: values are read across, dates from the axis.
      x: { grid: { display: false, drawTicks: false }, border: { display: true, color: th.grid }, ticks: { color: th.muted, font, maxRotation: 0, autoSkipPadding: 20, padding: 8 } },
      y: { grid: { color: th.grid, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: th.muted, font, padding: 6 } },
    },
  };
}

export function timeAxis(th: ChartTheme, start: number, end: number) {
  const span = (end - start) / 86_400_000;
  return {
    ...baseOptions(th).scales.x,
    type: 'time' as const,
    min: start,
    max: end,
    adapters: { date: { locale: DATE_LOCALE } },
    time: { unit: span > 120 ? ('month' as const) : span > 21 ? ('week' as const) : ('day' as const), displayFormats: { day: 'd MMM', week: 'd MMM', month: 'MMM yy' }, tooltipFormat: 'EEE d MMM yyyy' },
  };
}

/** The canvas is a picture of numbers that are always given in words nearby (the card's summary, a labelled wrapper
 *  or a "Show as table"), so screen readers skip the canvas itself rather than meet an unlabelled image. */
Chart.register({
  id: 'a11yCanvas',
  afterInit(chart: Chart) { chart.canvas.removeAttribute('role'); chart.canvas.setAttribute('aria-hidden', 'true'); },
});
