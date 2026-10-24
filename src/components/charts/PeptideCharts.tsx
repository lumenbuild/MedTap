// Peptide tools charts: estimated level, what happened at each dose, and blend amounts.
import { Bar } from 'react-chartjs-2';
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { blendAmounts, doseLevels } from '../../logic/peptide';
import { fmtAmount } from '../../logic/format';
import { fmtWeight, kgTo, weightUnit } from '../../logic/units';
import { ymdToMs } from '../../logic/stats';
import { shownName } from '../../logic/privacy';
import { Card } from '../ui/Card';
import { ChartCard } from './ChartCard';
import { baseOptions, timeAxis, useChartTheme } from './setup';
import type { RangeProps } from './Charts';

const fmtDay = (t: number) => format(t, 'EEE d MMM');

/** For each injected medication: each dose level, how weight changed and what check-ins noted. */
export function DoseLevelsCards({ meds, doses, body, checkIns, units, now }: { meds: Medication[]; doses: Dose[]; body: BodyEntry[]; checkIns: CheckIn[]; units: Units; now: number }) {
  const weights = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: ymdToMs(b.date), kg: b.weightKg! }));
  const u = weightUnit(units);
  return (
    <>
      {meds.filter((m) => m.peptide).map((m) => {
        const levels = doseLevels(doses.filter((d) => d.medicationId === m.id), weights, checkIns, now);
        if (!levels.length) return null;
        return (
          <Card key={m.id} className="space-y-2">
            <h2 className="text-sm font-medium text-muted">Dose levels{meds.length > 1 ? `: ${shownName(m)}` : ''}</h2>
            <p className="text-sm text-muted">Weight and check-ins on each dose, newest first.</p>
            <ul className="space-y-3">
              {[...levels].reverse().map((l) => {
                const maxRate = Math.max(0.1, ...levels.map((x) => Math.abs(x.perWeek ?? 0)));
                return (
                  <li key={l.from} className="rounded-card bg-surface-2 p-3 tnum">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="text-[17px] font-semibold">{fmtAmount(l.dose, m.unit)}</span>
                      <span className="text-sm text-muted">from {format(l.from, 'd MMM')} · {l.doses} dose{l.doses === 1 ? '' : 's'}</span>
                    </p>
                    {l.weightStart !== undefined && (
                      <div className="mt-2">
                        <p className="flex justify-between text-sm"><span>{fmtWeight(l.weightStart, units)} → {fmtWeight(l.weightEnd!, units)}</span>
                          {l.perWeek !== undefined && <span className="font-medium">{l.perWeek > 0 ? '+' : l.perWeek < 0 ? '−' : ''}{Math.abs(kgTo(l.perWeek, units))} {u} a week</span>}</p>
                        {l.perWeek !== undefined && <div className="h-2 rounded-full bg-surface mt-1" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${(Math.abs(l.perWeek) / maxRate) * 100}%`, background: l.perWeek <= 0 ? 'var(--text)' : 'var(--border-strong)' }} /></div>}
                      </div>
                    )}
                    {(l.appetite !== undefined || l.noticed.length > 0) && (
                      <p className="text-sm mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {l.appetite !== undefined && <span className="inline-flex items-center gap-1.5">Appetite <Dots v={l.appetite} /> <span className="text-muted">{l.appetite}</span></span>}
                        {l.noticed.map((x) => <span key={x.chip} className="text-muted">{x.chip} ×{x.n}</span>)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </>
  );
}

/** A 1–5 average as five dots, filled up to the value. */
function Dots({ v }: { v: number }) {
  return <span role="img" aria-label={`${v} of 5`} className="inline-flex gap-0.5">{[1, 2, 3, 4, 5].map((i) => <span key={i} className="w-2 h-2 rounded-full" style={{ background: v >= i - 0.25 ? 'var(--text)' : 'var(--border-strong)' }} />)}</span>;
}

/** Blends: how much of each peptide was taken each day. */
export function BlendCharts({ meds, doses, start, end }: RangeProps & { meds: Medication[]; doses: Dose[] }) {
  const th = useChartTheme();
  return (
    <>
      {meds.filter((m) => m.peptide?.blend?.length).map((m) => {
        const inRange = doses.filter((d) => d.medicationId === m.id && !d.skipped && !d.deletedAt && Date.parse(d.takenAt) >= start && Date.parse(d.takenAt) <= end);
        const parts = blendAmounts(m, 1);
        const names = parts.map((b) => `${b.name} (${b.unit})`);
        const byDay = new Map<string, number[]>();
        for (const d of inRange) {
          const key = format(Date.parse(d.takenAt), 'yyyy-MM-dd');
          const row = byDay.get(key) ?? names.map(() => 0);
          blendAmounts(m, d.amount).forEach((b, i) => { row[i] = Math.round((row[i] + b.amount) * 1000) / 1000; });
          byDay.set(key, row);
        }
        const days = [...byDay.keys()].sort();
        const totals = names.map((_, i) => days.reduce((n, k) => n + byDay.get(k)![i], 0));
        return (
          <ChartCard key={`${m.id}-${th.key}`} title={meds.length > 1 ? `Blend: ${shownName(m)}` : 'Blend'}
            empty={days.length ? null : 'No doses in this range.'}
            summary={`In this range: ${parts.map((b, i) => `${fmtAmount(Math.round(totals[i] * 1000) / 1000, b.unit)} ${b.name}`).join(', ')}.`}
            table={{ head: ['Date', ...names], rows: [...days].reverse().map((k) => [fmtDay(ymdToMs(k)), ...byDay.get(k)!]) }}>
            <Bar
              data={{ datasets: names.map((n, i) => ({ label: n, data: days.map((k) => ({ x: ymdToMs(k), y: byDay.get(k)![i] })), backgroundColor: th.series[i % th.series.length], borderRadius: 3, maxBarThickness: 18 })) }}
              options={{ ...baseOptions(th),
                plugins: { ...baseOptions(th).plugins, legend: { ...baseOptions(th).plugins.legend, display: true, position: 'top', align: 'start' } },
                scales: { x: timeAxis(th, start, end), y: { ...baseOptions(th).scales.y, min: 0 } } }}
            />
          </ChartCard>
        );
      })}
    </>
  );
}
