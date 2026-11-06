// Vitamins and minerals: each day's intake against the Australian and New Zealand nutrient reference values (by sex and
// age), the last 7 days' average, which ones run low, and the foods that would fix them (your own first). Labels
// rarely list micronutrients, so foods without them get an estimate from what they are (chicken, spinach, oats…):
// typical amounts per 100 g (AUSNUT and USDA, rounded) scaled by the entry's calories. How much of the day's food is
// covered is said alongside. Estimates for a pattern, not a lab test. Pure.
import type { FoodLog, Nutrients } from '../db/schema';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

export type MicroKey = 'potassium' | 'calcium' | 'iron' | 'magnesium' | 'zinc' | 'iodine' | 'selenium' | 'vitA' | 'b1' | 'b2' | 'b3' | 'b6' | 'b9' | 'b12' | 'vitC' | 'vitD' | 'vitE' | 'vitK';
export const MICROS: { key: MicroKey; label: string; unit: 'mg' | 'µg'; kind: 'vitamin' | 'mineral'; m: number; f: number; upper?: number }[] = [
  { key: 'vitA', label: 'Vitamin A', unit: 'µg', kind: 'vitamin', m: 900, f: 700, upper: 3000 },
  { key: 'b1', label: 'Thiamin (B1)', unit: 'mg', kind: 'vitamin', m: 1.2, f: 1.1 },
  { key: 'b2', label: 'Riboflavin (B2)', unit: 'mg', kind: 'vitamin', m: 1.3, f: 1.1 },
  { key: 'b3', label: 'Niacin (B3)', unit: 'mg', kind: 'vitamin', m: 16, f: 14 },
  { key: 'b6', label: 'Vitamin B6', unit: 'mg', kind: 'vitamin', m: 1.3, f: 1.3, upper: 50 },
  { key: 'b9', label: 'Folate', unit: 'µg', kind: 'vitamin', m: 400, f: 400 },
  { key: 'b12', label: 'Vitamin B12', unit: 'µg', kind: 'vitamin', m: 2.4, f: 2.4 },
  { key: 'vitC', label: 'Vitamin C', unit: 'mg', kind: 'vitamin', m: 45, f: 45 },
  { key: 'vitD', label: 'Vitamin D', unit: 'µg', kind: 'vitamin', m: 5, f: 5, upper: 80 },
  { key: 'vitE', label: 'Vitamin E', unit: 'mg', kind: 'vitamin', m: 10, f: 7, upper: 300 },
  { key: 'vitK', label: 'Vitamin K', unit: 'µg', kind: 'vitamin', m: 70, f: 60 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', kind: 'mineral', m: 1000, f: 1000, upper: 2500 },
  { key: 'iron', label: 'Iron', unit: 'mg', kind: 'mineral', m: 8, f: 18, upper: 45 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', kind: 'mineral', m: 420, f: 320 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', kind: 'mineral', m: 14, f: 8, upper: 40 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', kind: 'mineral', m: 3800, f: 2800 },
  { key: 'iodine', label: 'Iodine', unit: 'µg', kind: 'mineral', m: 150, f: 150, upper: 1100 },
  { key: 'selenium', label: 'Selenium', unit: 'µg', kind: 'mineral', m: 70, f: 60, upper: 400 },
];
const KEYS = MICROS.map((x) => x.key);

/** The daily target for a person: by sex (unknown: the higher of the two) and, for vitamin D, age. */
export function microTarget(key: MicroKey, sex?: 'm' | 'f', age?: number): number {
  const d = MICROS.find((x) => x.key === key)!;
  if (key === 'vitD' && age !== undefined) return age > 70 ? 15 : age > 50 ? 10 : 5;
  return sex === 'm' ? d.m : sex === 'f' ? d.f : Math.max(d.m, d.f);
}

// Per 100 g: kcal, then potassium, calcium, iron, magnesium, zinc (mg), iodine, selenium, vitamin A (µg), B1, B2, B3,
// B6 (mg), folate, B12 (µg), C (mg), D (µg), E (mg), K (µg).
type Prof = [string, string[], number, number[]];
const PROFILES: Prof[] = [
  ['Chicken breast', ['chicken breast', 'chicken'], 165, [256, 15, 1.0, 29, 1.0, 4, 28, 6, 0.07, 0.11, 13.7, 0.6, 4, 0.34, 0, 0.1, 0.3, 0.3]],
  ['Chicken thigh', ['chicken thigh', 'thigh'], 209, [240, 12, 1.1, 23, 2.0, 4, 23, 18, 0.07, 0.2, 6.5, 0.4, 7, 0.4, 0, 0.1, 0.3, 2]],
  ['Beef mince', ['mince', 'beef', 'burger', 'rissole', 'bolognese'], 250, [320, 18, 2.6, 21, 6.0, 3, 21, 0, 0.05, 0.18, 5.4, 0.35, 9, 2.6, 0, 0.1, 0.4, 1.2]],
  ['Steak', ['steak', 'rump', 'sirloin', 'scotch fillet', 'eye fillet'], 220, [340, 12, 2.8, 24, 5.5, 3, 30, 0, 0.07, 0.17, 7, 0.6, 7, 2.1, 0, 0.1, 0.4, 1.5]],
  ['Pork', ['pork', 'ham', 'bacon'], 240, [380, 20, 1.0, 25, 2.5, 5, 40, 2, 0.7, 0.25, 8, 0.5, 5, 0.7, 0, 0.5, 0.3, 0]],
  ['Lamb', ['lamb'], 260, [310, 15, 1.9, 24, 4.5, 3, 26, 0, 0.1, 0.25, 6.5, 0.15, 18, 2.6, 0, 0.1, 0.2, 3.6]],
  ['Salmon', ['salmon', 'trout'], 206, [384, 15, 0.3, 30, 0.4, 30, 41, 50, 0.2, 0.4, 8, 0.6, 26, 3.0, 0, 11, 1.1, 0.1]],
  ['Tuna', ['tuna'], 116, [237, 11, 1.0, 27, 0.8, 20, 80, 17, 0.03, 0.07, 13, 0.3, 4, 2.5, 0, 1.7, 0.9, 0]],
  ['White fish', ['fish', 'barramundi', 'snapper', 'cod', 'hoki', 'flathead'], 105, [400, 15, 0.4, 30, 0.5, 100, 33, 10, 0.03, 0.07, 2.5, 0.3, 10, 1.5, 0, 1, 0.6, 0.1]],
  ['Prawns', ['prawn', 'shrimp'], 99, [170, 70, 0.5, 35, 1.6, 35, 40, 0, 0.03, 0.02, 2.6, 0.1, 19, 1.1, 0, 0, 1.3, 0]],
  ['Eggs', ['egg', 'omelette', 'frittata'], 143, [138, 56, 1.8, 12, 1.3, 50, 31, 160, 0.04, 0.46, 0.1, 0.17, 47, 0.9, 0, 2.0, 1.1, 0.3]],
  ['Milk', ['milk', 'latte', 'flat white', 'cappuccino', 'smoothie'], 64, [150, 120, 0, 11, 0.4, 30, 3, 46, 0.04, 0.17, 0.1, 0.04, 5, 0.45, 0, 0.1, 0.07, 0.3]],
  ['Greek yoghurt', ['yoghurt', 'yogurt', 'skyr'], 97, [141, 110, 0.1, 11, 0.5, 20, 10, 30, 0.02, 0.28, 0.2, 0.06, 7, 0.75, 0, 0, 0.01, 0]],
  ['Cheese', ['cheese', 'cheddar', 'parmesan', 'mozzarella', 'feta'], 403, [98, 720, 0.7, 28, 3.1, 30, 14, 265, 0.03, 0.37, 0.06, 0.07, 18, 1.1, 0, 0.6, 0.7, 2.8]],
  ['Tofu', ['tofu', 'tempeh', 'edamame'], 144, [237, 350, 2.7, 58, 1.6, 0, 17, 8, 0.16, 0.1, 0.4, 0.09, 27, 0, 0, 0, 0, 2.4]],
  ['Lentils', ['lentil', 'dal', 'dhal'], 116, [369, 19, 3.3, 36, 1.3, 0, 2.8, 0, 0.17, 0.07, 1.1, 0.18, 181, 0, 1.5, 0, 0.1, 1.7]],
  ['Chickpeas', ['chickpea', 'hummus', 'falafel'], 139, [172, 45, 1.3, 30, 0.9, 0, 3, 1, 0.05, 0.03, 0.3, 0.5, 63, 0, 0, 0, 0.3, 2.1]],
  ['Beans', ['beans', 'kidney bean', 'black bean', 'burrito'], 127, [405, 28, 2.2, 42, 1.0, 0, 1, 0, 0.16, 0.06, 0.6, 0.12, 130, 0, 1.2, 0, 0.03, 8.4]],
  ['Oats', ['oats', 'porridge', 'muesli', 'overnight oats'], 389, [429, 54, 4.7, 177, 4.0, 1, 34, 0, 0.76, 0.14, 1.0, 0.12, 56, 0, 0, 0, 0.4, 2]],
  ['Fortified cereal', ['weet-bix', 'weetbix', 'cereal', 'bran', 'cornflakes'], 355, [380, 35, 11.7, 120, 2.5, 0, 6, 0, 1.1, 1.0, 10.9, 0.3, 240, 0, 0, 0, 0.7, 2]],
  ['Brown rice', ['brown rice', 'quinoa'], 123, [86, 10, 0.6, 39, 0.7, 0, 5.8, 0, 0.18, 0.02, 2.6, 0.12, 9, 0, 0, 0, 0.2, 0.6]],
  ['White rice', ['rice', 'sushi', 'fried rice'], 130, [35, 10, 0.2, 12, 0.5, 0, 7.5, 0, 0.02, 0.01, 0.4, 0.09, 3, 0, 0, 0, 0.04, 0]],
  ['Pasta', ['pasta', 'spaghetti', 'noodle', 'lasagne', 'penne'], 158, [44, 7, 0.5, 18, 0.5, 0, 26, 0, 0.02, 0.02, 0.4, 0.05, 7, 0, 0, 0, 0.06, 0]],
  ['Bread', ['bread', 'toast', 'sandwich', 'wrap', 'roll', 'bagel'], 250, [120, 50, 2.0, 25, 0.8, 46, 20, 0, 0.45, 0.1, 3.5, 0.1, 120, 0, 0, 0, 0.3, 1]],
  ['Wholemeal bread', ['wholemeal', 'wholegrain', 'sourdough rye', 'rye'], 240, [250, 60, 2.4, 75, 1.8, 46, 25, 0, 0.4, 0.12, 4.5, 0.2, 120, 0, 0, 0, 0.4, 7.8]],
  ['Potato', ['potato', 'mash', 'chips', 'fries', 'wedges'], 87, [380, 5, 0.3, 22, 0.3, 0, 0.3, 0, 0.1, 0.02, 1.4, 0.3, 10, 0, 13, 0, 0.01, 2]],
  ['Sweet potato', ['sweet potato', 'kumara', 'pumpkin'], 90, [475, 38, 0.7, 27, 0.3, 0, 0.2, 960, 0.1, 0.1, 1.5, 0.3, 6, 0, 20, 0, 0.7, 2.3]],
  ['Broccoli', ['broccoli', 'broccolini', 'brussels'], 35, [293, 40, 0.7, 21, 0.4, 0, 1.6, 77, 0.06, 0.12, 0.55, 0.2, 108, 0, 65, 0, 1.5, 141]],
  ['Spinach', ['spinach', 'silverbeet', 'leafy greens'], 23, [558, 99, 2.7, 79, 0.5, 0, 1, 469, 0.08, 0.19, 0.7, 0.2, 194, 0, 28, 0, 2.0, 483]],
  ['Kale', ['kale', 'cabbage', 'bok choy', 'salad'], 49, [491, 150, 1.5, 47, 0.6, 0, 0.9, 241, 0.1, 0.13, 1.0, 0.27, 141, 0, 120, 0, 1.5, 390]],
  ['Carrot', ['carrot'], 41, [320, 33, 0.3, 12, 0.2, 0, 0.1, 835, 0.07, 0.06, 1.0, 0.14, 19, 0, 6, 0, 0.7, 13]],
  ['Tomato', ['tomato', 'passata'], 18, [237, 10, 0.3, 11, 0.2, 0, 0, 42, 0.04, 0.02, 0.6, 0.08, 15, 0, 14, 0, 0.5, 8]],
  ['Capsicum', ['capsicum', 'stir fry', 'stir-fry', 'vegetables'], 31, [211, 7, 0.4, 12, 0.25, 0, 0.1, 157, 0.05, 0.09, 1.0, 0.3, 46, 0, 128, 0, 1.6, 5]],
  ['Mushrooms', ['mushroom'], 22, [318, 3, 0.5, 9, 0.5, 0, 9.3, 0, 0.08, 0.4, 3.6, 0.1, 17, 0.04, 2, 0.2, 0, 0]],
  ['Avocado', ['avocado', 'guacamole'], 160, [485, 12, 0.55, 29, 0.6, 0, 0.4, 7, 0.07, 0.13, 1.7, 0.26, 81, 0, 10, 0, 2.1, 21]],
  ['Banana', ['banana'], 89, [358, 5, 0.26, 27, 0.15, 0, 1, 3, 0.03, 0.07, 0.7, 0.37, 20, 0, 8.7, 0, 0.1, 0.5]],
  ['Orange', ['orange', 'mandarin', 'citrus', 'orange juice'], 47, [181, 40, 0.1, 10, 0.07, 0, 0.5, 11, 0.09, 0.04, 0.3, 0.06, 30, 0, 53, 0, 0.2, 0]],
  ['Apple', ['apple', 'pear'], 52, [107, 6, 0.1, 5, 0.04, 0, 0, 3, 0.02, 0.03, 0.1, 0.04, 3, 0, 4.6, 0, 0.2, 2.2]],
  ['Berries', ['berries', 'blueberr', 'strawberr', 'raspberr'], 45, [150, 15, 0.4, 10, 0.15, 0, 0.3, 2, 0.03, 0.03, 0.5, 0.05, 15, 0, 35, 0, 0.4, 10]],
  ['Kiwifruit', ['kiwi'], 61, [312, 34, 0.3, 17, 0.14, 0, 0.2, 4, 0.03, 0.03, 0.3, 0.06, 25, 0, 93, 0, 1.5, 40]],
  ['Almonds', ['almond', 'nuts', 'trail mix', 'cashew'], 579, [733, 269, 3.7, 270, 3.1, 0, 4, 0, 0.2, 1.1, 3.6, 0.14, 44, 0, 0, 0, 25.6, 0]],
  ['Peanut butter', ['peanut'], 588, [649, 43, 1.9, 168, 2.8, 0, 4, 0, 0.07, 0.1, 13, 0.44, 87, 0, 0, 0, 9, 0.3]],
  ['Pumpkin seeds', ['pepita', 'pumpkin seed', 'seeds', 'chia'], 559, [809, 46, 8.8, 592, 7.8, 0, 9.4, 1, 0.27, 0.15, 5, 0.14, 58, 0, 2, 0, 2.2, 7]],
  ['Dark chocolate', ['dark chocolate', 'cacao'], 600, [715, 73, 11.9, 228, 3.3, 0, 7, 2, 0.03, 0.08, 1.1, 0.04, 0, 0.3, 0, 0, 0.6, 7]],
  ['Whey protein', ['protein shake', 'whey', 'protein powder'], 400, [500, 450, 1.5, 150, 2, 0, 10, 0, 0.5, 1.0, 1, 0.3, 50, 1.5, 0, 0, 1, 0]],
  ['Liver', ['liver', 'pate'], 135, [313, 5, 6.5, 18, 4, 0, 39, 4968, 0.2, 2.8, 13, 1.0, 290, 59, 1, 1.2, 0.4, 3]],
];
const PROFILE_KEYS: MicroKey[] = ['potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'iodine', 'selenium', 'vitA', 'b1', 'b2', 'b3', 'b6', 'b9', 'b12', 'vitC', 'vitD', 'vitE', 'vitK'];

/** The profiles a food's name matches (longest words first, each part of the name used once). */
export function profilesFor(name: string): Prof[] {
  let rest = ` ${name.toLowerCase()} `;
  const words = PROFILES.flatMap((p) => p[1].map((w) => ({ w, p }))).sort((a, b) => b.w.length - a.w.length);
  const hit: Prof[] = [];
  for (const { w, p } of words) {
    if (!rest.includes(w)) continue;
    rest = rest.replace(w, ' ');
    if (!hit.includes(p)) hit.push(p);
  }
  return hit;
}

/** A log's micronutrients: what the label gave, else an estimate from what it is, scaled by its calories (split evenly
 *  across the things named). `est` says whether any of it is an estimate. */
export function microsOf(l: Pick<FoodLog, 'name' | 'nutrients'>): { n: Partial<Record<MicroKey, number>>; est: boolean; covered: boolean } {
  const labelled = KEYS.filter((k) => typeof l.nutrients[k] === 'number');
  const n: Partial<Record<MicroKey, number>> = {};
  for (const k of labelled) n[k] = l.nutrients[k]!;
  const ps = profilesFor(l.name);
  const kcal = l.nutrients.kcal ?? 0;
  let est = false;
  if (ps.length && kcal > 0) {
    for (const p of ps) {
      const share = kcal / ps.length / p[2]; // hundreds of grams of this part
      PROFILE_KEYS.forEach((k, i) => { if (!labelled.includes(k)) { n[k] = (n[k] ?? 0) + p[3][i] * share; est = true; } });
    }
  }
  return { n, est, covered: labelled.length >= 3 || ps.length > 0 };
}

export interface MicroRow { key: MicroKey; label: string; unit: 'mg' | 'µg'; kind: 'vitamin' | 'mineral'; amount: number; target: number; pct: number; upper?: number; over: boolean }
export interface MicroDay { rows: MicroRow[]; /** Share of the day's calories with label or estimated micronutrients. */ coverage: number; estimated: boolean; kcal: number }

/** Totals for a span against daily targets (`days` days: the average a day). */
export function microTotals(logs: FoodLog[], from: number, to: number, who: { sex?: 'm' | 'f'; age?: number } = {}, days = 1): MicroDay {
  const xs = logs.filter((l) => live(l) && Date.parse(l.at) >= from && Date.parse(l.at) < to);
  const sum: Partial<Record<MicroKey, number>> = {};
  let kcal = 0, covered = 0, estimated = false;
  for (const l of xs) {
    const m = microsOf(l);
    const k = l.nutrients.kcal ?? 0;
    kcal += k; if (m.covered) covered += k;
    if (m.est) estimated = true;
    for (const [key, v] of Object.entries(m.n)) sum[key as MicroKey] = (sum[key as MicroKey] ?? 0) + (v ?? 0);
  }
  const rows = MICROS.map((d) => {
    const amount = (sum[d.key] ?? 0) / days;
    const target = microTarget(d.key, who.sex, who.age);
    return { key: d.key, label: d.label, unit: d.unit, kind: d.kind, amount, target, pct: Math.round((amount / target) * 100), upper: d.upper, over: d.upper !== undefined && amount > d.upper };
  });
  return { rows, coverage: kcal > 0 ? covered / kcal : 0, estimated, kcal };
}

export interface MicroLow { key: MicroKey; label: string; pct: number; /** Your own foods richest in it (per serving), then typical ones. */ yours: string[]; foods: string[] }

/** The last 7 days (only days with food logged): which run under 70% of target, most short first, with foods for each. */
export function microWeek(logs: FoodLog[], now: number, who: { sex?: 'm' | 'f'; age?: number } = {}): { avg: MicroDay; lows: MicroLow[]; days: number } | null {
  const from = now - 7 * DAY;
  const dayKeys = new Set(logs.filter((l) => live(l) && Date.parse(l.at) >= from && Date.parse(l.at) < now).map((l) => l.at.slice(0, 10)));
  if (dayKeys.size < 2) return null;
  const avg = microTotals(logs, from, now, who, dayKeys.size);
  if (avg.coverage < 0.4) return { avg, lows: [], days: dayKeys.size };
  const recent = logs.filter((l) => live(l) && Date.parse(l.at) > now - 30 * DAY);
  const lows = avg.rows.filter((r) => r.pct < 70).sort((a, b) => a.pct - b.pct).slice(0, 4).map((r) => {
    // Your own: the foods logged in the last month with the most of it a serving.
    const byName = new Map<string, number>();
    for (const l of recent) { const v = microsOf(l).n[r.key] ?? 0; if (v > (byName.get(l.name) ?? 0)) byName.set(l.name, v); }
    const yours = [...byName].filter(([, v]) => v >= r.target * 0.15).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    // Typical: the richest per 100 Cal (so a big serving of a dense food doesn't win).
    const i = PROFILE_KEYS.indexOf(r.key);
    const foods = [...PROFILES].sort((a, b) => b[3][i] / b[2] - a[3][i] / a[2]).filter((p) => p[3][i] > 0).slice(0, 4).map((p) => p[0]);
    return { key: r.key, label: r.label, pct: r.pct, yours, foods };
  });
  return { avg, lows, days: dayKeys.size };
}

export const fmtMicro = (v: number, unit: string) => `${v >= 100 ? Math.round(v).toLocaleString('en-AU') : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`;
export type { Nutrients };
