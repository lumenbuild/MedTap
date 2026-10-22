// Phone notifications for the native app: when each upcoming dose is due, from the person's own schedule.
// Pure: the native layer schedules whatever this returns.
import type { Dose, Medication } from '../db/schema';
import { getDayBounds, getExpectedAmount, getFixedSlots, getNextDue, getSlots, isScheduledDay, timeInDay, weekdayOf, type ScheduleSettings } from './schedule';
import { nudgeDelayMin, reminderAt, riskySlots, slotHabits } from './habits';

export interface PlannedReminder {
  /** Stable 31-bit id, so rescheduling replaces rather than duplicates. */
  id: number;
  at: number;
  medId: string;
  amount: number;
  /** 'due': at the reminder time. 'nudge': still not logged a while after (late, or a slot that's often missed). */
  kind: 'due' | 'nudge';
  /** The set time it's for (nudges say "due at …"). */
  dueAt: number;
}

export interface ReminderOptions {
  /** A second "still to take" reminder for every set time (the usual time plus the usual spread). */
  nudges?: boolean;
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
  horizonDays = HORIZON_DAYS, max = MAX_REMINDERS, opts: ReminderOptions = {}): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const until = now + horizonDays * 86_400_000;
  for (const med of meds) {
    if (med.archived) continue;
    const sc = med.schedule;
    if (sc.type === 'fixed') {
      const habits = slotHabits(med, doses, now, s);
      const risky = riskySlots(med, doses, now, s);
      // One set time on one day: the reminder (at the learned time, if set), then a nudge if it's still not logged.
      const add = (dayStart: number, slot: string, dueAt: number, amount: number) => {
        const at = reminderAt(med, slot, dayStart, s);
        if (at > now && at < until) out.push({ id: reminderId(med.id, dueAt), at, medId: med.id, amount, kind: 'due', dueAt });
        const wd = weekdayOf(dayStart, s);
        const weekend = wd === 0 || wd === 6;
        const h = habits.find((x) => x.slot === slot);
        const isRisky = risky.some((x) => x.weekday === wd && x.slot === slot);
        if (!opts.nudges && !isRisky) return;
        const nudge = at + nudgeDelayMin(weekend ? h?.weekend : h?.weekday) * 60_000;
        if (nudge > now && nudge < until) out.push({ id: reminderId(`${med.id}~nudge`, dueAt), at: nudge, medId: med.id, amount, kind: 'nudge', dueAt });
        // A slot that's often missed gets one more, an hour later.
        if (isRisky && nudge + 3_600_000 > now && nudge + 3_600_000 < until) out.push({ id: reminderId(`${med.id}~again`, dueAt), at: nudge + 3_600_000, medId: med.id, amount, kind: 'nudge', dueAt });
      };
      const todayStart = getDayBounds(now, s.dayStartsAt, s.tz).start;
      const today = getFixedSlots(med, doses, now, s);
      for (const slot of today) {
        const time = getSlots(med).find((x) => timeInDay(todayStart, x.time, s) === slot.at)?.time;
        if (!slot.dose && time) add(todayStart, time, slot.at, slot.amount);
      }
      let dayStart = getDayBounds(now, s.dayStartsAt, s.tz).end;
      while (dayStart < until) {
        if (isScheduledDay(med, dayStart, s)) {
          for (const x of getSlots(med)) add(dayStart, x.time, timeInDay(dayStart, x.time, s), x.amount ?? med.defaultAmount);
        }
        dayStart = getDayBounds(dayStart, s.dayStartsAt, s.tz).end;
      }
    } else if (sc.type === 'interval') {
      const next = getNextDue(med, doses, now, s);
      if (next !== null && next > now && next < until) {
        out.push({ id: reminderId(med.id, next), at: next, medId: med.id, amount: getExpectedAmount(med, doses, next, s), kind: 'due', dueAt: next });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}
