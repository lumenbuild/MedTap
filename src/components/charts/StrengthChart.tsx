// A lift's best estimated max each session, with the goal (if set) and where the trend is heading.
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { Pt } from '../../logic/forecast';
import type { Forecast } from '../../logic/forecast';
import { baseOptions, timeAxis, useChartTheme } from './setup';
import type { Units } from '../../db/repos/settings';
import { loadUnit, showLoad } from '../../logic/load';

const DAY = 86_400_000;

export default function StrengthChart({ points, target, f, now, units = 'metric', unitLabel }: { points: Pt[]; target?: number; f?: Forecast; now: number; units?: Units; unitLabel?: string }) {
  const th = useChartTheme();
  // Shown in the person's units (or as reps / seconds for bodyweight and timed exercises).
  const v = (kg: number) => (unitLabel ? kg : showLoad(kg, units));
  const u = unitLabel ?? loadUnit(units);
  const from = points[0]?.t ?? now - 60 * DAY;
  const to = Math.max(now + 7 * DAY, f?.eta ? Math.min(f.eta + 7 * DAY, now + 365 * DAY) : 0);
  const datasets = [
    { label: 'Estimated max', data: points.map((p) => ({ x: p.t, y: v(p.v) })), borderColor: th.text, borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: th.text, tension: 0.2 },
    ...(target ? [{ label: 'Goal', data: [{ x: from, y: v(target) }, { x: to, y: v(target) }], borderColor: th.series[1], borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0 }] : []),
    ...(f?.eta && f.level !== undefined && target ? [{ label: 'Trend', data: [{ x: now, y: v(f.level) }, { x: f.eta, y: v(target) }], borderColor: th.muted, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] : []),
  ];
  return (
    <div style={{ height: 170 }} role="img" aria-label={`Estimated max each session, latest ${points.length ? v(points[points.length - 1].v) : '–'} ${u}`} key={th.key}>
      <Line data={{ datasets }} options={{ ...baseOptions(th),
        plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { title: (c) => format(c[0].parsed.x as number, 'EEE d MMM'), label: (c) => `${c.dataset.label}: ${(c.parsed.y as number).toFixed(1)} ${u}` } } },
        scales: { x: timeAxis(th, from, to), y: { ...baseOptions(th).scales.y, grace: '8%', ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 4 } } } }} />
    </div>
  );
}
