// Side effects against what was eaten and drunk (both apps with food): constipation after low-fibre or low-water days,
// nausea or reflux after a big meal. Common on GLP-1s; the links in the person's own records, not causes. Pure.
import type { CheckIn, DailyHealth, FoodLog } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;

export interface GutLink { chip: string; factor: 'fibre' | 'water' | 'big-meal'; text: string; withPct: number; withoutPct: number; withN: number; withoutN: number }

/** Each finding: how often the side effect came up the same or next day, with the factor and without it. Needs five
 *  days on each side and a gap of at least 20 points. */
export function gutLinks(foodLogs: FoodLog[], daily: DailyHealth[], checkIns: CheckIn[], now: number, s: ScheduleSettings, fibreTarget = 25): GutLink[] {
  const from = now - 60 * DAY;
  const days = new Map<string, { kcal: number; fibre: number; biggest: number }>();
  for (const l of foodLogs) {
    if (l.deletedAt) continue;
    const t = Date.parse(l.at);
    if (t < from || t > now) continue;
    const k = dayKey(t, s);
    const d = days.get(k) ?? { kcal: 0, fibre: 0, biggest: 0 };
    d.kcal += l.nutrients.kcal ?? 0; d.fibre += l.nutrients.fibre ?? 0; d.biggest = Math.max(d.biggest, l.nutrients.kcal ?? 0);
    days.set(k, d);
  }
  const water = new Map(daily.filter((x) => !x.deletedAt && x.waterMl).map((x) => [x.date, x.waterMl!]));
  // Check-ins by day, so "the same or next day" is a lookup.
  const cis = new Map<string, CheckIn[]>();
  for (const c of checkIns) { if (c.deletedAt) continue; const k = dayKey(Date.parse(c.at), s); cis.set(k, [...(cis.get(k) ?? []), c]); }
  const next = (k: string) => dayKey(new Date(`${k}T12:00`).getTime() + DAY, s);
  const had = (k: string, chip: string) => [...(cis.get(k) ?? []), ...(cis.get(next(k)) ?? [])].some((c) => c.chips.includes(chip));
  const asked = (k: string) => (cis.get(k)?.length ?? 0) + (cis.get(next(k))?.length ?? 0) > 0;
  const full = [...days.entries()].filter(([k, d]) => d.kcal >= 1000 && asked(k));
  const out: GutLink[] = [];
  const compare = (chip: string, factor: GutLink['factor'], test: (k: string, d: { kcal: number; fibre: number; biggest: number }) => boolean | null, text: string) => {
    const w = full.filter(([k, d]) => test(k, d) === true), wo = full.filter(([k, d]) => test(k, d) === false);
    if (w.length < 5 || wo.length < 5) return;
    const pct = (xs: typeof full) => Math.round((xs.filter(([k]) => had(k, chip)).length / xs.length) * 100);
    const a = pct(w), b = pct(wo);
    if (a - b >= 20) out.push({ chip, factor, text, withPct: a, withoutPct: b, withN: w.length, withoutN: wo.length });
  };
  compare('Constipation', 'fibre', (_, d) => d.fibre < fibreTarget * 0.7, `under ${Math.round(fibreTarget * 0.7)} g of fibre`);
  compare('Constipation', 'water', (k) => (water.has(k) ? water.get(k)! < 1500 : null), 'under 1.5 L of water');
  for (const chip of ['Nausea', 'Reflux']) compare(chip, 'big-meal', (_, d) => d.biggest >= 800, 'a meal of 800 Cal or more');
  return out.sort((x, y) => (y.withPct - y.withoutPct) - (x.withPct - x.withoutPct));
}
