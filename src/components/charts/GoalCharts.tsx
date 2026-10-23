// Goal forecast for a body measure without a chart of its own (waist, body fat, lean mass): what was logged, the
// smoothed trend, the goal, and where the trend is heading. Weight's goal is drawn on the weight chart instead.
import type { BodyEntry, BodyGoal } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { smoothTrend } from '../../logic/forecast';
import { goalLine, goalView, valueFmt } from '../../screens/Body/Goals';
import { TrendChart } from './TrendChart';

const DAY = 86_400_000;

export function GoalForecastCharts({ goals, entries, units, now }: { goals: BodyGoal[]; entries: BodyEntry[]; units: Units; now: number }) {
  return (
    <>
      {goals.map((g) => {
        const v = goalView(g, entries, now);
        const u = valueFmt(g.metric, units);
        const { f } = v;
        const from = Math.min(new Date(`${g.startDate}T00:00`).getTime() - 7 * DAY, v.points[0]?.t ?? now);
        const to = Math.min(now + 730 * DAY, Math.max(now + 14 * DAY, (f.etaLate ?? f.eta ?? now) + 7 * DAY));
        const pts = v.points.filter((p) => p.t >= from);
        const trend = smoothTrend(v.points).filter((p) => p.t >= from);
        const name = `${u.name[0].toUpperCase()}${u.name.slice(1)}`;
        return (
          <TrendChart key={g.metric} title={name} unit={u.unit} start={from} end={to} summary={goalLine(v, units)}
            empty={pts.length ? null : `No ${u.name} logged since the goal was set.`}
            series={[
              { label: 'Logged', style: 'dots', points: pts.map((p) => ({ t: p.t, v: u.show(p.v) })) },
              { label: 'Trend', style: 'line', points: trend.map((p) => ({ t: p.t, v: u.show(p.v) })) },
              ...(f.eta && f.level !== undefined ? [{ label: 'Forecast', style: 'forecast' as const, noTable: true, points: [{ t: now, v: u.show(f.level) }, { t: f.eta, v: u.show(g.target) }] }] : []),
              { label: 'Goal', style: 'goal', points: [{ t: from, v: u.show(g.target) }, { t: to, v: u.show(g.target) }] },
            ]} />
        );
      })}
    </>
  );
}
