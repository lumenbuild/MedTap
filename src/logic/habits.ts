// Learning from the person's own logs (both apps): when each dose is actually taken, how much that varies, which slots
// tend to be missed, when a medicine's effect starts and wears off, how late doses go with sleep, and what the coming
// days usually look like. Pure; `now` and settings are passed in. Estimates with their basis, never advice.
import { plausibleHours } from './durations';
import type { CheckIn, DailyHealth, Dose, Medication, ReminderTime } from '../db/schema';
import { getDayBounds, getSlots, isScheduledDay, timeInDay, weekdayOf, type ScheduleSettings } from './schedule';
import { medOn } from './plans';
import { dayKey } from './stats';
import { dayStartOffset, plannedDoses } from './protocol';
import { hhmmToMinutes } from './tz';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const r = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const isWeekend = (wd: number) => wd === 0 || wd === 6;
/** A dose counts towards a set time if it's within 3 hours of it. */
const MATCH = 3 * HOUR;

export const toHHmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const round5 = (min: number) => Math.round(min / 5) * 5;

interface Occurrence { slot: string; t: number; weekday: number; dose?: Dose; skipped: boolean }

/** Every set time in the last `days` days (since the first dose), with the dose taken for it, if any. */
export function occurrences(med: Medication, doses: Dose[], now: number, s: ScheduleSettings, days = 42): Occurrence[] {
  if (med.schedule.type !== 'fixed') return [];
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt);
  const first = mine.reduce((m, d) => Math.min(m, Date.parse(d.takenAt)), Infinity);
  if (first === Infinity) return [];
  const used = new Set<string>();
  const out: Occurrence[] = [];
  for (let i = -days; i <= 0; i++) {
    const start = dayStartOffset(now, i, s);
    if (getDayBounds(start, s.dayStartsAt, s.tz).end <= first) continue;
    const m = medOn(med, dayKey(start, s));
    if (m.schedule.type !== 'fixed' || !isScheduledDay(m, start, s)) continue;
    for (const sl of getSlots(m)) {
      const t = timeInDay(start, sl.time, s);
      if (t + MATCH > now) continue; // still open
      const near = mine.filter((d) => !used.has(d.id) && Math.abs(Date.parse(d.takenAt) - t) <= MATCH).sort((a, b) => Math.abs(Date.parse(a.takenAt) - t) - Math.abs(Date.parse(b.takenAt) - t))[0];
      if (near) used.add(near.id);
      out.push({ slot: sl.time, t, weekday: weekdayOf(start, s), dose: near && !near.skipped ? near : undefined, skipped: !!near?.skipped });
    }
  }
  return out;
}

export interface Habit { /** Minutes after the set time it's usually taken (negative = before). */ median: number; /** Typical spread, minutes. */ spread: number; n: number }
export interface SlotHabit { slot: string; weekday?: Habit; weekend?: Habit }

function habitOf(xs: number[]): Habit | undefined {
  if (!xs.length) return undefined;
  const m = median(xs);
  return { median: Math.round(m), spread: Math.round(1.4826 * median(xs.map((x) => Math.abs(x - m)))), n: xs.length };
}

/** When each set time's dose is actually taken, on weekdays and weekends (last 6 weeks). */
export function slotHabits(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): SlotHabit[] {
  const occ = occurrences(med, doses, now, s).filter((o) => o.dose);
  const slots = [...new Set(getSlots(med).map((x) => x.time))];
  return slots.map((slot) => {
    const delta = (o: Occurrence) => (Date.parse(o.dose!.takenAt) - o.t) / MIN;
    const of = (weekend: boolean) => habitOf(occ.filter((o) => o.slot === slot && isWeekend(o.weekday) === weekend).map(delta));
    return { slot, weekday: of(false), weekend: of(true) };
  });
}

/** Reminder times that match when doses are really taken: suggested when the usual time is 20+ minutes from the current
 *  reminder, on 5+ weekdays (or 3+ weekend days) of the last 6 weeks, and fairly regular (spread under 45 minutes). */
