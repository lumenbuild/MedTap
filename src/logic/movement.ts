// Everyday movement and rest (both apps, from the watch or phone): a steps target that grows from the person's own
// recent days, and how regular their sleep is. Pure.
import type { DailyHealth } from '../db/schema';

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const dayMs = (ymd: string) => new Date(`${ymd}T12:00`).getTime();

/** A steps target a little above the person's usual: the median of the last four weeks plus 10%, to the next 500,
 *  between 4,000 and 12,000. Needs 10 days with steps. */
export function stepsTarget(daily: DailyHealth[], now: number): number | null {
  const xs = daily.filter((d) => !d.deletedAt && d.steps && dayMs(d.date) > now - 28 * DAY && dayMs(d.date) < now - DAY / 2).map((d) => d.steps!);
  if (xs.length < 10) return null;
  return Math.min(12000, Math.max(4000, Math.ceil((median(xs) * 1.1) / 500) * 500));
}

/** Steps a day over the last two weeks against the four before them (a drop often comes with eating less). */
export function stepsChange(daily: DailyHealth[], now: number): { now: number; before: number } | null {
  const avg = (a: number, b: number) => { const xs = daily.filter((d) => !d.deletedAt && d.steps && dayMs(d.date) >= a && dayMs(d.date) < b).map((d) => d.steps!); return xs.length >= 7 ? xs.reduce((p, q) => p + q, 0) / xs.length : null; };
  const n = avg(now - 14 * DAY, now), b = avg(now - 42 * DAY, now - 14 * DAY);
  return n === null || b === null ? null : { now: Math.round(n), before: Math.round(b) };
}

/** How much sleep varies night to night over the last two weeks (standard deviation, hours) and the average. */
export function sleepRegularity(daily: DailyHealth[], now: number): { avgH: number; spreadH: number; nights: number } | null {
  const xs = daily.filter((d) => !d.deletedAt && d.sleepMin && dayMs(d.date) >= now - 14 * DAY - DAY / 2).map((d) => d.sleepMin! / 60);
  if (xs.length < 7) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return { avgH: Math.round(m * 10) / 10, spreadH: Math.round(sd * 10) / 10, nights: xs.length };
}
