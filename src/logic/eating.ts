// Hunger and cravings (food logs with "how hungry" and "why"): how much eating isn't from hunger, the usual reason,
// when it happens, and whether short sleep or a low-protein day goes with more of it. From the person's own logs;
// links, not causes. Pure.
import type { DailyHealth, EatWhy, FoodLog } from '../db/schema';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
export const WHY_LABEL: Record<EatWhy, string> = { hungry: 'hunger', craving: 'a craving', stress: 'stress', bored: 'boredom', habit: 'habit', social: 'company' };

export interface EatingPatterns {
  /** Logs that said how hungry or why, in the window. */
  answered: number;
  /** Of those, the share eaten without real hunger (a reason other than hunger, or hunger 1–2). */
  notHungryPct: number;
  topWhy?: { why: EatWhy; n: number };
  /** Of the eating without hunger, the share after 6 pm. */
  eveningPct?: number;
  /** Days with eating without hunger: after a short night (under 6.5 h) against after a longer one. */
  shortSleep?: { withPct: number; withoutPct: number };
  /** The same against the day's protein: under 70% of the target against at or over it. */
  lowProtein?: { withPct: number; withoutPct: number };
}

const notHungry = (l: FoodLog) => (l.why !== undefined && l.why !== 'hungry') || (l.hunger !== undefined && l.hunger <= 2);

export function eatingPatterns(foodLogs: FoodLog[], daily: DailyHealth[], now: number, s: ScheduleSettings, proteinTarget: number | null): EatingPatterns | null {
  const logs = foodLogs.filter((l) => !l.deletedAt && (l.why !== undefined || l.hunger !== undefined) && Date.parse(l.at) > now - 30 * DAY && Date.parse(l.at) <= now);
  if (logs.length < 10) return null;
  const nh = logs.filter(notHungry);
  const counts = new Map<EatWhy, number>();
  for (const l of nh) if (l.why) counts.set(l.why, (counts.get(l.why) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const out: EatingPatterns = { answered: logs.length, notHungryPct: Math.round((nh.length / logs.length) * 100), topWhy: top ? { why: top[0], n: top[1] } : undefined };
  if (nh.length >= 5) out.eveningPct = Math.round((nh.filter((l) => new Date(Date.parse(l.at)).getHours() >= 18).length / nh.length) * 100);

  // Day by day: did eating without hunger happen, against the night before and the day's protein.
  const days = [...new Set(logs.map((l) => dayKey(Date.parse(l.at), s)))];
  const hadNH = (k: string) => nh.some((l) => dayKey(Date.parse(l.at), s) === k);
  const dh = new Map(daily.filter((x) => !x.deletedAt).map((x) => [x.date, x]));
  const split = (test: (k: string) => boolean | null) => {
    const w = days.filter((k) => test(k) === true), wo = days.filter((k) => test(k) === false);
    if (w.length < 4 || wo.length < 4) return undefined;
    const pct = (xs: string[]) => Math.round((xs.filter(hadNH).length / xs.length) * 100);
    return { withPct: pct(w), withoutPct: pct(wo) };
  };
  out.shortSleep = split((k) => { const m = dh.get(k)?.sleepMin; return m === undefined ? null : m < 390; });
  if (proteinTarget) out.lowProtein = split((k) => { const p = dh.get(k)?.proteinG; return p === undefined ? null : p < proteinTarget * 0.7; });
  return out;
}
