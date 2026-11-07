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
  it('a new scale wins over an old app with a longer history', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date(2026, 10, 7, 9, 0).getTime();
    // A year of weights from an old app, then two weeks of Renpho.
    const old = Array.from({ length: 300 }, (_, i) => ({ t: now - (330 - i) * 86_400_000, kg: 125, src: 'com.fitbit' }));
    const renpho = Array.from({ length: 14 }, (_, i) => ({ t: now - (14 - i) * 86_400_000 + 3_600_000, kg: 117 - i * 0.1, src: 'com.qingniu.renpho' }));
    const fitbitCopies = renpho.slice(0, 3).map((w) => ({ ...w, t: w.t + 600_000, kg: 118, src: 'com.fitbit' }));
    const plan = planHealthImport({ days: [], bp: [], weights: [...old, ...renpho, ...fitbitCopies] }, { daily: [], body: [], vitals: [] }, undefined, tz, new Date(now).toISOString());
    const last = plan.body.sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    expect(last.map((b) => b.kg)).toEqual(renpho.map((w) => Math.round(w.kg * 10) / 10));
  });
  it('body fat from the same weigh-in, and earlier imported days corrected', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const am = new Date(2026, 10, 6, 6, 30).getTime(), pm = new Date(2026, 10, 6, 19, 0).getTime();
    const date = '2026-11-06';
    const plan = planHealthImport({ days: [], bp: [], weights: [{ t: am, kg: 110, src: 'r' }, { t: pm, kg: 111.5, src: 'r' }], bodyFat: [{ t: am, pct: 38.2 }, { t: pm, pct: 41.0 }] },
      { daily: [], body: [{ id: 'x', date, weightKg: 110, bodyFatPct: 41, note: 'From Health', createdAt: '', updatedAt: '' }], vitals: [] }, undefined, tz, new Date(pm).toISOString());
    expect(plan.comp.find((c) => c.date === date)?.bodyFatPct).toBe(38.2);
    // A figure typed in by hand stays.
    const kept = planHealthImport({ days: [], bp: [], weights: [{ t: am, kg: 110, src: 'r' }], bodyFat: [{ t: am, pct: 38.2 }] },
      { daily: [], body: [{ id: 'x', date, weightKg: 110, bodyFatPct: 36, createdAt: '', updatedAt: '' }], vitals: [] }, undefined, tz, new Date(pm).toISOString());
    expect(kept.comp.find((c) => c.date === date)?.bodyFatPct).toBeUndefined();
  });
  it('nothing new, no notice', () => {
    const plan = planHealthImport({ days: [], bp: [], weights: [] }, { daily: [], body: [], vitals: [] }, undefined, 'UTC', 'now');
    expect(plan.newest).toBeUndefined();
  });
});

describe('the Food tab', () => {
  it('sits after Stack when food is on: five tabs at most, with sleep and training inside Health', () => {
    const all = tabsFor(true, true, true, true, true).map((t) => t.label);
    expect(all).toEqual(['Today', 'Stack', 'Food', 'Body', 'Health']);
    // Health opens on Sleep or Training when the watch's data isn't on.
    expect(tabsFor(true, true, true, false, true).find((t) => t.label === 'Health')?.path).toBe('/sleep');
    expect(tabsFor(true, true, false, false, true).find((t) => t.label === 'Health')?.path).toBe('/training');
    expect(tabsFor(true, false, false, false, true).map((t) => t.label)).toEqual(['Today', 'Stack', 'Food', 'Body']);
    expect(tabsFor(true, false, false, false, false).map((t) => t.label)).not.toContain('Food');
  });
});
