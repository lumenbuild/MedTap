// A lift's best estimated max each session, with the goal (if set) and where the trend is heading.
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { Pt } from '../../logic/forecast';
import type { Forecast } from '../../logic/forecast';
import { baseOptions, timeAxis, useChartTheme } from './setup';

const DAY = 86_400_000;

export default function StrengthChart({ points, target, f, now }: { points: Pt[]; target?: number; f?: Forecast; now: number }) {
  const th = useChartTheme();
  const from = points[0]?.t ?? now - 60 * DAY;
  const to = Math.max(now + 7 * DAY, f?.eta ? Math.min(f.eta + 7 * DAY, now + 365 * DAY) : 0);
  const datasets = [
    { label: 'Estimated max', data: points.map((p) => ({ x: p.t, y: p.v })), borderColor: th.text, borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: th.text, tension: 0.2 },
    ...(target ? [{ label: 'Goal', data: [{ x: from, y: target }, { x: to, y: target }], borderColor: th.series[1], borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0 }] : []),
    ...(f?.eta && f.level !== undefined && target ? [{ label: 'Trend', data: [{ x: now, y: f.level }, { x: f.eta, y: target }], borderColor: th.muted, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] : []),
  ];
  return (
    <div style={{ height: 170 }} role="img" aria-label={`Estimated max each session, latest ${points[points.length - 1]?.v ?? '–'} kg`} key={th.key}>
      <Line data={{ datasets }} options={{ ...baseOptions(th),
        plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { title: (c) => format(c[0].parsed.x as number, 'EEE d MMM'), label: (c) => `${c.dataset.label}: ${(c.parsed.y as number).toFixed(1)} kg` } } },
        scales: { x: timeAxis(th, from, to), y: { ...baseOptions(th).scales.y, grace: '8%', ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 4 } } } }} />
    </div>
  );
}
