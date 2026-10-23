// Goal forecast: weigh-ins, the smoothed trend, the goal, and where the trend is heading (with its likely range).
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { BodyEntry, BodyGoal } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { smoothTrend } from '../../logic/forecast';
import { goalLine, goalView, valueFmt } from '../../screens/Body/Goals';
import { ChartCard } from './ChartCard';
import { baseOptions, timeAxis, useChartTheme } from './setup';

const DAY = 86_400_000;

export function GoalForecastCharts({ goals, entries, units, now }: { goals: BodyGoal[]; entries: BodyEntry[]; units: Units; now: number }) {
  const th = useChartTheme();
  return (
    <>
      {goals.map((g) => {
        const v = goalView(g, entries, now);
        const u = valueFmt(g.metric, units);
        const { f } = v;
        const from = Math.min(new Date(`${g.startDate}T00:00`).getTime() - 7 * DAY, v.points[0]?.t ?? now);
        const horizon = f.etaLate ?? f.eta;
        const to = Math.min(now + 730 * DAY, Math.max(now + 14 * DAY, (horizon ?? now) + 7 * DAY));
        const pts = v.points.filter((p) => p.t >= from);
        const trend = smoothTrend(v.points).filter((p) => p.t >= from);
        const line = (t1: number | undefined) => (f.level !== undefined && t1 ? [{ x: now, y: u.show(f.level) }, { x: t1, y: u.show(g.target) }] : []);
        const datasets = [
          { label: 'Goal', data: [{ x: from, y: u.show(g.target) }, { x: to, y: u.show(g.target) }], borderColor: th.series[1], borderDash: [2, 4], borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0 },
          { label: 'Trend', data: trend.map((p) => ({ x: p.t, y: u.show(p.v) })), borderColor: th.series[0], borderWidth: 2.5, pointRadius: 0, pointHitRadius: 6, tension: 0.3 },
          { label: 'Logged', data: pts.map((p) => ({ x: p.t, y: u.show(p.v) })), showLine: false, pointRadius: 3, pointBackgroundColor: th.muted, pointBorderWidth: 0 },
          ...(f.eta ? [
            { label: 'Forecast', data: line(f.eta), borderColor: th.series[0], borderDash: [6, 4], borderWidth: 2, pointRadius: [0, 4], pointBackgroundColor: th.series[0] },
            { label: 'Likely range', data: line(f.etaEarly), borderColor: th.muted, borderDash: [2, 3], borderWidth: 1, pointRadius: 0, pointHitRadius: 0 },
            ...(f.etaLate ? [{ label: '', data: line(f.etaLate), borderColor: th.muted, borderDash: [2, 3], borderWidth: 1, pointRadius: 0, pointHitRadius: 0 }] : []),
          ] : []),
        ];
        return (
          <ChartCard key={`${g.metric}-${th.key}`} title={`${u.name[0].toUpperCase()}${u.name.slice(1)} goal forecast`}
            empty={pts.length ? null : `No ${u.name} logged since the goal was set.`}
            summary={goalLine(v, units)}
            table={{ head: ['Date', `Logged (${u.unit})`, `Trend (${u.unit})`], rows: [...pts].reverse().map((p) => [format(p.t, 'EEE d MMM'), u.show(p.v), u.show(trend.find((x) => x.t === p.t)?.v ?? p.v)]) }}>
            <Line
              data={{ datasets }}
              options={{ ...baseOptions(th),
                plugins: { ...baseOptions(th).plugins,
                  legend: { ...baseOptions(th).plugins.legend, display: true, position: 'top', align: 'start', labels: { ...baseOptions(th).plugins.legend?.labels, filter: (item) => !!item.text } },
                  tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label || 'Range'}: ${(c.parsed.y as number).toFixed(1)} ${u.unit}` } } },
                scales: { x: timeAxis(th, from, to), y: { ...baseOptions(th).scales.y, grace: '5%', ticks: { ...baseOptions(th).scales.y.ticks, callback: (val) => `${val} ${u.unit}` } } } }}
            />
          </ChartCard>
        );
      })}
    </>
  );
}
