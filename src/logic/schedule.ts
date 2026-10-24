// Pure schedule logic. Every function takes `now` as a parameter so it can be tested; never call Date.now() here.
// All instants are UTC milliseconds; wall-clock times ('HH:mm') and days are interpreted in settings.tz,
// on the user's day (which starts at settings.dayStartsAt, not midnight).
import type { DoseSlot, Dose, Medication, Schedule } from '../db/schema';
import { addDays, hhmmToMinutes, zonedParts, zonedToUtc } from './tz';

export interface ScheduleSettings {
  dayStartsAt: string; // 'HH:mm'
  tz: string;
  guardMinutes: number;
}

/** 'not-today' = this medication isn't scheduled on today's day (e.g. a Sunday/Wednesday injection on a Monday). */
export type Status = 'none-today' | 'not-due' | 'due' | 'done-today' | 'past-latest-time' | 'not-today';

export type ContextNote =
  | { kind: 'interval'; elapsedMs: number; intervalHours: number }
  | { kind: 'count'; doseNumber: number; target: number }
  | { kind: 'past-latest'; latestDoseTime: string }
  | { kind: 'not-scheduled-day' }
  | { kind: 'amount'; expected: number }
  | { kind: 'rolling-count'; doseNumber: number; max: number }
  | { kind: 'rolling-amount'; total: number; max: number }
  | { kind: 'min-gap'; elapsedMs: number; minHours: number };

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;
/** A logged dose counts towards a set time if it's within this window either side. */
export const FIXED_MATCH_MS = 60 * MIN;
/** How far ahead to look for the next scheduled day. */
const LOOKAHEAD_DAYS = 400;

export const at = (d: Dose) => Date.parse(d.takenAt);

/** Doses for one medication that haven't been deleted, oldest first. */
export function medDoses(doses: Dose[], medId: string): Dose[] {
  return doses.filter((d) => d.medicationId === medId && !d.deletedAt).sort((a, b) => at(a) - at(b));
}

