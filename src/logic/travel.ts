// Planning dose times across time zones before a trip (both apps). Two ways to handle the change: switch to local
// time on the day you leave, or move the times gradually (up to 2 hours a day). Each shows the gaps between doses and
// flags any shorter than the person's own minimum gap, or much shorter or longer than usual. Pure; nothing is changed.
import type { Medication } from '../db/schema';
import { getSlots } from './schedule';
import { addDays, hhmmToMinutes, zonedParts, zonedToUtc } from './tz';

const HOUR = 3_600_000;

export interface TravelDose { at: number; local: string; day: string; amount: number }
export interface Strategy { doses: TravelDose[]; shortest: number; longest: number; flags: string[] }
export interface TravelPlan { med: Medication; usualGapH: number; switchNow: Strategy; gradual: Strategy; shiftH: number }

/** Offset of a time zone from UTC at an instant, in hours. */
export function offsetH(tz: string, at: number): number {
  const p = zonedParts(at, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(at / 60_000) * 60_000) / HOUR;
}

const fmtLocal = (at: number, tz: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(at);
const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** `normal[i]` is the gap before dose i+1 at home (no trip), to compare each gap with. */
function strategy(times: { at: number; amount: number }[], tz: string, normal: number[], minGapH?: number): Strategy {
  const doses = times.map((x) => {
    const p = zonedParts(x.at, tz);
    return { at: x.at, amount: x.amount, local: fmtLocal(x.at, tz), day: ymdOf(p.y, p.m, p.d) };
  });
  const gaps = doses.slice(1).map((d, i) => ({ h: Math.round(((d.at - doses[i].at) / HOUR) * 10) / 10, usual: Math.round(normal[i] * 10) / 10 }));
  const flags: string[] = [];
  for (const g of gaps) {
    const f = minGapH !== undefined && g.h < minGapH ? `${g.h} h between two doses: under your minimum of ${minGapH} h`
      : g.h < g.usual * 0.75 || g.h > g.usual * 1.25 ? `${fmtGap(g.h)} between two doses instead of the usual ${fmtGap(g.usual)}` : null;
    if (f && !flags.includes(f)) flags.push(f);
  }
  return { doses, shortest: Math.min(...gaps.map((g) => g.h)), longest: Math.max(...gaps.map((g) => g.h)), flags };
}
const fmtGap = (h: number) => (h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`);

/** Dose times around the day you leave (the day before to 6 days after; a fortnight either side for medicines not taken
 *  every day), switching to local time at once or moving up to 2 hours a day. Every-few-hours medicines count real hours
 *  and need no plan. */
export function travelPlan(med: Medication, homeTz: string, destTz: string, departYmd: string): TravelPlan | null {
  if (med.schedule.type !== 'fixed' || med.archived) return null;
  const sc = med.schedule;
  const slots = getSlots(med).map((x) => ({ min: hhmmToMinutes(x.time), amount: x.amount ?? med.defaultAmount })).sort((a, b) => a.min - b.min);
  if (!slots.length) return null;
  const [y, m, d] = departYmd.split('-').map(Number);
  const leave = zonedToUtc(y, m, d, 12, 0, homeTz);
  let shiftH = offsetH(destTz, leave) - offsetH(homeTz, leave);
  if (shiftH > 12) shiftH -= 24;
  if (shiftH < -12) shiftH += 24;
  // Which calendar days have doses (set days of the week, or every few days from the start date).
  const daily = !sc.days?.length && !(sc.everyNDays && sc.everyNDays > 1);
  const isDay = (off: number) => {
    const dd = addDays(y, m, d, off);
    const t = Date.UTC(dd.y, dd.m - 1, dd.d);
    if (sc.days?.length) return sc.days.includes(new Date(t).getUTCDay());
    if (sc.everyNDays && sc.everyNDays > 1 && sc.startDate) {
      const [sy, sm, sd] = sc.startDate.split('-').map(Number);
      return ((Math.round((t - Date.UTC(sy, sm - 1, sd)) / 86_400_000) % sc.everyNDays) + sc.everyNDays) % sc.everyNDays === 0;
    }
    return true;
  };
  const from = daily ? -1 : -14, to = daily ? 6 : 14;
  const at = (off: number, min: number, tz: string, extraH = 0) => {
    const dd = addDays(y, m, d, off);
    return zonedToUtc(dd.y, dd.m, dd.d, Math.floor(min / 60), min % 60, tz) - extraH * HOUR;
  };
  const home: { at: number; amount: number }[] = [];
  const switched: { at: number; amount: number }[] = [];
  const gradual: { at: number; amount: number }[] = [];
  let moved = 0;
  for (let i = from; i <= to; i++) {
    // Gradual: from leaving day, move up to 2 h a day towards local time (in home-time terms).
    if (i >= 0) moved = Math.sign(shiftH) * Math.min(Math.abs(shiftH), Math.abs(moved) + 2);
    if (!isDay(i)) continue;
    for (const sl of slots) {
      home.push({ at: at(i, sl.min, homeTz), amount: sl.amount });
      switched.push({ at: at(i, sl.min, i < 0 ? homeTz : destTz), amount: sl.amount });
      gradual.push({ at: at(i, sl.min, homeTz, moved), amount: sl.amount });
    }
  }
  if (home.length < 2) return null;
  const normal = home.slice(1).map((x, i) => (x.at - home[i].at) / HOUR);
  return {
    med, usualGapH: Math.min(...normal), shiftH,
    switchNow: strategy(switched, destTz, normal, sc.minHoursApart),
    gradual: strategy(gradual, destTz, normal, sc.minHoursApart),
  };
}
