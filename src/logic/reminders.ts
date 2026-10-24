// When Today should show its gentle prompts. Pure; `now` is always passed in.
import type { Bottle, CheckIn, Dose, Medication } from '../db/schema';
import { forecastRunOut, type Forecast } from './plans';
import type { ScheduleSettings } from './schedule';
import { addDays, zonedParts, zonedToUtc } from './tz';

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
  for (const d of doses) if (!d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now && (!last || d.takenAt > last.takenAt)) last = d;
  if (!last || last.id === dismissedId) return undefined;
  const t = Date.parse(last.takenAt);
  if (now - t < delayMin * 60_000 || now - t > SIX_HOURS) return undefined;
  if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= t)) return undefined;
  return last;
}

export interface CheckInAsk {
  /** Remembered when it's closed with "Not now" or opened by itself: the dose id, or "daily:<date> <time>". */
  key: string;
  kind: 'dose' | 'daily';
  /** When it became due. */
  at: number;
  dose?: Dose;
}
export interface CheckInOptions { delayMin: number; times: string[]; dismissed: string | null }

/** Daily check-in times on the day `ms` falls on (local, in the schedule's time zone), earliest first. */
function timesOn(ms: number, times: string[], tz: string): { at: number; key: string }[] {
  const p = zonedParts(ms, tz);
  const ymd = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return times.filter((t) => /^\d{2}:\d{2}$/.test(t)).sort()
    .map((t) => ({ at: zonedToUtc(p.y, p.m, p.d, Number(t.slice(0, 2)), Number(t.slice(3)), tz), key: `daily:${ymd} ${t}` }));
}

/** The check-in to ask for now, if any: after a dose (see checkInPromptDose), else the latest daily check-in time
 *  that has passed in the last 4 hours, unless there's a check-in from an hour before it on, or it was closed. */
export function checkInDue(doses: Dose[], checkIns: CheckIn[], now: number, o: CheckInOptions, s: ScheduleSettings): CheckInAsk | undefined {
  const dose = checkInPromptDose(doses, checkIns, now, o.delayMin, o.dismissed);
  if (dose) return { key: dose.id, kind: 'dose', at: Date.parse(dose.takenAt) + o.delayMin * 60_000, dose };
  const past = timesOn(now, o.times, s.tz).filter((x) => x.at <= now && now - x.at <= 4 * 3_600_000).pop();
  if (!past || past.key === o.dismissed) return undefined;
  if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= past.at - 3_600_000)) return undefined;
  return { key: past.key, kind: 'daily', at: past.at };
}

/** Check-in notifications to schedule: one after the latest dose (if it's still ahead and nothing's been logged since),
 *  and each daily time over the next week, leaving out today's if a check-in already covers it. */
export function planCheckInNotes(doses: Dose[], checkIns: CheckIn[], now: number, o: Omit<CheckInOptions, 'dismissed'>, s: ScheduleSettings, days = 7): { id: number; at: number; kind: 'dose' | 'daily' }[] {
  const out: { id: number; at: number; kind: 'dose' | 'daily' }[] = [];
  let last: Dose | undefined;
  for (const d of doses) if (!d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now && (!last || d.takenAt > last.takenAt)) last = d;
  if (last && o.delayMin > 0) {
    const t = Date.parse(last.takenAt);
    const at = t + o.delayMin * 60_000;
    if (at > now && !checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= t)) out.push({ id: 900_500_000, at, kind: 'dose' });
  }
  const p = zonedParts(now, s.tz);
  let n = 1;
  for (let i = 0; i < days; i++) {
    const d = addDays(p.y, p.m, p.d, i);
    for (const x of timesOn(zonedToUtc(d.y, d.m, d.d, 12, 0, s.tz), o.times, s.tz)) {
      const id = 900_500_000 + n++;
      if (x.at <= now) continue;
      if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= x.at - 3_600_000 && Date.parse(c.at) <= x.at)) continue;
      // Not right on top of the after-dose one.
      if (out[0]?.kind === 'dose' && Math.abs(out[0].at - x.at) < 3_600_000) continue;
      out.push({ id, at: x.at, kind: 'daily' });
    }
  }
  return out;
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
