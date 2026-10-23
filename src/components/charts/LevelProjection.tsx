// Estimated level for one peptide, its only chart: the last four weeks from the doses taken, then six weeks ahead from
// the plan (including planned dose changes), dashed. From the person's own half-life figure.
import type { Dose, Medication } from '../../db/schema';
import type { ScheduleSettings } from '../../logic/schedule';
import { projectedLevel } from '../../logic/protocol';
import { fmtAmount } from '../../logic/format';
import { TrendChart } from './TrendChart';

const DAY = 86_400_000;
const r3 = (v: number) => (v >= 10 ? Math.round(v * 10) / 10 : v >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);

export default function LevelProjection({ med, doses, s, now }: { med: Medication; doses: Dose[]; s: ScheduleSettings; now: number }) {
  const from = now - 28 * DAY;
  const to = now + 42 * DAY;
  const { past, future } = projectedLevel(med, doses, now, s, from, to);
  if (!past.length && !future.length) return null;
  const nowV = past[past.length - 1]?.v ?? 0;
  const peak = Math.max(0, ...future.map((p) => p.v));
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">Estimated level</span>
        <span className="text-sm tnum"><span className="font-semibold">{fmtAmount(r3(nowV), med.unit)}</span> now · peak {fmtAmount(r3(peak), med.unit)}</span>
      </figcaption>
      <TrendChart bare height={150} title="Estimated level" unit={med.unit} start={from} end={to} yMin={0} fmt={(v) => `about ${r3(v)} ${med.unit}`}
        series={[
          { label: 'Taken', style: 'line', points: past },
          { label: 'Plan', style: 'forecast', points: future },
        ]} />
    </figure>
  );
}
