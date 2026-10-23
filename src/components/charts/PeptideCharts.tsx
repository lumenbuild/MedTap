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
            <h2 className="text-sm font-medium text-muted">Dose levels: {shownName(m)}</h2>
            <p className="text-muted">Weight and check-ins while you were on each dose. What you've recorded, side by side; it doesn't show cause.</p>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-sm tnum">
                <thead><tr>{['Dose', 'From', 'Doses', 'Weight', `${u}/week`, 'Appetite', 'Noticed'].map((h) => <th key={h} className="text-left font-semibold py-1.5 pr-3 border-b border-border">{h}</th>)}</tr></thead>
                <tbody>
                  {[...levels].reverse().map((l) => (
                    <tr key={l.from}>
                      <td className="py-1.5 pr-3 border-b border-border font-semibold whitespace-nowrap">{fmtAmount(l.dose, m.unit)}</td>
                      <td className="py-1.5 pr-3 border-b border-border whitespace-nowrap">{format(l.from, 'd MMM')}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{l.doses}</td>
                      <td className="py-1.5 pr-3 border-b border-border whitespace-nowrap">{l.weightStart !== undefined ? `${fmtWeight(l.weightStart, units)} → ${fmtWeight(l.weightEnd!, units)}` : '–'}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{l.perWeek !== undefined ? `${l.perWeek > 0 ? '+' : ''}${kgTo(l.perWeek, units)}` : '–'}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{l.appetite ?? '–'}</td>
                      <td className="py-1.5 pr-3 border-b border-border">{l.noticed.map((x) => `${x.chip} (${x.n})`).join(', ') || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Appetite: check-in average, 1–5</p>
          </Card>
        );
      })}
    </>
  );
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
          <ChartCard key={`${m.id}-${th.key}`} title={`Blend: ${shownName(m)}`}
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