export function reminderSuggestion(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): ReminderTime[] | null {
  const habits = slotHabits(med, doses, now, s);
  const out: ReminderTime[] = [];
  let changed = false;
  for (const h of habits) {
    const current = med.reminderTimes?.find((x) => x.slot === h.slot);
    const base = hhmmToMinutes(h.slot);
    const pick = (hb: Habit | undefined, min: number, cur?: string) => {
      if (!hb || hb.n < min || hb.spread > 45) return cur;
      const at = toHHmm(round5(base + hb.median));
      const now_ = cur ? hhmmToMinutes(cur) : base;
      if (Math.abs(hhmmToMinutes(at) - now_) >= 20) { changed = true; return at === h.slot ? undefined : at; }
      return cur;
    };
    const weekday = pick(h.weekday, 5, current?.weekday);
    const weekend = pick(h.weekend, 3, current?.weekend);
    if (weekday || weekend) out.push({ slot: h.slot, weekday, weekend });
  }
  return changed ? out : null;
}

/** When to remind for a set time on a given day: the learned time if one is set, else the set time. */
export function reminderAt(med: Medication, slot: string, dayStart: number, s: ScheduleSettings): number {
  const rt = med.reminderTimes?.find((x) => x.slot === slot);
  const at = rt ? (isWeekend(weekdayOf(dayStart, s)) ? rt.weekend : rt.weekday) : undefined;
  return timeInDay(dayStart, at ?? slot, s);
}

/** A second "still to take" nudge: the usual time plus twice the usual spread (at least 30 minutes, at most 3 hours),
 *  so a dose that's just running a bit late isn't nagged. Without 5 doses of history: 45 minutes after. */
export function nudgeDelayMin(habit: Habit | undefined): number {
  if (!habit || habit.n < 5) return 45;
  return Math.min(180, Math.max(30, habit.median > 0 ? habit.median + 2 * habit.spread : 2 * habit.spread));
}

export interface RiskySlot { weekday: number; slot: string; missed: number; of: number }

