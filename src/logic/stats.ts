// Numbers behind the Trends charts and their one-line summaries. Pure: everything takes explicit times.
// Summaries describe the data only. They never interpret it.
import type { BodyEntry, CheckIn, Dose, Medication } from '../db/schema';
import { getDailyTarget, getDayBounds, type ScheduleSettings } from './schedule';
import { zonedParts } from './tz';

const DAY = 86_400_000;
export type Range = '7d' | '30d' | '90d' | 'all';
export const RANGE_DAYS: Record<Range, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

export interface Pt { t: number; v: number }

/** Start of the range, or the earliest data point for "All". */
export function rangeStart(range: Range, now: number, earliest: number | null): number {
  const days = RANGE_DAYS[range];
  if (days !== null) return now - days * DAY;
  return earliest ?? now - 30 * DAY;
}

/** The user's day (respecting dayStartsAt) as YYYY-MM-DD. */
export function dayKey(ms: number, s: ScheduleSettings): string {
  const p = zonedParts(getDayBounds(ms, s.dayStartsAt, s.tz).start, s.tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Noon on a local YYYY-MM-DD, as ms: a stable x position for a calendar date. */
export const ymdToMs = (ymd: string) => new Date(`${ymd}T12:00`).getTime();

/** Each user day from start to end, oldest first. */
export function daysBetween(start: number, end: number, s: ScheduleSettings): string[] {
  const out: string[] = [];
  let t = getDayBounds(start, s.dayStartsAt, s.tz).start;
  while (t < end) {
    out.push(dayKey(t, s));
    t = getDayBounds(t, s.dayStartsAt, s.tz).end;
  }
  return out;
}

export function bodySeries(entries: BodyEntry[], key: keyof BodyEntry, start: number, end: number): Pt[] {
  return entries
    .filter((e) => !e.deletedAt && typeof e[key] === 'number')
    .map((e) => ({ t: ymdToMs(e.date), v: e[key] as number }))
    .filter((p) => p.t >= start - DAY / 2 && p.t <= end + DAY / 2)
    .sort((a, b) => a.t - b.t);
}

/** Trailing average over `days` days for each point (uses all points, so the line starts sensibly). */
export function rollingAverage(points: Pt[], days = 7): Pt[] {
  return points.map((p) => {
    const win = points.filter((q) => q.t <= p.t && q.t > p.t - days * DAY);
    return { t: p.t, v: win.reduce((a, q) => a + q.v, 0) / win.length };
  });
}

/** "Down 1.8 kg over 30 days (7-day average)". Null without at least two weigh-ins. */
export function changeSummary(avg: Pt[], unitLabel: (v: number) => string, what = '7-day average'): string | null {
  if (avg.length < 2) return null;
  const a = avg[0], b = avg[avg.length - 1];
  const days = Math.max(1, Math.round((b.t - a.t) / DAY));
  const diff = b.v - a.v;
  if (Math.abs(diff) < 0.05) return `About the same over ${days} days (${what})`;
  return `${diff < 0 ? 'Down' : 'Up'} ${unitLabel(Math.abs(diff))} over ${days} day${days === 1 ? '' : 's'} (${what})`;
}

export interface DayCount { day: string; count: number; target?: number }

/** Doses per user day for a medication, against the user's own daily target. */
export function adherenceByDay(doses: Dose[], med: Medication, days: string[], s: ScheduleSettings): DayCount[] {
  const counts = new Map<string, number>();
  for (const d of doses) {
    if (d.deletedAt || d.medicationId !== med.id) continue;
    const k = dayKey(Date.parse(d.takenAt), s);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const target = getDailyTarget(med);
  return days.map((day) => ({ day, count: counts.get(day) ?? 0, target }));
}

/** Time of day each dose was taken, in hours (e.g. 13.5 = 1:30 pm), positioned on its user day. */
export function doseTimes(doses: Dose[], medId: string, start: number, end: number, s: ScheduleSettings): { t: number; hour: number }[] {
  return doses
    .filter((d) => !d.deletedAt && d.medicationId === medId)
    .map((d) => Date.parse(d.takenAt))
    .filter((t) => t >= start && t <= end)
    .map((t) => {
      const p = zonedParts(t, s.tz);
      return { t: ymdToMs(dayKey(t, s)), hour: p.h + p.mi / 60 };
    });
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Daily averages of one check-in field (mood, energy, focus, appetite). */
export function dailyAverages(checkIns: CheckIn[], field: 'mood' | 'energy' | 'focus' | 'appetite', start: number, end: number, s: ScheduleSettings): Pt[] {
  const by = new Map<string, number[]>();
  for (const c of checkIns) {
    const t = Date.parse(c.at);
    const v = c[field];
    if (c.deletedAt || v === undefined || t < start || t > end) continue;
    const k = dayKey(t, s);
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  return [...by.entries()].map(([k, vs]) => ({ t: ymdToMs(k), v: vs.reduce((a, b) => a + b, 0) / vs.length })).sort((a, b) => a.t - b.t);
}

export function average(checkIns: CheckIn[], field: 'mood' | 'energy' | 'focus' | 'appetite', start: number, end: number): number | null {
  const vs = checkIns.filter((c) => !c.deletedAt && c[field] !== undefined && Date.parse(c.at) >= start && Date.parse(c.at) <= end).map((c) => c[field]!);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

/** "Mood averaged 3.8, up from 3.2 in the 30 days before" */
export function averageSummary(label: string, cur: number | null, prev: number | null, periodDays: number | null): string | null {
  if (cur === null) return null;
  const base = `${label} averaged ${cur.toFixed(1)}`;
  if (prev === null || periodDays === null) return base;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return `${base}, about the same as the ${periodDays} days before`;
  return `${base}, ${d > 0 ? 'up' : 'down'} from ${prev.toFixed(1)} in the ${periodDays} days before`;
}

export function chipCounts(checkIns: CheckIn[], start: number, end: number): { chip: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of checkIns) {
    const t = Date.parse(c.at);
    if (c.deletedAt || t < start || t > end) continue;
    for (const chip of c.chips) m.set(chip, (m.get(chip) ?? 0) + 1);
  }
  return [...m.entries()].map(([chip, count]) => ({ chip, count })).sort((a, b) => b.count - a.count || a.chip.localeCompare(b.chip));
}

/** Hours between consecutive doses taken on the same user day (overnight gaps aren't part of a schedule). */
export function doseIntervals(doses: Dose[], medId: string, start: number, end: number, s: ScheduleSettings): number[] {
  const ts = doses.filter((d) => !d.deletedAt && d.medicationId === medId).map((d) => Date.parse(d.takenAt))
    .filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    if (dayKey(ts[i], s) === dayKey(ts[i - 1], s)) out.push((ts[i] - ts[i - 1]) / 3_600_000);
  }
  return out;
}

/** Fixed-width bins covering the values, labelled by their lower edge. */
export function histogram(values: number[], width = 0.5): { from: number; to: number; count: number }[] {
  if (!values.length) return [];
  const lo = Math.floor(Math.min(...values) / width) * width;
  const hi = Math.floor(Math.max(...values) / width) * width;
  const bins = [];
  for (let x = lo; x <= hi + 1e-9; x += width) bins.push({ from: round2(x), to: round2(x + width), count: 0 });
  for (const v of values) bins[Math.min(bins.length - 1, Math.floor((v - lo) / width + 1e-9))].count++;
  return bins;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
