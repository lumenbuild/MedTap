// Phone notifications for the native app: when each upcoming dose is due, from the person's own schedule.
// Pure: the native layer schedules whatever this returns.
import type { Dose, Medication } from '../db/schema';
import { getDayBounds, getExpectedAmount, getFixedSlots, getNextDue, getSlots, isScheduledDay, timeInDay, type ScheduleSettings } from './schedule';

export interface PlannedReminder {
  /** Stable 31-bit id, so rescheduling replaces rather than duplicates. */
  id: number;
  at: number;
  medId: string;
  amount: number;
}

/** iOS keeps at most 64 pending notifications per app. */
export const MAX_REMINDERS = 60;
export const HORIZON_DAYS = 7;

export function reminderId(medId: string, at: number): number {
  let h = 2166136261;
  for (const c of `${medId}@${at}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 1) || 1;
}

/** Set times over the next week (skipping ones already logged), plus the next every-few-hours dose. Soonest first. */
export function planReminders(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings,
  horizonDays = HORIZON_DAYS, max = MAX_REMINDERS): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const until = now + horizonDays * 86_400_000;
  for (const med of meds) {
    if (med.archived) continue;
    const sc = med.schedule;
    if (sc.type === 'fixed') {
      const today = getFixedSlots(med, doses, now, s);
      for (const slot of today) if (slot.at > now && !slot.dose) out.push({ id: reminderId(med.id, slot.at), at: slot.at, medId: med.id, amount: slot.amount });
      let dayStart = getDayBounds(now, s.dayStartsAt, s.tz).end;
      while (dayStart < until) {
        if (isScheduledDay(med, dayStart, s)) {
          for (const x of getSlots(med)) {
            const t = timeInDay(dayStart, x.time, s);
            if (t > now && t < until) out.push({ id: reminderId(med.id, t), at: t, medId: med.id, amount: x.amount ?? med.defaultAmount });
          }
        }
        dayStart = getDayBounds(dayStart, s.dayStartsAt, s.tz).end;
      }
    } else if (sc.type === 'interval') {
      const next = getNextDue(med, doses, now, s);
      if (next !== null && next > now && next < until) {
        out.push({ id: reminderId(med.id, next), at: next, medId: med.id, amount: getExpectedAmount(med, doses, next, s) });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}
