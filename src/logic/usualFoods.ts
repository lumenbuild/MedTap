// The foods someone eats again and again: the ones logged most in the last 30 days (most recent first among
// equals), each with its last log, so "the usual" is one tap, at the same amount. And the last 7 days' totals. Pure.
import type { Food, FoodLog, Nutrients } from '../db/schema';
import { addNutrients } from './nutrition';

const DAY = 86_400_000;

export interface Usual { food: Food; last: FoodLog; count: number }

export function usualFoods(logs: FoodLog[], foods: Food[], now: number, n = 6): Usual[] {
  const byId = new Map(foods.filter((f) => !f.deletedAt).map((f) => [f.id, f]));
  const seen = new Map<string, Usual>();
  for (const l of logs) {
    const t = Date.parse(l.at);
    if (l.deletedAt || !l.foodId || t < now - 30 * DAY || t > now) continue;
    const food = byId.get(l.foodId);
    if (!food) continue;
    const u = seen.get(l.foodId);
    if (!u) seen.set(l.foodId, { food, last: l, count: 1 });
    else { u.count++; if (l.at > u.last.at) u.last = l; }
  }
  return [...seen.values()].filter((u) => u.count >= 2 || u.food.favourite)
    .sort((a, b) => b.count - a.count || b.last.at.localeCompare(a.last.at)).slice(0, n);
}

/** Totals for each of the last `days` calendar days, oldest first (today last). */
export function dailyTotals(logs: FoodLog[], now: number, days = 7): { start: number; n: Nutrients; logged: boolean }[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (days - 1 - i));
    const e = new Date(d); e.setDate(e.getDate() + 1);
    const ls = logs.filter((l) => !l.deletedAt && Date.parse(l.at) >= d.getTime() && Date.parse(l.at) < e.getTime());
    return { start: d.getTime(), n: addNutrients(...ls.map((l) => l.nutrients)), logged: ls.length > 0 };
  });
}
