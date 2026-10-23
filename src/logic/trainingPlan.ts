// Smart training reminders (MedTap): learns the days and times the person usually trains, reminds them on those days
// (not when they've already trained), and says when the week's sessions goal needs a session today. Pure.
import type { Workout } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { addDays, zonedParts, zonedToUtc } from './tz';
import { trainingCalendar } from './training';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface Habit { days: { weekday: number; minutes: number; share: number }[]; weeks: number; sessions: number }

const localDow = (t: number, tz: string) => { const p = zonedParts(t, tz); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); };
const localMin = (t: number, tz: string) => { const p = zonedParts(t, tz); return p.h * 60 + p.mi; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

/** The weekdays trained on in at least half of the last 8 weeks (3+ weeks of history, 6+ sessions), each with the
 *  usual start time. */
export function trainingHabit(workouts: Workout[], now: number, s: ScheduleSettings): Habit | null {
  const ws = workouts.filter((w) => !w.deletedAt && w.source !== 'health' && Date.parse(w.startedAt) > now - 8 * WEEK && Date.parse(w.startedAt) <= now);
  if (ws.length < 6) return null;
  const first = Math.min(...ws.map((w) => Date.parse(w.startedAt)));
  const weeks = Math.min(8, Math.ceil((now - first) / WEEK));
  if (weeks < 3) return null;
  const days: Habit['days'] = [];
  for (let wd = 0; wd < 7; wd++) {
    const on = ws.filter((w) => localDow(Date.parse(w.startedAt), s.tz) === wd);
    const distinctWeeks = new Set(on.map((w) => Math.floor((now - Date.parse(w.startedAt)) / WEEK))).size;
    const share = distinctWeeks / weeks;
    if (share >= 0.5) days.push({ weekday: wd, minutes: median(on.map((w) => localMin(Date.parse(w.startedAt), s.tz))), share });
  }
  return days.length ? { days, weeks, sessions: ws.length } : null;
}

export const habitText = (h: Habit) => {
  const t = (m: number) => { const hh = Math.floor(m / 60), mm = m % 60; return `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'am' : 'pm'}`; };
  const times = [...new Set(h.days.map((d) => Math.round(d.minutes / 30) * 30))];
  return `${h.days.map((d) => SHORT[d.weekday]).join(', ')}${times.length === 1 ? `, around ${t(times[0])}` : ''}`;
};

export interface TrainingReminder { id: number; at: number; title: string; body: string }

/** The next week's reminders: 30 minutes before the usual time on usual days (not if already trained that day), and a
 *  morning note on the day the week's goal needs a session every remaining day. `strongDays` (days after the shot,
 *  0–6) adds a line when a usual day lands on one. */
export function planTrainingReminders(workouts: Workout[], now: number, s: ScheduleSettings, opts: { perWeek?: number; strongDays?: number[]; lastShot?: number; shotEveryDays?: number } = {}): TrainingReminder[] {
  const out: TrainingReminder[] = [];
  const h = trainingHabit(workouts, now, s);
  const trainedOn = new Set(workouts.filter((w) => !w.deletedAt).map((w) => { const p = zonedParts(Date.parse(w.startedAt), s.tz); return `${p.y}-${p.m}-${p.d}`; }));
  const today = zonedParts(now, s.tz);
  for (let i = 0; i < 7; i++) {
    const d = addDays(today.y, today.m, today.d, i);
    const wd = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
    const usual = h?.days.find((x) => x.weekday === wd);
    if (!usual || trainedOn.has(`${d.y}-${d.m}-${d.d}`)) continue;
    const start = usual.minutes;
    const at = zonedToUtc(d.y, d.m, d.d, Math.floor(start / 60), start % 60, s.tz) - 30 * 60_000;
    if (at <= now) continue;
    let extra = '';
    if (opts.strongDays?.length && opts.lastShot && opts.shotEveryDays) {
      const since = Math.floor(((at - opts.lastShot) / DAY) % opts.shotEveryDays);
      if (opts.strongDays.includes(since)) extra = ` ${since === 0 ? 'Shot day' : `Day ${since} after your shot`} is usually one of your stronger days.`;
    }
    out.push({ id: 900_100_000 + i, at, title: `${NAMES[wd]} training`, body: `You usually start about now.${extra}` });
  }
  // The week's goal: on the morning when the sessions still needed equal the days left (Monday-start weeks).
  if (opts.perWeek) {
    const c = trainingCalendar(workouts, now, s, opts.perWeek, 2);
    const need = opts.perWeek - c.thisWeek;
    const dow = (new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() + 6) % 7; // Monday 0
    for (let i = 0; i < 7 - dow && need > 0; i++) {
      const daysLeft = 7 - dow - i;
      if (daysLeft !== need) continue;
      const d = addDays(today.y, today.m, today.d, i);
      const at = zonedToUtc(d.y, d.m, d.d, 8, 30, s.tz);
      if (at > now && !trainedOn.has(`${d.y}-${d.m}-${d.d}`)) {
        out.push({ id: 900_200_000, at, title: `${need} to go this week`, body: `A session every day from today keeps your ${opts.perWeek}-a-week goal${c.streak ? ` and ${c.streak}-week streak` : ''}.` });
      }
      break;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
