// Planned schedule changes (dose changes, tapers) and refill forecasting. Pure: `now` and dates are passed in.
import type { Dose, Medication, PlannedChange, Schedule } from '../db/schema';
import { getDayBounds, getDosesToday, plannedAmounts, type ScheduleSettings } from './schedule';
import { fmtAmount, fmtSchedule } from './format';
import { dayKey } from './stats';
import { stockUnitsFor } from './stock';

const DAY = 86_400_000;

/** The medication as it will be on user day `ymd`: the latest planned change starting on or before then. */
export function medOn(med: Medication, ymd: string): Medication {
  const due = (med.plannedChanges ?? []).filter((c) => c.from <= ymd).sort((a, b) => a.from.localeCompare(b.from));
  const last = due[due.length - 1];
  return last ? { ...med, schedule: last.schedule, defaultAmount: last.defaultAmount } : med;
}

/** Changes whose date has arrived (to apply now, oldest first) and those still in the future. */
export function splitDueChanges(med: Medication, todayYmd: string): { due: PlannedChange[]; future: PlannedChange[] } {
  const all = [...(med.plannedChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  return { due: all.filter((c) => c.from <= todayYmd), future: all.filter((c) => c.from > todayYmd) };
}

export function nextPlannedChange(med: Medication, todayYmd: string): PlannedChange | undefined {
  return splitDueChanges(med, todayYmd).future[0];
}

/** What changed in strength, dose or schedule, in words. Empty when nothing did. */
export function describeChange(
  before: Pick<Medication, 'strength' | 'unit' | 'defaultAmount' | 'schedule'>,
  after: { strength: number; unit: string; defaultAmount: number; schedule: Schedule },
): string[] {
  const out: string[] = [];
  if (before.strength !== after.strength || before.unit !== after.unit)
    out.push(`Strength ${fmtAmount(before.strength, before.unit)} → ${fmtAmount(after.strength, after.unit)}`);
  if (before.defaultAmount !== after.defaultAmount)
    out.push(`Dose ${fmtAmount(before.defaultAmount, before.unit)} → ${fmtAmount(after.defaultAmount, after.unit)}`);
  if (fmtSchedule(before.schedule, before.unit) !== fmtSchedule(after.schedule, after.unit))
    out.push(`Schedule ${fmtSchedule(before.schedule, before.unit)} → ${fmtSchedule(after.schedule, after.unit)}`);
  return out;
}

export interface Forecast {
  /** Whole days fully covered by current stock (today counts if today's remaining doses are covered). */
  daysLeft: number;
  /** Start of the user day on which stock won't cover the planned doses; null if not within the horizon. */
  runOutAt: number | null;
  /** How the estimate was made. */
  basis: 'plan' | 'recent-use';
}

/** When stock runs out, following the plan (including planned changes). As-needed medications, and plans with no
 *  daily number, use the average of the last 30 days instead. Null without a stock count or any basis. */
export function forecastRunOut(med: Medication, doses: Dose[], now: number, s: ScheduleSettings, horizonDays = 366): Forecast | null {
  if (med.stockCount === undefined || med.stockCount === null) return null;
  let stock = med.stockCount;
  const today = getDayBounds(now, s.dayStartsAt, s.tz);
  const planToday = plannedAmounts(medOn(med, dayKey(now, s)), now, s);

  if (med.schedule.type !== 'prn' && (planToday.length || hasAnyPlan(med))) {
    // Today: only the doses still to come (skips and doses taken already hold their places).
    const done = getDosesToday(doses, med.id, now, s).length;
    for (const a of planToday.slice(done)) {
      const u = stockUnitsFor(med, a);
      if (stock + 1e-9 < u) return { daysLeft: 0, runOutAt: today.start, basis: 'plan' };
      stock -= u;
    }
    let t = today.end;
    for (let i = 1; i <= horizonDays; i++) {
      const amounts = plannedAmounts(medOn(med, dayKey(t, s)), t, s);
      for (const a of amounts) {
        const u = stockUnitsFor(med, a);
        if (stock + 1e-9 < u) return { daysLeft: i, runOutAt: t, basis: 'plan' };
        stock -= u;
      }
      t = getDayBounds(t, s.dayStartsAt, s.tz).end;
    }
    return { daysLeft: horizonDays, runOutAt: null, basis: 'plan' };
  }

  // Recent use: units taken per day over the last 30 days (or since the first dose, if sooner).
  const since = now - 30 * DAY;
  const recent = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) >= since && Date.parse(d.takenAt) <= now);
  if (!recent.length) return null;
  const first = Math.min(...recent.map((d) => Date.parse(d.takenAt)));
  const span = Math.max(7, Math.ceil((now - first) / DAY)); // whole days from the first dose through today
  const perDay = recent.reduce((t, d) => t + stockUnitsFor(med, d.amount), 0) / span;
  if (perDay <= 0) return null;
  const daysLeft = Math.floor(stock / perDay);
  return { daysLeft, runOutAt: daysLeft >= horizonDays ? null : today.start + daysLeft * DAY, basis: 'recent-use' };
}

function hasAnyPlan(med: Medication): boolean {
  const sc = med.schedule;
  return !!(sc.type === 'fixed' || sc.doseAmounts?.length || sc.maxPerDay);
}

