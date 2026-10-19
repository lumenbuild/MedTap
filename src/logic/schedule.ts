// Pure schedule logic. Every function takes `now` as a parameter so it can be tested; never call Date.now() here.
// All instants are UTC milliseconds; wall-clock times ('HH:mm') are interpreted in settings.tz.
import type { Dose, Medication } from '../db/schema';
import { addDays, hhmmToMinutes, zonedParts, zonedToUtc } from './tz';

export interface ScheduleSettings {
  dayStartsAt: string; // 'HH:mm'
  tz: string;
  guardMinutes: number;
}

export type Status = 'none-today' | 'not-due' | 'due' | 'done-today' | 'past-latest-time';

export type ContextNote =
  | { kind: 'interval'; elapsedMs: number; intervalHours: number }
  | { kind: 'count'; doseNumber: number; target: number }
  | { kind: 'past-latest'; latestDoseTime: string };

const HOUR = 3_600_000;
const MIN = 60_000;
/** A logged dose counts towards a set time if it's within this window either side. */
export const FIXED_MATCH_MS = 60 * MIN;

export const at = (d: Dose) => Date.parse(d.takenAt);

/** Doses for one medication that haven't been deleted, oldest first. */
export function medDoses(doses: Dose[], medId: string): Dose[] {
  return doses.filter((d) => d.medicationId === medId && !d.deletedAt).sort((a, b) => at(a) - at(b));
}

/** The most recent dose taken at or before `before` (default: any time). */
export function getLastDose(doses: Dose[], medId: string, before = Infinity): Dose | undefined {
  let last: Dose | undefined;
  for (const d of doses) {
    if (d.medicationId !== medId || d.deletedAt) continue;
    const t = at(d);
    if (t <= before && (!last || t > at(last))) last = d;
  }
  return last;
}

/** The user's "day" runs from dayStartsAt to dayStartsAt, not midnight to midnight. */
export function getDayBounds(now: number, dayStartsAt: string, tz: string): { start: number; end: number } {
  const p = zonedParts(now, tz);
  const startMin = hhmmToMinutes(dayStartsAt);
  const day = p.h * 60 + p.mi < startMin ? addDays(p.y, p.m, p.d, -1) : { y: p.y, m: p.m, d: p.d };
  const next = addDays(day.y, day.m, day.d, 1);
  const h = Math.floor(startMin / 60), mi = startMin % 60;
  return { start: zonedToUtc(day.y, day.m, day.d, h, mi, tz), end: zonedToUtc(next.y, next.m, next.d, h, mi, tz) };
}

/** The instant of a 'HH:mm' wall-clock time within the user's day that starts at dayStart.
 *  Times earlier than dayStartsAt (e.g. 01:00 when the day starts at 04:00) fall on the next calendar date. */
export function timeInDay(dayStart: number, hhmm: string, s: ScheduleSettings): number {
  const p = zonedParts(dayStart, s.tz);
  const min = hhmmToMinutes(hhmm);
  const date = min < hhmmToMinutes(s.dayStartsAt) ? addDays(p.y, p.m, p.d, 1) : { y: p.y, m: p.m, d: p.d };
  return zonedToUtc(date.y, date.m, date.d, Math.floor(min / 60), min % 60, s.tz);
}

/** Doses in the user's current day, up to and including now. */
export function getDosesToday(doses: Dose[], medId: string, now: number, s: ScheduleSettings): Dose[] {
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  return medDoses(doses, medId).filter((d) => at(d) >= start && at(d) < end && at(d) <= now);
}

/** How many doses a day the user's own settings describe, if any. */
export function getDailyTarget(med: Medication): number | undefined {
  const sc = med.schedule;
  if (sc.maxPerDay) return sc.maxPerDay;
  if (sc.type === 'fixed' && sc.times?.length) return sc.times.length;
  return undefined;
}

function latestTimeToday(med: Medication, now: number, s: ScheduleSettings): number | undefined {
  const lt = med.schedule.latestDoseTime;
  if (!lt) return undefined;
  return timeInDay(getDayBounds(now, s.dayStartsAt, s.tz).start, lt, s);
}

