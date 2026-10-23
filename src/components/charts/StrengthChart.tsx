// A lift's best estimated max each session, with the goal (if set) and where the trend is heading.
import type { Pt, Forecast } from '../../logic/forecast';
import type { Units } from '../../db/repos/settings';
import { loadUnit, showLoad } from '../../logic/load';
import { TrendChart } from './TrendChart';

const DAY = 86_400_000;

export default function StrengthChart({ points, target, f, now, units = 'metric', unitLabel }: { points: Pt[]; target?: number; f?: Forecast; now: number; units?: Units; unitLabel?: string }) {
  // Shown in the person's units (or as reps / seconds for bodyweight and timed exercises).
  const v = (kg: number) => (unitLabel ? kg : showLoad(kg, units));
  const u = unitLabel ?? loadUnit(units);
  const from = points[0]?.t ?? now - 60 * DAY;
  const to = Math.max(now + 7 * DAY, f?.eta ? Math.min(f.eta + 7 * DAY, now + 365 * DAY) : 0);
  return (
    <TrendChart bare height={170} title="Estimated max" unit={u} start={from} end={to}
      series={[
        { label: 'Estimated max', style: 'line', points: points.map((p) => ({ t: p.t, v: v(p.v) })) },
        ...(f?.eta && f.level !== undefined && target ? [{ label: 'Trend', style: 'forecast' as const, points: [{ t: now, v: v(f.level) }, { t: f.eta, v: v(target) }] }] : []),
        ...(target ? [{ label: 'Goal', style: 'goal' as const, points: [{ t: from, v: v(target) }, { t: to, v: v(target) }] }] : []),
      ]} />
  );
}
