// Weight path through the plan: recent weigh-ins, then where the trend is heading for the next weeks (dashed), with its
// likely range (dotted) and the goal if one is set. From the person's own rate on each dose step.
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { BodyEntry } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import type { WeightPath } from '../../logic/predict';
import { seriesOf } from '../../logic/forecast';
import { kgTo, weightUnit } from '../../logic/units';
import { baseOptions, timeAxis, useChartTheme } from './setup';

const DAY = 86_400_000;

export default function WeightPathChart({ path, body, units, now }: { path: WeightPath; body: BodyEntry[]; units: Units; now: number }) {
  const th = useChartTheme();
  const from = now - 42 * DAY;
  const to = path.points[path.points.length - 1].t;
  const u = weightUnit(units);
  const show = (kg: number) => kgTo(kg, units);
  const logged = seriesOf(body, 'weightKg').filter((p) => p.t >= from && p.t <= now + DAY);
  const datasets = [
    { label: 'Logged', data: logged.map((p) => ({ x: p.t, y: show(p.v) })), showLine: false, pointRadius: 2.5, pointBackgroundColor: th.muted, pointBorderWidth: 0 },
    { label: 'Path', data: path.points.map((p) => ({ x: p.t, y: show(p.v) })), borderColor: th.text, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
    { label: 'Likely range', data: path.points.map((p) => ({ x: p.t, y: show(p.low) })), borderColor: th.muted, borderWidth: 1, borderDash: [2, 3], pointRadius: 0 },
    { label: '', data: path.points.map((p) => ({ x: p.t, y: show(p.high) })), borderColor: th.muted, borderWidth: 1, borderDash: [2, 3], pointRadius: 0 },
    ...(path.goal ? [{ label: 'Goal', data: [{ x: from, y: show(path.goal.target) }, { x: to, y: show(path.goal.target) }], borderColor: th.series[1], borderWidth: 1.5, borderDash: [2, 4], pointRadius: 0, pointHitRadius: 0 }] : []),
  ];
  return (
    <div style={{ height: 170 }} role="img" aria-label={`Weight path: about ${show(path.points[path.points.length - 1].v)} ${u} in ${path.points.length - 1} weeks if the trend continues, likely between ${show(path.points[path.points.length - 1].low)} and ${show(path.points[path.points.length - 1].high)}.`} key={th.key}>
      <Line
        data={{ datasets }}
        options={{ ...baseOptions(th),
          plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: {
            title: (c) => format(c[0].parsed.x as number, 'EEE d MMM'),
            label: (c) => `${c.dataset.label || 'Likely range'}: ${(c.parsed.y as number).toFixed(1)} ${u}`,
          } } },
          scales: { x: timeAxis(th, from, to), y: { ...baseOptions(th).scales.y, grace: '5%', ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 4 } } } }}
      />
    </div>
  );
}
