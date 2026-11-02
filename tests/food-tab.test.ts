import { describe, it, expect } from 'vitest';
import type { Food, FoodLog } from '../src/db/schema';
import { dailyTotals, usualFoods } from '../src/logic/usualFoods';
import { planHealthImport } from '../src/logic/healthImport';
import { tabsFor } from '../src/components/TabBar';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 2, 18, 0).getTime();
const st = { createdAt: '', updatedAt: '' };
const food = (id: string, o: Partial<Food> = {}): Food => ({ id, name: id, kind: 'product', nutrients: { kcal: 200, protein: 20 }, ...st, ...o });
const log = (foodId: string, daysAgo: number, o: Partial<FoodLog> = {}): FoodLog =>
  ({ id: `${foodId}${daysAgo}${o.servings ?? ''}`, at: new Date(NOW - daysAgo * DAY).toISOString(), name: foodId, foodId, servings: 1, nutrients: { kcal: 200, protein: 20 }, ...st, ...o });

describe('the usual foods', () => {
  it('most logged in 30 days, with the last amount', () => {
    const foods = [food('oats'), food('yoghurt'), food('pizza'), food('old'), food('fav', { favourite: true })];
    const logs = [log('oats', 1), log('oats', 2), log('oats', 3, { servings: 1.5, nutrients: { kcal: 300 } }), log('oats', 0.2, { servings: 2, nutrients: { kcal: 400 } }),
      log('yoghurt', 1), log('yoghurt', 5), log('pizza', 4), log('old', 40), log('old', 41), log('fav', 3)];
    const u = usualFoods(logs, foods, NOW);
    expect(u.map((x) => x.food.id)).toEqual(['oats', 'yoghurt', 'fav']); // pizza once, old too long ago; a favourite once counts
    expect(u[0].last.servings).toBe(2); // the most recent amount
    expect(u[0].count).toBe(4);
  });
  it('a deleted food or log is left out', () => {
    const u = usualFoods([log('a', 1), log('a', 2, { deletedAt: 'x' }), log('b', 1), log('b', 2)], [food('a'), food('b', { deletedAt: 'x' })], NOW);
    expect(u).toEqual([]);
  });
  it('seven days of totals, today last', () => {
    const d = dailyTotals([log('a', 0), log('a', 0.1), log('a', 2)], NOW, 7);
    expect(d).toHaveLength(7);
    expect(d[6].n.kcal).toBe(400);
    expect(d[4].n.kcal).toBe(200);
    expect(d[5].logged).toBe(false);
  });
});

describe('a smart scale through Health Connect', () => {
  it('brings in bone, water and BMR with body fat and lean, and names the new weigh-in', () => {
    const t = new Date(2026, 10, 2, 6, 30).getTime();
    const plan = planHealthImport({
      days: [], bp: [], weights: [{ t, kg: 116.2, src: 'com.qingniu.renpho' }],
      bodyFat: [{ t, pct: 39.84 }], lean: [{ t, kg: 69.9 }], bone: [{ t, kg: 3.61 }], water: [{ t, kg: 50.2 }], bmr: [{ t, kcal: 2104.6 }],
    }, { daily: [], body: [], vitals: [] }, undefined, Intl.DateTimeFormat().resolvedOptions().timeZone, 'now');
    expect(plan.comp[0]).toMatchObject({ bodyFatPct: 39.8, leanKg: 69.9, boneKg: 3.6, waterKg: 50.2, bmrKcal: 2105 });
    expect(plan.newest).toMatchObject({ kg: 116.2, bodyFatPct: 39.8 });
  });
  it('nothing new, no notice', () => {
    const plan = planHealthImport({ days: [], bp: [], weights: [] }, { daily: [], body: [], vitals: [] }, undefined, 'UTC', 'now');
    expect(plan.newest).toBeUndefined();
  });
});

describe('the Food tab', () => {
  it('sits after Stack when food is on, and every tab still fits', () => {
    const all = tabsFor(true, true, true, true, true).map((t) => t.label);
    expect(all).toEqual(['Today', 'Stack', 'Food', 'Insights', 'Training', 'Sleep', 'Health']);
    expect(tabsFor(true, false, false, false, false).map((t) => t.label)).not.toContain('Food');
  });
});
