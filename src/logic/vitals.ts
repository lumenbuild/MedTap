// Overnight vitals from the watch (blood oxygen, breathing rate, skin temperature, heart rate variability and resting
// heart rate), each against the person's own usual, and a watch for the pattern where several move the wrong way
// together, which often comes a day or two before feeling unwell. From their own data; a nudge, not a diagnosis. Pure.
import type { DailyHealth } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const live = (d: DailyHealth) => !d.deletedAt;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ymdMs = (d: string) => new Date(`${d}T12:00`).getTime();

export type VitalKey = 'hrvMs' | 'restingHr' | 'respRate' | 'spo2Avg' | 'skinTempDelta';
export interface VitalStat {
  key: VitalKey; label: string; unit: string; value: number;
  /** The median of the 30 nights before (5+ nights), and the difference from it. */
  usual?: number; diff?: number;
  /** Within the person's normal range (or the better side of it). */
  ok: boolean;
  series: { t: number; v: number }[];
}

const DEFS: { key: VitalKey; label: string; unit: string; dp: number; okFn: (v: number, usual: number | undefined) => boolean }[] = [
  { key: 'hrvMs', label: 'HRV', unit: 'ms', dp: 0, okFn: (v, u) => u === undefined || v >= u * 0.85 },
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', dp: 0, okFn: (v, u) => u === undefined || v <= u + 3 },
  { key: 'respRate', label: 'Breathing rate', unit: 'a min', dp: 1, okFn: (v, u) => u === undefined || v <= u + 1 },
  { key: 'spo2Avg', label: 'Blood oxygen', unit: '%', dp: 1, okFn: (v, u) => v >= 94 && (u === undefined || v >= u - 1.5) },
  // Skin temperature already comes as the difference from the watch's own baseline.
  { key: 'skinTempDelta', label: 'Skin temperature', unit: '°C', dp: 1, okFn: (v) => Math.abs(v) < 0.5 },
];

/** The rows with a value for `key`, oldest first. */
const seriesOf = (rows: DailyHealth[], key: VitalKey) => rows.filter((d) => typeof d[key] === 'number').map((d) => ({ date: d.date, v: d[key] as number }));

/** Last night's vitals (within the last day and a half), each against the 30 nights before. */
export function nightVitals(daily: DailyHealth[], now: number, s: ScheduleSettings): { date: string; stats: VitalStat[] } | null {
  const rows = daily.filter(live).sort((a, b) => a.date.localeCompare(b.date));
  const todayK = dayKey(now, s);
  const stats: VitalStat[] = [];
  let date = '';
  for (const def of DEFS) {
    const ser = seriesOf(rows, def.key).filter((x) => x.date <= todayK);
    const last = ser[ser.length - 1];
    if (!last || now - ymdMs(last.date) > 1.5 * DAY) continue;
    const before = ser.filter((x) => x.date < last.date && ymdMs(x.date) > ymdMs(last.date) - 31 * DAY).map((x) => x.v);
    const usual = before.length >= 5 ? median(before) : undefined;
    const round = (v: number) => Math.round(v * 10 ** def.dp) / 10 ** def.dp;
    stats.push({ key: def.key, label: def.label, unit: def.unit, value: round(last.v), usual: usual === undefined ? undefined : round(usual),
      diff: usual === undefined ? undefined : round(last.v - usual), ok: def.okFn(last.v, usual),
      series: ser.filter((x) => ymdMs(x.date) > now - 31 * DAY).map((x) => ({ t: ymdMs(x.date), v: x.v })) });
    if (last.date > date) date = last.date;
  }
  return stats.length ? { date, stats } : null;
}

export interface IllnessWatch {
  /** 'watch': two signals off together; 'likely': three or more, or two on two nights running. */
  level: 'watch' | 'likely';
  signals: string[];
  date: string;
}

/** Signals off a night: skin temperature 0.5 °C+ warmer, resting heart rate 5+ above usual, breathing 1.5+ faster,
 *  HRV 20%+ lower, blood oxygen 1.5+ points lower. */
function offSignals(rows: DailyHealth[], i: number): string[] {
  const row = rows[i];
  const before = rows.slice(0, i).filter((d) => ymdMs(d.date) > ymdMs(row.date) - 31 * DAY);
  const usual = (k: VitalKey) => { const v = before.map((d) => d[k]).filter((x): x is number => typeof x === 'number'); return v.length >= 5 ? median(v) : undefined; };
  const out: string[] = [];
  if (typeof row.skinTempDelta === 'number' && row.skinTempDelta >= 0.5) out.push(`Skin temperature +${row.skinTempDelta.toFixed(1)} °C`);
  const rhr = usual('restingHr'); if (rhr !== undefined && typeof row.restingHr === 'number' && row.restingHr - rhr >= 5) out.push(`Resting heart rate +${Math.round(row.restingHr - rhr)} bpm`);
  const rr = usual('respRate'); if (rr !== undefined && typeof row.respRate === 'number' && row.respRate - rr >= 1.5) out.push(`Breathing +${(row.respRate - rr).toFixed(1)} a minute`);
  const hv = usual('hrvMs'); if (hv !== undefined && typeof row.hrvMs === 'number' && row.hrvMs <= hv * 0.8) out.push(`HRV ${Math.round((1 - row.hrvMs / hv) * 100)}% lower`);
  const ox = usual('spo2Avg'); if (ox !== undefined && typeof row.spo2Avg === 'number' && ox - row.spo2Avg >= 1.5) out.push(`Blood oxygen ${(ox - row.spo2Avg).toFixed(1)} points lower`);
  return out;
}

/** Last night (within a day and a half): several overnight signals off together. */
export function illnessWatch(daily: DailyHealth[], now: number, s: ScheduleSettings): IllnessWatch | null {
  const rows = daily.filter(live).filter((d) => d.date <= dayKey(now, s)).sort((a, b) => a.date.localeCompare(b.date));
  const i = rows.length - 1;
  if (i < 0 || now - ymdMs(rows[i].date) > 1.5 * DAY) return null;
  const tonight = offSignals(rows, i);
  if (tonight.length < 2) return null;
  const prev = i > 0 && ymdMs(rows[i].date) - ymdMs(rows[i - 1].date) <= 1.5 * DAY ? offSignals(rows, i - 1) : [];
  return { level: tonight.length >= 3 || prev.length >= 2 ? 'likely' : 'watch', signals: tonight, date: rows[i].date };
}
