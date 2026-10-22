// Estimated level for one peptide: the last four weeks from the doses taken, then six weeks ahead from the plan
// (including planned dose changes), dashed. A simple model on the person's own half-life figure, not a measurement.
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { Dose, Medication } from '../../db/schema';
import type { ScheduleSettings } from '../../logic/schedule';
import { projectedLevel } from '../../logic/protocol';
import { fmtAmount } from '../../logic/format';
import { baseOptions, timeAxis, useChartTheme } from './setup';

const DAY = 86_400_000;

export default function LevelProjection({ med, doses, s, now }: { med: Medication; doses: Dose[]; s: ScheduleSettings; now: number }) {
  const th = useChartTheme();
  const from = now - 28 * DAY;
  const to = now + 42 * DAY;
  const { past, future } = projectedLevel(med, doses, now, s, from, to);
  if (!past.length && !future.length) return null;
  const peak = (pts: { v: number }[]) => Math.max(0, ...pts.map((p) => p.v));
  const nowV = past[past.length - 1]?.v ?? 0;
  const r3 = (v: number) => (v >= 10 ? Math.round(v * 10) / 10 : v >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);
  const summary = `About ${fmtAmount(r3(nowV), med.unit)} now. With your plan, peaks of about ${fmtAmount(r3(peak(future)), med.unit)} over the next 6 weeks.`;
  return (
    <figure className="space-y-2" key={th.key}>
      <figcaption className="text-sm text-muted">Estimated level · {summary}</figcaption>
      <div style={{ height: 150 }} role="img" aria-label={`Estimated level of ${med.name}. ${summary} An estimate from your half-life figure, not a measurement.`}>
        <Line
          data={{ datasets: [
            { label: 'Taken', data: past.map((p) => ({ x: p.t, y: p.v })), borderColor: th.text, borderWidth: 2, pointRadius: 0, tension: 0.2 },
            { label: 'Plan', data: future.map((p) => ({ x: p.t, y: p.v })), borderColor: th.muted, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
          ] }}
          options={{ ...baseOptions(th),
            plugins: { ...baseOptions(th).plugins, tooltip: { ...baseOptions(th).plugins.tooltip, callbacks: {
              title: (c) => format(c[0].parsed.x as number, 'EEE d MMM'),
              label: (c) => `${c.dataset.label}: about ${(c.parsed.y as number).toFixed(2)} ${med.unit}`,
            } } },
            scales: { x: timeAxis(th, from, to), y: { ...baseOptions(th).scales.y, min: 0, ticks: { ...baseOptions(th).scales.y.ticks, maxTicksLimit: 3 } } } }}
        />
      </div>
      <p className="text-xs text-muted">Solid: from doses taken. Dashed: if you follow your plan. An estimate from your half-life figure, not a measurement.</p>
    </figure>
  );
}
