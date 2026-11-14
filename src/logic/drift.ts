// When a medicine's reminder time and the time it's actually logged have drifted apart: a 6:00 am reminder for a dose
// logged around 10:30 am most days. Only the reminder is offered to move, never when to take it (that's for the
// prescriber). Single-time daily schedules only; logs typed in afterwards (backdated) don't count. Pure.
import type { Dose, Medication } from '../db/schema';
import { zonedParts } from './tz';

export interface Drift { slot: string; usual: string; usualMin: number; slotMin: number; n: number }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

/** The last 5 logs: 4+ of them 90+ minutes from the reminder on the same side, within 3 hours of each other. */
export function reminderDrift(med: Medication, doses: Dose[], tz: string): Drift | null {
  const slots = med.schedule.type === 'fixed' ? (med.schedule.slots ?? (med.schedule.times ?? []).map((time) => ({ time }))) : [];
  if (slots.length !== 1 || med.archived) return null;
  const slotMin = toMin(slots[0].time);
  const logs = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && d.source !== 'backdated')
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, 5);
  if (logs.length < 5) return null;
  const mins = logs.map((d) => { const p = zonedParts(Date.parse(d.takenAt), tz); return p.h * 60 + p.mi; });
  const off = mins.map((m) => m - slotMin);
  const later = off.filter((x) => x >= 90), earlier = off.filter((x) => x <= -90);
  const side = later.length >= 4 ? later : earlier.length >= 4 ? earlier : null;
  if (!side) return null;
  const xs = side.map((x) => x + slotMin).sort((a, b) => a - b);
  if (xs[xs.length - 1] - xs[0] > 180) return null;
  // To the nearest quarter hour.
  const usualMin = Math.round(xs[xs.length >> 1] / 15) * 15;
  return { slot: slots[0].time, usual: hhmm(usualMin), usualMin, slotMin, n: side.length };
}
