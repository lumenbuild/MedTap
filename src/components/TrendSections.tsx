// Trends sections that each cover several things in one place: daily habits behind one picker, and what was noticed
// most in check-ins (shown under "How you've felt").
import { useState } from 'react';
import type { CheckIn, FoodLog } from '../db/schema';
import type { HabitKey, HabitSeries } from '../logic/dailyHabits';
import { totalsFor, type EnergyUnit } from '../logic/nutrition';
import { chipCounts, rollingAverage } from '../logic/stats';
import { format } from 'date-fns';
import { ChartCard, type Headline } from './charts/ChartCard';
import { TrendChart } from './charts/TrendChart';
import { ChipPicker } from './ui/Field';
import { Bar } from './ui/Visual';

const KJ = 4.184;
const r = (dp: number) => (v: number) => Math.round(v * 10 ** dp) / 10 ** dp;
/** How each habit is shown: stored value to the number charted, its unit, and the words after an average. */
function look(key: HabitKey, energy: EnergyUnit): { show: (v: number) => number; unit: string; per: string } {
  switch (key) {
    case 'energy': { const u = energy === 'kJ' ? 'kJ' : 'Cal'; return { show: (v) => Math.round(energy === 'kJ' ? v * KJ : v), unit: u, per: `${u} a day` }; }
    case 'protein': return { show: r(0), unit: 'g', per: 'g a day' };
    case 'water': return { show: (v) => r(1)(v / 1000), unit: 'L', per: 'L a day' };
    case 'caffeine': return { show: r(0), unit: 'mg', per: 'mg a day' };
    case 'steps': return { show: r(0), unit: 'steps', per: 'steps a day' };
    case 'sleep': return { show: r(1), unit: 'h', per: 'h a night' };
    case 'restingHr': return { show: r(0), unit: 'bpm', per: 'bpm on average' };
    case 'hrv': return { show: r(0), unit: 'ms', per: 'ms on average' };
    case 'readiness': return { show: r(0), unit: 'of 100', per: 'of 100 on average' };
  }
}
const num = (v: number) => v.toLocaleString('en-AU');

/** One chart for every daily habit with records: pick which. */
export function DailyHabitsCard({ habits, foodLogs, energy, start, end, prevDays }: {
  habits: HabitSeries[]; foodLogs: FoodLog[]; energy: EnergyUnit; start: number; end: number; prevDays: number | null;
}) {
  const [asked, setAsked] = useState<HabitKey | null>(() => { try { return localStorage.getItem('trendsHabit') as HabitKey | null; } catch { return null; } });
  if (!habits.length) return null;
  const h = habits.find((x) => x.key === asked) ?? habits[0];
  const pick = (k: HabitKey) => { setAsked(k); try { localStorage.setItem('trendsHabit', k); } catch { /* per-device preference only */ } };
  const { show, unit, per } = look(h.key, energy);
  const pts = h.days.map((d) => ({ t: d.t, v: show(d.v) }));
  const diff = h.prevAvg !== undefined ? r(1)(show(h.avg) - show(h.prevAvg)) : null;
  const headline: Headline = {
    value: num(show(h.avg)), unit: per,
    ...(diff !== null && prevDays ? { dir: diff === 0 ? 'flat' as const : diff > 0 ? 'up' as const : 'down' as const,
      delta: diff === 0 ? `same as the ${prevDays} days before` : `${diff > 0 ? 'up' : 'down'} ${num(Math.abs(diff))} on the ${prevDays} days before` } : {}),
  };
  const target = h.target !== undefined ? show(h.target) : undefined;
  const limit = h.limit !== undefined ? show(h.limit) : undefined;
  // Food: the average logged day's protein, carbs and fat as well.
  const food = h.key === 'energy' ? totalsFor(foodLogs, start, end) : null;
  const perDay = (v?: number) => Math.round((v ?? 0) / h.days.length);
  const summary = [
    `${h.days.length} day${h.days.length === 1 ? '' : 's'} with records`,
    h.onTarget !== undefined && target !== undefined ? `${h.onTarget} at your ${num(target)} ${unit}` : null,
    h.underLimit !== undefined && limit !== undefined ? `${h.underLimit} at or under your ${num(limit)} ${unit}` : null,
    food ? `an average day had ${perDay(food.protein)} g protein, ${perDay(food.carbs)} g carbs and ${perDay(food.fat)} g fat` : null,
  ].filter(Boolean).join(', ');
  return (
    <ChartCard title="Daily habits" height={null} headline={headline} summary={`${summary}.`}
      controls={habits.length > 1 && <ChipPicker label="Habit" value={h.key} onChange={pick} options={habits.map((x) => ({ value: x.key, label: x.label }))} />}
      table={{ head: ['Date', `${h.label} (${unit})`], rows: [...pts].reverse().map((p) => [format(p.t, 'EEE d MMM'), p.v]) }}>
      <TrendChart bare height={170} title={h.label} start={start} end={end} fmt={(v) => `${num(v)} ${unit}`}
        series={[
          { label: 'Each day', style: 'dots', points: pts },
          ...(pts.length >= 7 ? [{ label: '7-day average', style: 'line' as const, points: rollingAverage(pts) }] : []),
          ...(target !== undefined ? [{ label: 'Your target', style: 'goal' as const, points: [{ t: start, v: target }, { t: end, v: target }] }] : []),
          ...(limit !== undefined ? [{ label: 'Your limit', style: 'goal' as const, points: [{ t: start, v: limit }, { t: end, v: limit }] }] : []),
        ]} />
    </ChartCard>
  );
}

/** The check-in chips noted most often, as bars. */
export function NoticedBlock({ checkIns, start, end }: { checkIns: CheckIn[]; start: number; end: number }) {
  const counts = chipCounts(checkIns, start, end);
  if (!counts.length) return null;
  const top = counts.slice(0, 6);
  return (
    <div className="mt-5">
      <h3 className="font-medium mb-2">Noticed most</h3>
      <ul className="space-y-2">
        {top.map((c) => (
          <li key={c.chip} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm">
            <span className="truncate">{c.chip}</span>
            <Bar value={c.count} max={top[0].count} tone="plain" label={`${c.chip}: ${c.count} time${c.count === 1 ? '' : 's'}`} />
            <span className="tnum text-right">{c.count}</span>
          </li>
        ))}
      </ul>
      {counts.length > 6 && <p className="text-xs text-muted mt-1">The top 6 of {counts.length}.</p>}
    </div>
  );
}