/** Set times on a day of the week that are often missed: 2+ of the last 8 weeks and 40%+ of the time. */
export function riskySlots(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): RiskySlot[] {
  const occ = occurrences(med, doses, now, s, 56);
  const groups = new Map<string, Occurrence[]>();
  for (const o of occ) { const k = `${o.weekday}|${o.slot}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const out: RiskySlot[] = [];
  for (const [k, os] of groups) {
    const missed = os.filter((o) => !o.dose && !o.skipped).length;
    if (os.length >= 3 && missed >= 2 && missed / os.length >= 0.4) {
      const [wd, slot] = k.split('|');
      out.push({ weekday: Number(wd), slot, missed, of: os.length });
    }
  }
  return out.sort((a, b) => b.missed / b.of - a.missed / a.of);
}

// ── Effect window ───────────────────────────────────────────────────────────────────────────────────

export interface EffectWindow {
  /** Hours after a dose: when focus is usually up, when it's usually wearing off. */
  onsetH?: number; wearOffH?: number;
  /** Average focus by hour after the dose (0–12). */
  byHour: { h: number; focus?: number; n: number }[];
  checkIns: number; doses: number;
}

/** From check-ins in the 12 hours after a dose of this medication: focus by hour, when it usually rises above the
 *  person's own baseline (the hour before a dose and days without one), and when "Wearing off" is noted or focus drops. */
export function effectWindow(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number): EffectWindow | null {
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) > now - 60 * DAY)
    .map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  if (mine.length < 3) return null;
  const cis = checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) > now - 60 * DAY);
  const byHour = Array.from({ length: 13 }, (_, h) => ({ h, vals: [] as number[], wearing: 0 }));
  const baseline: number[] = [];
  const usedDoses = new Set<number>();
  let used = 0;
  for (const c of cis) {
    const t = Date.parse(c.at);
    const before = mine.filter((d) => d <= t).pop();
    const h = before !== undefined ? (t - before) / HOUR : Infinity;
    if (h <= 12) {
      const b = byHour[Math.floor(h)];
      if (typeof c.focus === 'number') b.vals.push(c.focus);
      // "Wearing off" soon after a dose is about something earlier (the dose before, or another medicine fading), not
      // this one: a dose can't wear off before it's had time to work. Counted only where it's believable.
      if (c.chips.includes('Wearing off') && h >= 1.5 && plausibleHours(med, h)) b.wearing++;
      used++; usedDoses.add(before!);
    } else if (typeof c.focus === 'number') baseline.push(c.focus);
  }
  if (used < 6) return null;
  const base = baseline.length >= 3 ? avg(baseline) : undefined;
  const rows = byHour.map((b) => ({ h: b.h, focus: b.vals.length ? r(avg(b.vals)) : undefined, n: b.vals.length, wearing: b.wearing }));
  const known = rows.filter((x) => x.focus !== undefined && x.n >= 2);
  let onsetH: number | undefined, wearOffH: number | undefined;
  if (base !== undefined) onsetH = known.find((x) => x.focus! >= base + 0.5)?.h;
  else if (known.length) { const peak = Math.max(...known.map((x) => x.focus!)); onsetH = known.find((x) => x.focus! >= peak - 0.5)?.h; }
  const wear = rows.filter((x) => x.wearing > 0);
  if (wear.length >= 1 && wear.reduce((n, x) => n + x.wearing, 0) >= 2) {
    const hs = wear.flatMap((x) => Array(x.wearing).fill(x.h + 0.5));
    wearOffH = r(median(hs));
  } else if (onsetH !== undefined) {
    const peak = Math.max(...known.map((x) => x.focus!));
    const drop = known.find((x) => x.h > onsetH! && x.focus! <= peak - 1);
    wearOffH = drop?.h;
  }
  // Still not believable for this medicine (a few noisy check-ins): leave it to the usual time, or nothing.
  if (wearOffH !== undefined && !plausibleHours(med, wearOffH)) wearOffH = undefined;
  if (onsetH === undefined && wearOffH === undefined) return null;
  return { onsetH, wearOffH, byHour: rows.map(({ h, focus, n }) => ({ h, focus, n })), checkIns: used, doses: usedDoses.size };
}

// ── Sleep impact ────────────────────────────────────────────────────────────────────────────────────

export interface SleepImpact {
  /** Last dose at or after this hour (local) usually goes with worse sleep. */
  cutoffHour: number;
  before: { nights: number; quality?: number; hours?: number; deepMin?: number };
  after: { nights: number; quality?: number; hours?: number; deepMin?: number };
  /** Sleep from the watch (hours and deep sleep) rather than check-ins alone. */
  watch: boolean;
}

/** The day's last dose time against that night's sleep: hours asleep and deep sleep from the watch where there is a
 *  night, and quality (and hours, without a watch) from the next check-in with sleep in it, before 2 pm next day.
 *  Finds the hour after which sleep is clearly worse: 0.7+ lower quality, 0.7+ fewer hours or 10+ fewer minutes of
 *  deep sleep, 4+ nights each side. */
export function sleepImpact(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings, daily: DailyHealth[] = []): SleepImpact | null {
  const ids = new Set(meds.map((m) => m.id));
  const taken = doses.filter((d) => ids.has(d.medicationId) && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) > now - 90 * DAY);
  const nights: { lastHour: number; quality?: number; hours?: number; deep?: number }[] = [];
  const watchNight = new Map(daily.filter((x) => !x.deletedAt && x.sleepMin).map((x) => [x.date, x]));
  const byDay = new Map<string, number>();
  for (const d of taken) {
    const t = Date.parse(d.takenAt);
    const k = dayKey(t, s);
    byDay.set(k, Math.max(byDay.get(k) ?? 0, t));
  }
  const sleepCis = checkIns.filter((c) => !c.deletedAt && (typeof c.sleepQuality === 'number' || typeof c.sleepHours === 'number'));
  const hourOf = (t: number) => { const p = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: s.tz }).formatToParts(t); return Number(p.find((x) => x.type === 'hour')!.value) + Number(p.find((x) => x.type === 'minute')!.value) / 60; };
  for (const [, last] of byDay) {
    const dayEnd = getDayBounds(last, s.dayStartsAt, s.tz).end;
    const next = sleepCis.find((c) => { const t = Date.parse(c.at); return t > last && t >= dayEnd - 6 * HOUR && t < dayEnd + 10 * HOUR; });
    const w = watchNight.get(dayKey(dayEnd + 6 * HOUR, s));
    if (!next && !w) continue;
    nights.push({ lastHour: hourOf(last), quality: next?.sleepQuality, hours: w?.sleepMin ? r(w.sleepMin / 60) : next?.sleepHours, deep: w?.sleepDeepMin });
  }
  if (nights.length < 8) return null;
  let best: SleepImpact | null = null;
  let bestGap = 0;
  for (let cut = 10; cut <= 20; cut++) {
    const a = nights.filter((n) => n.lastHour < cut), b = nights.filter((n) => n.lastHour >= cut);
    if (a.length < 4 || b.length < 4) continue;
    const q = (xs: typeof nights) => { const v = xs.map((x) => x.quality).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? r(avg(v)) : undefined; };
    const h = (xs: typeof nights) => { const v = xs.map((x) => x.hours).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? r(avg(v)) : undefined; };
    const dp = (xs: typeof nights) => { const v = xs.map((x) => x.deep).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? Math.round(avg(v)) : undefined; };
    const qa = q(a), qb = q(b), ha = h(a), hb = h(b), da = dp(a), db_ = dp(b);
    // Deep sleep counts on the same scale: 10 minutes is about as telling as 0.7 of a point or of an hour.
    const gap = Math.max(qa !== undefined && qb !== undefined ? qa - qb : 0, ha !== undefined && hb !== undefined ? ha - hb : 0, da !== undefined && db_ !== undefined ? ((da - db_) / 10) * 0.7 : 0);
    if (gap >= 0.7 && gap > bestGap) {
      bestGap = gap;
      best = { cutoffHour: cut, before: { nights: a.length, quality: qa, hours: ha, deepMin: da }, after: { nights: b.length, quality: qb, hours: hb, deepMin: db_ }, watch: watchNight.size > 0 };
    }
  }
  return best;
}

// ── The coming days ─────────────────────────────────────────────────────────────────────────────────

export type Field = 'focus' | 'mood' | 'appetite';
export interface DayForecast { start: number; dose: boolean; values: Partial<Record<Field, number>> }
export interface CheckInForecast { days: DayForecast[]; checkIns: number; weeks: number }

/** The next 7 days' likely focus, mood and appetite: the person's average for that day of the week, adjusted by the
 *  difference between days with and without a planned dose, and the last 2 weeks against the 8 before. Needs 14+
 *  check-ins over 3+ weeks. */
export function checkInForecast(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): CheckInForecast | null {
  const cis = checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) > now - 70 * DAY && Date.parse(c.at) <= now);
  if (cis.length < 14) return null;
  const first = Math.min(...cis.map((c) => Date.parse(c.at)));
  if (now - first < 21 * DAY) return null;
  const sched = meds.filter((m) => !m.archived && m.schedule.type !== 'prn');
  const dosedDays = new Set(doses.filter((d) => !d.deletedAt && !d.skipped && sched.some((m) => m.id === d.medicationId)).map((d) => dayKey(Date.parse(d.takenAt), s)));
  const rows = cis.map((c) => { const t = Date.parse(c.at); return { c, t, wd: weekdayOf(getDayBounds(t, s.dayStartsAt, s.tz).start, s), dose: dosedDays.has(dayKey(t, s)) }; });
  const fields: Field[] = ['focus', 'mood', 'appetite'];
  const model = Object.fromEntries(fields.map((f) => {
    const has = rows.filter((x) => typeof x.c[f] === 'number');
    if (has.length < 10) return [f, null];
    const all = avg(has.map((x) => x.c[f] as number));
    const byWd = Array.from({ length: 7 }, (_, wd) => { const v = has.filter((x) => x.wd === wd).map((x) => x.c[f] as number); return v.length >= 2 ? avg(v) - all : 0; });
    const w = has.filter((x) => x.dose).map((x) => x.c[f] as number), wo = has.filter((x) => !x.dose).map((x) => x.c[f] as number);
    const doseEffect = w.length >= 4 && wo.length >= 4 ? avg(w) - avg(wo) : 0;
    const recent = has.filter((x) => x.t > now - 14 * DAY).map((x) => x.c[f] as number);
    const older = has.filter((x) => x.t <= now - 14 * DAY).map((x) => x.c[f] as number);
    const trend = recent.length >= 4 && older.length >= 4 ? (avg(recent) - avg(older)) / 2 : 0;
    const dosedShare = w.length / has.length;
    return [f, { all, byWd, doseEffect, trend, dosedShare }];
  })) as Record<Field, { all: number; byWd: number[]; doseEffect: number; trend: number; dosedShare: number } | null>;
  if (fields.every((f) => !model[f])) return null;
  const days: DayForecast[] = [];
  for (let i = 1; i <= 7; i++) {
    const start = dayStartOffset(now, i, s);
    const end = getDayBounds(start, s.dayStartsAt, s.tz).end;
    const dose = sched.some((m) => plannedDoses(m, doses, start, end, s).length > 0);
    const values: Partial<Record<Field, number>> = {};
    for (const f of fields) {
      const m = model[f];
      if (!m) continue;
      const v = m.all + m.byWd[weekdayOf(start, s)] + m.trend + (dose ? (1 - m.dosedShare) : -m.dosedShare) * m.doseEffect;
      values[f] = r(Math.max(1, Math.min(5, v)));
    }
    days.push({ start, dose, values });
  }
  return { days, checkIns: cis.length, weeks: Math.round((now - first) / (7 * DAY)) };
}
