// Wear-off forecast for today: when a dose taken today is likely to stop working, from the person's own effect window,
// adjusted by what has shifted it for them before (a short night, caffeine after the dose, a bigger or smaller dose),
// and nudged earlier when today's heart rate is already back to their usual. Pure.
import type { CheckIn, DailyHealth, Dose, Medication } from '../db/schema';
import { effectWindow } from './habits';
import { CAFFEINE } from './lifestyle';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { zonedParts } from './tz';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

export interface WearOff {
  med: Medication;
  dosedAt: number;
  /** Likely drop, and its usual spread (from past doses). */
  at: number; early: number; late: number;
  onset?: number;
  /** What moved today's forecast, e.g. "short night: 40 min earlier". */
  reasons: string[];
  /** Today's heart rate is already back to the person's usual. */
  heartBack: boolean;
  basis: number;
}

/** Hours from each past dose to the first "Wearing off" check-in after it (within 12 h). */
function observed(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number) {
  const taken = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) > now - 90 * DAY)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const wear = checkIns.filter((c) => !c.deletedAt && c.chips.includes('Wearing off')).map((c) => Date.parse(c.at)).sort((a, b) => a - b);
  return taken.map((d) => {
    const t = Date.parse(d.takenAt);
    const w = wear.find((x) => x > t + HOUR && x <= t + 12 * HOUR);
    return w === undefined ? null : { dose: d, t, h: (w - t) / HOUR };
  }).filter(Boolean) as { dose: Dose; t: number; h: number }[];
}

export function wearOffToday(med: Medication, doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings): WearOff | null {
  const win = effectWindow(med, doses, checkIns, now);
  if (!win || win.wearOffH === undefined) return null;
  const dayStart = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const today = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) >= dayStart && Date.parse(d.takenAt) <= now)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  if (!today) return null;
  const t0 = Date.parse(today.takenAt);
  let hours = win.wearOffH;
  const obs = observed(med, doses, checkIns, now);
  const reasons: string[] = [];

  // Personal shifts, each only when there's enough on both sides and it's at least 15 minutes.
  const sleepOn = (t: number) => {
    const key = dayKey(t, s);
    const row = daily.find((x) => x.date === key && x.sleepMin);
    if (row) return row.sleepMin! / 60;
    const ci = checkIns.find((c) => !c.deletedAt && c.sleepHours && dayKey(Date.parse(c.at), s) === key);
    return ci?.sleepHours;
  };
  const caffeineAfter = (t: number) => checkIns.some((c) => !c.deletedAt && c.chips.includes(CAFFEINE) && Date.parse(c.at) > t && Date.parse(c.at) < t + 4 * HOUR);
  const shift = (label: string, isToday: boolean, test: (o: { dose: Dose; t: number }) => boolean | undefined) => {
    const a = obs.filter((o) => test(o) === true).map((o) => o.h), b = obs.filter((o) => test(o) === false).map((o) => o.h);
    if (!isToday || a.length < 2 || b.length < 2) return;
    const d = mean(a)! - mean(b)!;
    if (Math.abs(d) < 0.25) return;
    hours += d;
    reasons.push(`${label}: ${Math.round(Math.abs(d) * 60)} min ${d < 0 ? 'earlier' : 'later'}`);
  };
  const sleepToday = sleepOn(t0);
  shift('Short night', sleepToday !== undefined && sleepToday < 6.5, (o) => { const h = sleepOn(o.t); return h === undefined ? undefined : h < 6.5; });
  shift('Caffeine after the dose', caffeineAfter(t0), (o) => caffeineAfter(o.t));
  const usual = mean(obs.map((o) => o.dose.amount)) ?? today.amount;
  if (Math.abs(today.amount - usual) / usual >= 0.2) shift(today.amount > usual ? 'Bigger dose' : 'Smaller dose', true, (o) => (today.amount > usual ? o.dose.amount > usual * 1.1 : o.dose.amount < usual * 0.9));

  const spread = Math.max(0.25, obs.length >= 4 ? (quantile(obs.map((o) => o.h), 0.75) - quantile(obs.map((o) => o.h), 0.25)) / 2 : 0.75);
  let at = t0 + hours * HOUR;

  // Heart rate back to the usual daytime level for this time since the dose, before the forecast: likely wearing off now.
  let heartBack = false;
  const row = daily.find((x) => x.date === dayKey(now, s));
  const resting = row?.restingHr ?? mean(daily.filter((x) => x.restingHr).slice(-14).map((x) => x.restingHr!));
  if (row?.hrByHour && resting && now < at && now - t0 > 2 * HOUR) {
    const h = Math.floor(zonedParts(now - HOUR, s.tz).h);
    const bpm = row.hrByHour[h];
    if (typeof bpm === 'number' && bpm <= resting + 5) { heartBack = true; at = Math.min(at, now + 30 * 60_000); reasons.push('Heart rate already back to your usual'); }
  }
  return { med, dosedAt: t0, at, early: at - spread * HOUR, late: at + spread * HOUR,
    onset: win.onsetH !== undefined ? t0 + win.onsetH * HOUR : undefined, reasons, heartBack, basis: obs.length || win.doses };
}