/** The most recent dose actually taken (not skipped) at or before `before` (default: any time). */
export function getLastDose(doses: Dose[], medId: string, before = Infinity): Dose | undefined {
  let last: Dose | undefined;
  for (const d of doses) {
    if (d.medicationId !== medId || d.deletedAt || d.skipped) continue;
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

/** Calendar date of the user's day that starts at dayStart. */
function dayDate(dayStart: number, s: ScheduleSettings) {
  const p = zonedParts(dayStart, s.tz);
  return { y: p.y, m: p.m, d: p.d };
}

/** Day of the week (0 = Sunday) of the user's day that starts at dayStart. */
export function weekdayOf(dayStart: number, s: ScheduleSettings): number {
  const { y, m, d } = dayDate(dayStart, s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whether the medication is scheduled on the user's day containing `t`. As-needed is always "on". */
export function isScheduledDay(med: Medication, t: number, s: ScheduleSettings): boolean {
  const sc = med.schedule;
  if (sc.type === 'prn') return true;
  const start = getDayBounds(t, s.dayStartsAt, s.tz).start;
  if (sc.cycle && cycleInfo(sc.cycle, start, s)?.phase === 'off') return false;
  if (sc.course && courseInfo(sc.course, start, s).phase !== 'on') return false;
  if (sc.everyNDays && sc.everyNDays > 1 && sc.startDate) {
    const { y, m, d } = dayDate(start, s);
    const [sy, sm, sd] = sc.startDate.split('-').map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / DAY);
    return diff >= 0 && diff % sc.everyNDays === 0;
  }
  if (sc.days?.length) return sc.days.includes(weekdayOf(start, s));
  return true;
}

export interface CycleInfo {
  phase: 'on' | 'off' | 'before';
  /** 1-based day within this phase, and the phase's length in days. */
  day: number; length: number;
  /** Calendar date ('YYYY-MM-DD') the next phase starts. */
  nextChange: string;
}

/** Where the user's day starting at `dayStart` falls in an on/off cycle. */
export function cycleInfo(c: NonNullable<Schedule['cycle']>, dayStart: number, s: ScheduleSettings): CycleInfo | undefined {
  if (!(c.on >= 1) || !(c.off >= 0)) return undefined;
  const { y, m, d } = dayDate(dayStart, s);
  const [sy, sm, sd] = c.start.split('-').map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / DAY);
  const ymd = (n: number) => { const x = addDays(y, m, d, n); return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; };
  if (diff < 0) return { phase: 'before', day: 0, length: 0, nextChange: c.start };
  const period = c.on + c.off;
  const k = diff % period;
  return k < c.on
    ? { phase: 'on', day: k + 1, length: c.on, nextChange: ymd(c.on - k) }
    : { phase: 'off', day: k - c.on + 1, length: c.off, nextChange: ymd(period - k) };
}

export interface CourseInfo {
  /** Not started yet, taking it (`day` of `length`), or on the break since `ended` ('YYYY-MM-DD', the first day off). */
  phase: 'before' | 'on' | 'break';
  day: number; length: number;
  /** The last day of the course ('YYYY-MM-DD'). */
  lastDay: string;
  /** Days into the break (1 = the first day off). */
  breakDays: number;
}

/** Where the user's day starting at `dayStart` falls in a course. */
export function courseInfo(c: NonNullable<Schedule['course']>, dayStart: number, s: ScheduleSettings): CourseInfo {
  const { y, m, d } = dayDate(dayStart, s);
  const [sy, sm, sd] = c.start.split('-').map(Number);
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / DAY);
  const length = Math.max(1, Math.round(c.days));
  const last = addDays(sy, sm, sd, length - 1);
  const lastDay = `${last.y}-${String(last.m).padStart(2, '0')}-${String(last.d).padStart(2, '0')}`;
  if (diff < 0) return { phase: 'before', day: 0, length, lastDay, breakDays: 0 };
  if (diff < length) return { phase: 'on', day: diff + 1, length, lastDay, breakDays: 0 };
  return { phase: 'break', day: length, length, lastDay, breakDays: diff - length + 1 };
}

/** Start of the next scheduled user day after the one containing `now` (null if none within ~a year). */
export function nextScheduledDayStart(med: Medication, now: number, s: ScheduleSettings): number | null {
  let t = getDayBounds(now, s.dayStartsAt, s.tz).end;
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    if (isScheduledDay(med, t, s)) return t;
    t = getDayBounds(t, s.dayStartsAt, s.tz).end;
  }
  return null;
}

/** Set times with their amounts (Phase 1 `times` are read as slots without amounts). */
export function getSlots(med: Medication): DoseSlot[] {
  const sc = med.schedule;
  if (sc.slots?.length) return sc.slots;
  return (sc.times ?? []).map((time) => ({ time }));
}

/** Entries in the user's current day, up to and including now. Includes skipped doses, which hold their place
 *  in the day's plan (so the next dose's amount and set time move on); filter `!d.skipped` for doses taken. */
export function getDosesToday(doses: Dose[], medId: string, now: number, s: ScheduleSettings): Dose[] {
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  return medDoses(doses, medId).filter((d) => at(d) >= start && at(d) < end && at(d) <= now);
}

/** How many doses a day the user's own settings describe. With `now`, days that aren't scheduled give 0. */
export function getDailyTarget(med: Medication, now?: number, s?: ScheduleSettings): number | undefined {
  const sc = med.schedule;
  if (sc.type === 'prn') return undefined;
  if (now !== undefined && s && !isScheduledDay(med, now, s)) return 0;
  if (sc.type === 'interval') return sc.doseAmounts?.length || sc.maxPerDay || undefined;
  return sc.maxPerDay || getSlots(med).length || undefined;
}