/** Today's set times, each paired with the dose that covers it (closest within ±60 min, each dose used once). */
export function getFixedSlots(med: Medication, doses: Dose[], now: number, s: ScheduleSettings) {
  const { start } = getDayBounds(now, s.dayStartsAt, s.tz);
  const slots = (med.schedule.times ?? []).map((t) => timeInDay(start, t, s)).sort((a, b) => a - b);
  const unused = getDosesToday(doses, med.id, now, s);
  return slots.map((slot) => {
    let best = -1;
    unused.forEach((d, i) => {
      const diff = Math.abs(at(d) - slot);
      if (diff <= FIXED_MATCH_MS && (best < 0 || diff < Math.abs(at(unused[best]) - slot))) best = i;
    });
    const dose = best >= 0 ? unused.splice(best, 1)[0] : undefined;
    return { at: slot, dose };
  });
}

/** When the next dose is due, as UTC ms, or null when there isn't one to count down to. */
export function getNextDue(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): number | null {
  const sc = med.schedule;
  if (sc.type === 'interval' && sc.intervalHours) {
    const today = getDosesToday(doses, med.id, now, s);
    if (!today.length) return null; // "No doses yet today"
    return at(today[today.length - 1]) + sc.intervalHours * HOUR;
  }
  if (sc.type === 'fixed') {
    const open = getFixedSlots(med, doses, now, s).find((x) => !x.dose && x.at + FIXED_MATCH_MS > now);
    return open ? open.at : null;
  }
  return null;
}

export function getStatus(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): Status {
  const count = getDosesToday(doses, med.id, now, s).length;
  if (med.schedule.type === 'prn') return count ? 'not-due' : 'none-today';
  const target = getDailyTarget(med);
  if (target && count >= target) return 'done-today';
  const latest = latestTimeToday(med, now, s);
  const next = getNextDue(med, doses, now, s);
  if (med.schedule.type === 'interval') {
    if (latest !== undefined && now >= latest) return 'past-latest-time';
    if (next === null) return 'none-today';
    return now >= next ? 'due' : 'not-due';
  }
  // fixed
  if (next === null) return 'past-latest-time';
  if (now >= next) return 'due';
  return count ? 'not-due' : 'none-today';
}

/** A dose of this medication taken within the double-tap guard window before now. */
export function getRecentDose(doses: Dose[], medId: string, now: number, guardMinutes: number): Dose | undefined {
  const last = getLastDose(doses, medId, now);
  return last && now - at(last) < guardMinutes * MIN ? last : undefined;
}

/** Non-blocking notes that compare logging a dose at `when` against the user's own settings. */
export function getContextNotes(med: Medication, doses: Dose[], when: number, s: ScheduleSettings): ContextNote[] {
  const notes: ContextNote[] = [];
  const sc = med.schedule;
  if (sc.type === 'interval' && sc.intervalHours) {
    const last = getLastDose(doses, med.id, when);
    if (last && when - at(last) < sc.intervalHours * HOUR) {
      notes.push({ kind: 'interval', elapsedMs: when - at(last), intervalHours: sc.intervalHours });
    }
  }
  const target = getDailyTarget(med);
  if (target) {
    const count = getDosesToday(doses, med.id, when, s).length;
    if (count >= target) notes.push({ kind: 'count', doseNumber: count + 1, target });
  }
  const latest = latestTimeToday(med, when, s);
  if (sc.type !== 'prn' && latest !== undefined && when > latest) {
    notes.push({ kind: 'past-latest', latestDoseTime: sc.latestDoseTime! });
  }
  return notes;
}

/** 0–1 progress through the current wait, for the countdown ring. */
export function getProgress(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): number {
  const next = getNextDue(med, doses, now, s);
  if (next === null) return 0;
  const last = getLastDose(doses, med.id, now);
  const from = last ? at(last) : getDayBounds(now, s.dayStartsAt, s.tz).start;
  if (next <= from) return 1;
  return Math.min(1, Math.max(0, (now - from) / (next - from)));
}

const urgency: Record<Status, number> = { due: 0, 'not-due': 1, 'none-today': 2, 'past-latest-time': 3, 'done-today': 4 };

/** Sort scheduled medications so the most urgent is first. */
export function byUrgency(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings): Medication[] {
  const key = (m: Medication) => {
    const st = getStatus(m, doses, now, s);
    return [urgency[st], getNextDue(m, doses, now, s) ?? Infinity] as const;
  };
  return [...meds].sort((a, b) => {
    const [ua, na] = key(a), [ub, nb] = key(b);
    return ua - ub || na - nb || a.name.localeCompare(b.name);
  });
}
