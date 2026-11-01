// Peptides, day to day: what to do about a missed shot (once or twice a week), and what each dose has cost per kg
// lost. From the person's own records. Pure.
import type { BodyEntry, CheckIn, Dose, Medication } from '../db/schema';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { pricePerUnit } from './cost';
import { stepReport } from './protocol';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const live = (d: Dose) => !d.deletedAt;

// ── A missed shot ───────────────────────────────────────────────────────────────────────────────────

export interface MissedShot { dueAt: number; nextAt: number; take: boolean; text: string }

/** A shot on set weekdays (once or a few times a week) that's past its day with nothing logged for it. Take it now if
 *  the next one is far enough off (3 days on a weekly schedule, after tirzepatide's 4-day rule; 2 days when split),
 *  otherwise skip it and keep the usual day. */
export function missedShot(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): MissedShot | null {
  const sc = med.schedule;
  if (sc.type !== 'fixed' || !sc.days?.length || sc.days.length > 3 || med.archived) return null;
  const slot = (sc.slots?.[0]?.time ?? sc.times?.[0] ?? '08:00').split(':').map(Number);
  const at = (dayStart: number) => { const d = new Date(dayStart + 12 * HOUR); d.setHours(slot[0], slot[1] || 0, 0, 0); return d.getTime(); };
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const dow = (t: number) => new Date(t + 12 * HOUR).getDay();
  // The most recent due day before today, and the next one from today.
  let dueAt: number | undefined, nextAt: number | undefined;
  for (let i = 1; i <= 7 && dueAt === undefined; i++) if (sc.days.includes(dow(today - i * DAY))) dueAt = at(today - i * DAY);
  for (let i = 0; i <= 7 && nextAt === undefined; i++) { const t = at(today + i * DAY); if (sc.days.includes(dow(today + i * DAY)) && t > now) nextAt = t; }
  if (dueAt === undefined || nextAt === undefined) return null;
  const mine = doses.filter((d) => live(d) && d.medicationId === med.id);
  if (!mine.length) return null;
  const gapDays = sc.days.length === 1 ? 7 : 7 / sc.days.length;
  // Any shot (or a skip on purpose) in the second half of the gap before it was due, or since: not missed. A shot taken
  // a few days early counts, so this never says "take it now" on top of one already taken.
  const since = dueAt - (gapDays / 2) * DAY;
  if (doses.some((d) => !d.deletedAt && d.medicationId === med.id && Date.parse(d.takenAt) >= since && Date.parse(d.takenAt) <= now)) return null;
  const needH = gapDays >= 6 ? 72 : 48;
  const take = nextAt - now >= needH * HOUR;
  const nextDay = new Date(nextAt).toLocaleDateString('en-AU', { weekday: 'long' });
  return { dueAt, nextAt, take, text: take
    ? `Missed ${new Date(dueAt).toLocaleDateString('en-AU', { weekday: 'long' })}’s shot: there’s still time to take it now, then carry on with ${nextDay}’s as usual.`
    : `Missed ${new Date(dueAt).toLocaleDateString('en-AU', { weekday: 'long' })}’s shot: ${nextDay}’s is close, so the usual approach is to skip it and take ${nextDay}’s as normal. Doubling up isn’t needed.` };
}

// ── Cost per kg lost ────────────────────────────────────────────────────────────────────────────────

export interface CostPerKg { dose: number; weeks: number; kgLost: number; spent: number; perKg: number }

/** For each dose step with a price and at least 0.5 kg lost over 2+ weeks: what it cost, per kg lost. */
export function costPerKg(med: Medication, doses: Dose[], body: BodyEntry[], checkIns: CheckIn[], now: number): CostPerKg[] {
  const out: CostPerKg[] = [];
  for (const st of stepReport(med, doses, body, checkIns, now)) {
    if (st.weightPerWeek === undefined || st.weeks < 2) continue;
    const kgLost = -st.weightPerWeek * st.weeks;
    if (kgLost < 0.5) continue;
    let spent = 0, priced = true;
    for (const d of doses.filter((x) => live(x) && !x.skipped && x.medicationId === med.id && Date.parse(x.takenAt) >= st.from && Date.parse(x.takenAt) < st.to)) {
      const p = pricePerUnit(med, d.vialId);
      if (p === undefined) { priced = false; break; }
      spent += d.amount * p;
    }
    if (!priced || !spent) continue;
    out.push({ dose: st.dose, weeks: st.weeks, kgLost: Math.round(kgLost * 10) / 10, spent: Math.round(spent), perKg: Math.round(spent / kgLost) });
  }
  return out;
}