/** The planned amounts for the user's day containing `now` (empty when nothing is planned). */
export function plannedAmounts(med: Medication, now: number, s: ScheduleSettings): number[] {
  const sc = med.schedule;
  if (sc.type === 'prn' || !isScheduledDay(med, now, s)) return [];
  if (sc.type === 'interval') {
    if (sc.doseAmounts?.length) return sc.doseAmounts;
    return sc.maxPerDay ? Array(sc.maxPerDay).fill(med.defaultAmount) : [];
  }
  return getSlots(med).map((x) => x.amount ?? med.defaultAmount);
}

/** Total amount planned for the day (e.g. 50 mg for 20 + 20 + 10), or undefined if there's no plan. */
export function getDailyAmountTarget(med: Medication, now: number, s: ScheduleSettings): number | undefined {
  const a = plannedAmounts(med, now, s);
  return a.length ? a.reduce((x, y) => x + y, 0) : undefined;
}

/** Today's set times, each paired with the dose that covers it (closest within ±60 min, each dose used once). */
export function getFixedSlots(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): { at: number; amount: number; dose?: Dose }[] {
  if (!isScheduledDay(med, now, s)) return [];
  const { start } = getDayBounds(now, s.dayStartsAt, s.tz);
  const slots = getSlots(med).map((x) => ({ at: timeInDay(start, x.time, s), amount: x.amount ?? med.defaultAmount })).sort((a, b) => a.at - b.at);
  const unused = getDosesToday(doses, med.id, now, s);
  return slots.map((slot) => {
    let best = -1;
    unused.forEach((d, i) => {
      const diff = Math.abs(at(d) - slot.at);
      if (diff <= FIXED_MATCH_MS && (best < 0 || diff < Math.abs(at(unused[best]) - slot.at))) best = i;
    });
    const dose = best >= 0 ? unused.splice(best, 1)[0] : undefined;
    return { ...slot, dose };
  });
}

/** Today's next set time still open (not logged, window not closed). */
function openSlotToday(med: Medication, doses: Dose[], now: number, s: ScheduleSettings) {
  return getFixedSlots(med, doses, now, s).find((x) => !x.dose && x.at + FIXED_MATCH_MS > now);
}

/** When the next dose is due, as UTC ms, or null when there isn't one to count down to.
 *  Set times look ahead to the next scheduled day (so a weekly injection counts down across days). */
export function getNextDue(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): number | null {
  const sc = med.schedule;
  if (sc.type === 'interval' && sc.intervalHours) {
    if (!isScheduledDay(med, now, s)) return null;
    const today = getDosesToday(doses, med.id, now, s);
    if (!today.length) return null; // "No doses yet today"
    const target = getDailyTarget(med, now, s);
    if (target && today.length >= target) return null; // the day's plan is complete
    return at(today[today.length - 1]) + sc.intervalHours * HOUR;
  }
  if (sc.type === 'fixed') {
    const open = openSlotToday(med, doses, now, s);
    if (open) return open.at;
    const nextDay = nextScheduledDayStart(med, now, s);
    if (nextDay === null) return null;
    const times = getSlots(med).map((x) => timeInDay(nextDay, x.time, s)).sort((a, b) => a - b);
    return times[0] ?? null;
  }
  return null;
}

export function getStatus(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): Status {
  const count = getDosesToday(doses, med.id, now, s).length;
  if (med.schedule.type === 'prn') return count ? 'not-due' : 'none-today';
  if (!isScheduledDay(med, now, s)) return 'not-today';
  const target = getDailyTarget(med, now, s);
  if (target && count >= target) return 'done-today';
  if (med.schedule.type === 'interval') {
    const latest = latestTimeToday(med, now, s);
    if (latest !== undefined && now >= latest) return 'past-latest-time';
    const next = getNextDue(med, doses, now, s);
    if (next === null) return 'none-today';
    return now >= next ? 'due' : 'not-due';
  }
  const open = openSlotToday(med, doses, now, s);
  if (!open) return 'past-latest-time';
  if (now >= open.at) return 'due';
  return count ? 'not-due' : 'none-today';
}

