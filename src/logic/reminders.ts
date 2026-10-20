// When Today should show its gentle prompts. Pure; `now` is always passed in.
import type { Bottle, CheckIn, Dose, Medication } from '../db/schema';
import { forecastRunOut, type Forecast } from './plans';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const SIX_HOURS = 6 * 3_600_000;

/** Back up if the last backup (or, if never, the first record) is older than `days` (default 7). No data, no prompt. */
export function needsBackup(lastBackupAt: string | null, earliestRecordAt: number | null, now: number, days = 7): boolean {
  if (earliestRecordAt === null) return false;
  const ref = lastBackupAt ? Date.parse(lastBackupAt) : earliestRecordAt;
  return now - ref > days * DAY;
}

/** The dose to ask "how are you feeling?" about: the latest dose, once `delayMin` has passed, for up to 6 hours,
 *  unless there's already a check-in since it or the prompt was dismissed. */
export function checkInPromptDose(doses: Dose[], checkIns: CheckIn[], now: number, delayMin: number, dismissedId: string | null): Dose | undefined {
  if (delayMin <= 0) return undefined;
  let last: Dose | undefined;
  for (const d of doses) if (!d.deletedAt && Date.parse(d.takenAt) <= now && (!last || d.takenAt > last.takenAt)) last = d;
  if (!last || last.id === dismissedId) return undefined;
  const t = Date.parse(last.takenAt);
  if (now - t < delayMin * 60_000 || now - t > SIX_HOURS) return undefined;
  if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= t)) return undefined;
  return last;
}

/** Active medications at or below their low-stock level, unless dismissed at the current count. */
export function lowStockMeds(meds: Medication[], dismissed: Record<string, number>): Medication[] {
  return meds.filter((m) => !m.archived && m.stockCount !== undefined && m.lowStockAt !== undefined
    && m.stockCount <= m.lowStockAt && dismissed[m.id] !== m.stockCount);
}

export interface RefillAlert {
  med: Medication;
  forecast: Forecast | null;
  low: boolean;          // at or below the person's own low-stock number
  runningOut: boolean;   // forecast to run out within `warnDays`
  scriptExpiring: boolean; // script expires within 30 days (or has expired)
  /** Bottles that expire within 30 days or have expired, soonest first. */
  expiringBottles: Bottle[];
}

/** Medications that need a refill or a new script soon, by the person's own numbers and plan.
 *  Dismissing hides an alert until the stock count changes. */
export function refillAlerts(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings, warnDays: number,
  dismissed: Record<string, number>): RefillAlert[] {
  const out: RefillAlert[] = [];
  for (const med of meds) {
    if (med.archived) continue;
    const forecast = forecastRunOut(med, doses, now, s);
    const low = med.stockCount !== undefined && med.lowStockAt !== undefined && med.stockCount <= med.lowStockAt;
    const runningOut = !!forecast && forecast.runOutAt !== null && forecast.daysLeft <= warnDays;
    const scriptExpiring = !!med.scriptExpiry && Date.parse(`${med.scriptExpiry}T23:59:59`) - now < 30 * DAY;
    const expiringBottles = (med.bottles ?? []).filter((b) => Date.parse(`${b.expiry}T23:59:59`) - now < 30 * DAY);
    if (!(low || runningOut || scriptExpiring || expiringBottles.length)) continue;
    if (dismissed[med.id] === (med.stockCount ?? -1)) continue;
    out.push({ med, forecast, low, runningOut, scriptExpiring, expiringBottles });
  }
  return out;
}
