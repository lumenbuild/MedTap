// Display formatting. Times are always shown in the device's time zone.
import { format } from 'date-fns';
import type { Medication, Schedule } from '../db/schema';

const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

/** "3:02 pm" */
export function fmtTime(ms: number): string {
  return timeFmt.format(ms).replace(/\s/g, ' ').toLowerCase();
}

/** "3:02 pm", "yesterday 9:10 pm" or "Mon 12 Oct, 9:10 pm" */
export function fmtWhen(ms: number, now: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return fmtTime(ms);
  if (day(ms) === day(now - 86_400_000)) return `yesterday ${fmtTime(ms)}`;
  return `${dayFmt.format(ms)}, ${fmtTime(ms)}`;
}

/** "2h 14m", "14m", "3d 2h" */
export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return 'less than a minute';
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "2h 14m ago" or "just now" */
export function fmtAgo(ms: number): string {
  return ms < 60_000 ? 'just now' : `${fmtDuration(ms)} ago`;
}

/** Countdown as h:mm, rounded up so it never reads 0:00 before it's due. */
export function fmtCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}

/** Spoken countdown for screen readers: "2 hours 5 minutes" */
export function fmtCountdownLong(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m || !h) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** "10 mg", "1.5 tablets" */
export function fmtAmount(amount: number, unit: string): string {
  const n = Number(amount.toFixed(3)).toString();
  if (unit === 'tablet') return `${n} tablet${amount === 1 ? '' : 's'}`;
  return `${n} ${unit}`;
}

/** "4:00 pm" from 'HH:mm' */
export function fmtHHmm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return fmtTime(d.getTime());
}

export function fmtSchedule(s: Schedule): string {
  if (s.type === 'interval') {
    const parts = [`Every ${s.intervalHours} hour${s.intervalHours === 1 ? '' : 's'}`];
    if (s.maxPerDay) parts.push(`up to ${s.maxPerDay} a day`);
    if (s.latestDoseTime) parts.push(`latest ${fmtHHmm(s.latestDoseTime)}`);
    return parts.join(', ');
  }
  if (s.type === 'fixed') return (s.times ?? []).map(fmtHHmm).join(', ') || 'Set times';
  return 'As needed';
}

export function fmtMedName(m: Pick<Medication, 'name' | 'strength' | 'unit'>): string {
  return m.strength ? `${m.name} ${fmtAmount(m.strength, m.unit)}` : m.name;
}

/** Value for <input type="datetime-local"> in device time. */
export function toLocalInput(ms: number): string {
  return format(ms, "yyyy-MM-dd'T'HH:mm");
}

/** Parse <input type="datetime-local"> (device time) to UTC ms. */
export function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}