function latestTimeToday(med: Medication, now: number, s: ScheduleSettings): number | undefined {
  const lt = med.schedule.latestDoseTime;
  if (!lt) return undefined;
  return timeInDay(getDayBounds(now, s.dayStartsAt, s.tz).start, lt, s);
}

/** The amount the user's plan says for a dose taken at `when` (prefilled when logging). */
export function getExpectedAmount(med: Medication, doses: Dose[], when: number, s: ScheduleSettings): number {
  const sc = med.schedule;
  if (sc.type === 'interval' && sc.doseAmounts?.length) {
    const n = getDosesToday(doses, med.id, when, s).length;
    return sc.doseAmounts[Math.min(n, sc.doseAmounts.length - 1)];
  }
  if (sc.type === 'fixed') {
    const slots = getFixedSlots(med, doses, when, s);
    // The set time this dose is for: one whose window contains `when`, otherwise the next one still open.
    const slot = slots.find((x) => !x.dose && Math.abs(x.at - when) <= FIXED_MATCH_MS)
      ?? slots.find((x) => !x.dose && x.at > when)
      ?? slots.filter((x) => !x.dose).pop();
    if (slot) return slot.amount;
  }
  return med.defaultAmount;
}

/** Whether the plan gives specific amounts (so a different amount is worth mentioning). */
function hasAmountPlan(med: Medication): boolean {
  const sc = med.schedule;
  if (sc.type === 'interval') return !!sc.doseAmounts?.length;
  if (sc.type === 'fixed') return getSlots(med).some((x) => x.amount !== undefined);
  return false;
}

/** A dose of this medication taken within the double-tap guard window before now. */
export function getRecentDose(doses: Dose[], medId: string, now: number, guardMinutes: number): Dose | undefined {
  const last = getLastDose(doses, medId, now);
  return last && now - at(last) < guardMinutes * MIN ? last : undefined;
}

export interface RollingUsage {
  /** Doses taken in the 24 hours up to `now`, and their total amount. */
  count: number;
  amount: number;
  /** When the minimum gap since the last dose ends, if it hasn't yet. */
  gapEndsAt: number | null;
}

/** Use in the last 24 hours (a rolling window, not the calendar day) against the person's own limits. */
export function getRollingUsage(med: Medication, doses: Dose[], now: number): RollingUsage {
  const recent = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && at(d) <= now && at(d) > now - 24 * HOUR);
  const last = getLastDose(doses, med.id, now);
  const minH = med.schedule.minHoursApart;
  const gapEnd = last && minH ? at(last) + minH * HOUR : null;
  return { count: recent.length, amount: recent.reduce((t, d) => t + d.amount, 0), gapEndsAt: gapEnd !== null && gapEnd > now ? gapEnd : null };
}

/** Notes for the rolling 24-hour limits, if the person set any. */
function limitNotes(med: Medication, doses: Dose[], when: number, amount?: number): ContextNote[] {
  const sc = med.schedule;
  const out: ContextNote[] = [];
  if (!sc.maxPer24h && !sc.maxAmountPer24h && !sc.minHoursApart) return out;
  const u = getRollingUsage(med, doses, when);
  if (sc.maxPer24h && u.count >= sc.maxPer24h) out.push({ kind: 'rolling-count', doseNumber: u.count + 1, max: sc.maxPer24h });
  if (sc.maxAmountPer24h && amount !== undefined && u.amount + amount > sc.maxAmountPer24h + 1e-9) {
    out.push({ kind: 'rolling-amount', total: u.amount + amount, max: sc.maxAmountPer24h });
  }
  const last = getLastDose(doses, med.id, when);
  if (sc.minHoursApart && last && when - at(last) < sc.minHoursApart * HOUR) {
    out.push({ kind: 'min-gap', elapsedMs: when - at(last), minHours: sc.minHoursApart });
  }
  return out;
}

/** Non-blocking notes that compare logging `amount` at `when` against the user's own settings. */
export function getContextNotes(med: Medication, doses: Dose[], when: number, s: ScheduleSettings, amount?: number): ContextNote[] {
  const notes: ContextNote[] = [];
  const sc = med.schedule;
  if (sc.type === 'prn') return limitNotes(med, doses, when, amount);
  if (!isScheduledDay(med, when, s)) {
    notes.push({ kind: 'not-scheduled-day' });
    return notes;
  }
  if (sc.type === 'interval' && sc.intervalHours) {
    const last = getLastDose(doses, med.id, when);
    // Only within the same day: the first dose of a new day isn't "too soon" after last night's.
    if (last && when - at(last) < sc.intervalHours * HOUR && getDosesToday(doses, med.id, when, s).length) {
      notes.push({ kind: 'interval', elapsedMs: when - at(last), intervalHours: sc.intervalHours });
    }
  }
  const target = getDailyTarget(med, when, s);
  if (target) {
    const count = getDosesToday(doses, med.id, when, s).length;
    if (count >= target) notes.push({ kind: 'count', doseNumber: count + 1, target });
  }
  const latest = latestTimeToday(med, when, s);
  if (latest !== undefined && when > latest) notes.push({ kind: 'past-latest', latestDoseTime: sc.latestDoseTime! });
  if (amount !== undefined && hasAmountPlan(med)) {
    const expected = getExpectedAmount(med, doses, when, s);
    if (Math.abs(amount - expected) > 1e-9) notes.push({ kind: 'amount', expected });
  }
  return [...notes, ...limitNotes(med, doses, when, amount)];
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

const urgency: Record<Status, number> = { due: 0, 'not-due': 1, 'none-today': 2, 'past-latest-time': 3, 'not-today': 4, 'done-today': 5 };

/** Sort scheduled medications so the most urgent is first. */
export function byUrgency(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings): Medication[] {
  const keys = new Map(meds.map((m) => [m.id, [urgency[getStatus(m, doses, now, s)], getNextDue(m, doses, now, s) ?? Infinity] as const]));
  return [...meds].sort((a, b) => {
    const [ua, na] = keys.get(a.id)!, [ub, nb] = keys.get(b.id)!;
    return ua - ub || na - nb || a.name.localeCompare(b.name);
  });
}

/** What Today's headline shows: everything due now (oldest first, including an every-few-hours medicine whose first
 *  dose of the day hasn't been taken), otherwise every medicine due at the soonest upcoming time. Empty when nothing
 *  is planned (as-needed only, or every course on a break). */
export function nextUp(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings): { meds: Medication[]; at: number | null; due: boolean } {
  const live = meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  const info = live.map((m) => ({ m, status: getStatus(m, doses, now, s), next: getNextDue(m, doses, now, s) }));
  const due = info.filter((x) => x.status === 'due' || (x.status === 'none-today' && x.m.schedule.type === 'interval'))
    .sort((a, b) => (a.next ?? now) - (b.next ?? now) || a.m.name.localeCompare(b.m.name));
  if (due.length) return { meds: due.map((x) => x.m), at: due[0].next ?? now, due: true };
  const upcoming = info.filter((x) => x.next !== null && x.next > now);
  if (!upcoming.length) return { meds: [], at: null, due: false };
  const soonest = Math.min(...upcoming.map((x) => x.next!));
  // Same minute counts as together (e.g. three tablets at 8:00 am).
  const group = upcoming.filter((x) => Math.floor(x.next! / 60_000) === Math.floor(soonest / 60_000)).sort((a, b) => a.m.name.localeCompare(b.m.name));
  return { meds: group.map((x) => x.m), at: soonest, due: false };
}
