// Food: the nutrients the app knows (macros and micros), reading them from Open Food Facts (a barcode lookup) or from
// the text of a nutrition panel (a photo read on the phone), hand-portion estimates for meals you make, and adding
// it all up. Pure.
import type { FoodLog, Nutrients, Portions } from '../db/schema';

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'µg';
export interface NutrientDef {
  key: string; label: string; unit: NutrientUnit; group: 'macro' | 'micro';
  /** Open Food Facts nutriment name. */
  off: string;
  /** How it's written on a nutrition panel (a line starting with this, roughly). */
  panel: RegExp;
}

const n = (key: string, label: string, unit: NutrientUnit, group: 'macro' | 'micro', off: string, panel: RegExp): NutrientDef => ({ key, label, unit, group, off, panel });

/** In the order a panel lists them. Energy is stored in kcal (shown as Cal or kJ). */
export const NUTRIENTS: NutrientDef[] = [
  n('kcal', 'Energy', 'kcal', 'macro', 'energy-kcal', /^(energy|calories)\b/),
  n('protein', 'Protein', 'g', 'macro', 'proteins', /^protein/),
  n('fat', 'Fat', 'g', 'macro', 'fat', /^(total\s+)?fat\b(?!.*(saturated|trans|mono|poly))/),
  n('satFat', 'Saturated fat', 'g', 'macro', 'saturated-fat', /saturated/),
  n('transFat', 'Trans fat', 'g', 'macro', 'trans-fat', /^[-–\s]*trans/),
  n('carbs', 'Carbohydrate', 'g', 'macro', 'carbohydrates', /^(total\s+)?carbohydrate/),
  n('sugars', 'Sugars', 'g', 'macro', 'sugars', /^[-–\s]*(total\s+)?sugars?\b(?!.*added)/),
  n('polyols', 'Sugar alcohols', 'g', 'macro', 'polyols', /polyols|sugar alcohol/),
  n('fibre', 'Fibre', 'g', 'macro', 'fiber', /(dietary\s+)?fib(re|er)/),
  n('sodium', 'Sodium', 'mg', 'macro', 'sodium', /^sodium/),
  n('caffeine', 'Caffeine', 'mg', 'micro', 'caffeine', /caffeine/),
  n('taurine', 'Taurine', 'mg', 'micro', 'taurine', /taurine/),
  n('cholesterol', 'Cholesterol', 'mg', 'micro', 'cholesterol', /cholesterol/),
  n('potassium', 'Potassium', 'mg', 'micro', 'potassium', /potassium/),
  n('calcium', 'Calcium', 'mg', 'micro', 'calcium', /calcium/),
  n('iron', 'Iron', 'mg', 'micro', 'iron', /^iron/),
  n('magnesium', 'Magnesium', 'mg', 'micro', 'magnesium', /magnesium/),
  n('zinc', 'Zinc', 'mg', 'micro', 'zinc', /^zinc/),
  n('phosphorus', 'Phosphorus', 'mg', 'micro', 'phosphorus', /phosphorus/),
  n('iodine', 'Iodine', 'µg', 'micro', 'iodine', /iodine/),
  n('selenium', 'Selenium', 'µg', 'micro', 'selenium', /selenium/),
  n('vitA', 'Vitamin A', 'µg', 'micro', 'vitamin-a', /vitamin\s*a\b/),
  n('b1', 'Thiamin (B1)', 'mg', 'micro', 'vitamin-b1', /thiamin|vitamin\s*b1\b/),
  n('b2', 'Riboflavin (B2)', 'mg', 'micro', 'vitamin-b2', /riboflavin|vitamin\s*b2\b/),
  n('b3', 'Niacin (B3)', 'mg', 'micro', 'vitamin-pp', /niacin|vitamin\s*b3\b/),
  n('b5', 'Pantothenic acid (B5)', 'mg', 'micro', 'pantothenic-acid', /pantothen|vitamin\s*b5\b/),
  n('b6', 'Vitamin B6', 'mg', 'micro', 'vitamin-b6', /pyridoxine|vitamin\s*b6\b/),
  n('b7', 'Biotin (B7)', 'µg', 'micro', 'biotin', /biotin|vitamin\s*b7\b/),
  n('b9', 'Folate (B9)', 'µg', 'micro', 'vitamin-b9', /folate|folic|vitamin\s*b9\b/),
  n('b12', 'Vitamin B12', 'µg', 'micro', 'vitamin-b12', /cobalamin|vitamin\s*b12\b/),
  n('vitC', 'Vitamin C', 'mg', 'micro', 'vitamin-c', /vitamin\s*c\b|ascorbic/),
  n('vitD', 'Vitamin D', 'µg', 'micro', 'vitamin-d', /vitamin\s*d\d?\b/),
  n('vitE', 'Vitamin E', 'mg', 'micro', 'vitamin-e', /vitamin\s*e\b/),
  n('vitK', 'Vitamin K', 'µg', 'micro', 'vitamin-k', /vitamin\s*k\d?\b/),
];
export const NUTRIENT = Object.fromEntries(NUTRIENTS.map((x) => [x.key, x])) as Record<string, NutrientDef>;
export const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const;

const KJ_PER_KCAL = 4.184;
const FROM_G: Record<NutrientUnit, number> = { kcal: 1, g: 1, mg: 1000, 'µg': 1_000_000 };
/** A sensible number of decimals for a nutrient amount. */
export function roundNutrient(v: number, unit: NutrientUnit): number {
  const dp = unit === 'kcal' ? 0 : v >= 100 ? 0 : v >= 10 ? (unit === 'g' ? 1 : 0) : v >= 1 ? 1 : 2;
  return Math.round(v * 10 ** dp) / 10 ** dp;
}

export function scaleNutrients(x: Nutrients, f: number): Nutrients {
  const out: Nutrients = {};
  for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = roundNutrient(v * f, NUTRIENT[k]?.unit ?? 'g');
  return out;
}

export function addNutrients(...xs: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const x of xs) for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
  for (const k of Object.keys(out)) out[k] = roundNutrient(out[k]!, NUTRIENT[k]?.unit ?? 'g');
  return out;
}

/** Everything logged in a span (live entries). */
export function totalsFor(logs: FoodLog[], from: number, to: number): Nutrients {
  return addNutrients(...logs.filter((l) => !l.deletedAt && Date.parse(l.at) >= from && Date.parse(l.at) < to).map((l) => l.nutrients));
}

export type EnergyUnit = 'kcal' | 'kJ';
/** "203 Cal" or "850 kJ". */
export const fmtEnergy = (kcal: number | undefined, unit: EnergyUnit) =>
  kcal === undefined ? '–' : unit === 'kJ' ? `${Math.round(kcal * KJ_PER_KCAL).toLocaleString('en-AU')} kJ` : `${Math.round(kcal).toLocaleString('en-AU')} Cal`;
/** "12 g", "160 mg", "2.4 µg" (energy as Cal or kJ). */
export function fmtNutrient(key: string, v: number | undefined, energy: EnergyUnit = 'kcal'): string {
  if (key === 'kcal') return fmtEnergy(v, energy);
  const d = NUTRIENT[key];
  return v === undefined ? '–' : `${roundNutrient(v, d?.unit ?? 'g').toLocaleString('en-AU')} ${d?.unit ?? 'g'}`;
}

// ── Open Food Facts ────────────────────────────────────────────────────────────────────────────────

export interface OffProduct {
  product_name?: string; product_name_en?: string; generic_name?: string; brands?: string;
  serving_size?: string; serving_quantity?: number | string; serving_quantity_unit?: string; quantity?: string;
  nutriments?: Record<string, number | string | undefined>;
}

export interface ProductData {
  name: string; brand?: string;
  /** Per serving (or per 100 g/mL when there's no serving size, with `serving` saying so). */
  nutrients: Nutrients; per100?: Nutrients;
  serving: string; servingQty?: number; servingUnit?: 'g' | 'mL';
  /** How many nutrients there were: few means the record is thin and a label photo will do better. */
  found: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

function offNutrients(nm: Record<string, unknown>, suffix: '_serving' | '_100g'): Nutrients {
  const out: Nutrients = {};
  for (const d of NUTRIENTS) {
    if (d.key === 'kcal') {
      const kcal = num(nm[`energy-kcal${suffix}`]) ?? (num(nm[`energy-kj${suffix}`]) ?? num(nm[`energy${suffix}`]));
      const viaKj = num(nm[`energy-kcal${suffix}`]) === undefined;
      if (kcal !== undefined) out.kcal = roundNutrient(viaKj ? kcal / KJ_PER_KCAL : kcal, 'kcal');
      continue;
    }
    const g = num(nm[`${d.off}${suffix}`]) ?? (d.key === 'sodium' && num(nm[`salt${suffix}`]) !== undefined ? num(nm[`salt${suffix}`])! / 2.5 : undefined);
    if (g !== undefined) out[d.key] = roundNutrient(g * FROM_G[d.unit], d.unit);
  }
  return out;
}

/** A product from Open Food Facts, per serving when it has one (otherwise per 100 g or mL). */
export function fromOpenFoodFacts(p: OffProduct): ProductData {
  const nm = (p.nutriments ?? {}) as Record<string, unknown>;
  const per100 = offNutrients(nm, '_100g');
  const perServing = offNutrients(nm, '_serving');
  const qty = num(p.serving_quantity);
  const liquid = /ml|l\b/i.test(`${p.serving_quantity_unit ?? ''} ${p.serving_size ?? ''} ${p.quantity ?? ''}`);
  const unit = liquid ? 'mL' as const : 'g' as const;
  const name = (p.product_name || p.product_name_en || p.generic_name || '').trim() || 'Unnamed product';
  const brand = p.brands?.split(',')[0]?.trim() || undefined;
  if (Object.keys(perServing).length || (qty && Object.keys(per100).length)) {
    const nutrients = Object.keys(perServing).length >= Object.keys(per100).length ? perServing : scaleNutrients(per100, qty! / 100);
    return { name, brand, nutrients, per100: Object.keys(per100).length ? per100 : undefined, serving: p.serving_size?.trim() || `${qty} ${unit}`, servingQty: qty, servingUnit: unit, found: Object.keys(nutrients).length };
  }
  return { name, brand, nutrients: per100, per100, serving: `100 ${unit}`, servingQty: 100, servingUnit: unit, found: Object.keys(per100).length };
}

// ── Nutrition panels (text from a photo) ──────────────────────────────────────────────────────────────

export interface PanelData {
  /** Per serving and per 100 g/mL, as the panel lists them. */
  perServing: Nutrients; per100: Nutrients;
  servingQty?: number; servingUnit?: 'g' | 'mL';
}

const UNIT_TO: Record<string, number> = { g: 1, mg: 0.001, 'µg': 1e-6, ug: 1e-6, mcg: 1e-6 };
type Tok = { v: number; u?: string; raw: string };

function tokens(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(<\s*)?(\d+(?:[.,]\d+)?)\s*(kj|kcal|cal|mg|µg|ug|mcg|g)?(?!\s*%)\b/gi;
  for (const m of line.matchAll(re)) {
    // Skip a percentage of a daily value straight after the number.
    const after = line.slice((m.index ?? 0) + m[0].length).trimStart();
    if (after.startsWith('%')) continue;
    out.push({ v: m[1] ? 0 : Number(m[2].replace(',', '.')), u: m[3]?.toLowerCase(), raw: m[2] });
  }
  // OCR often reads a "g" straight after a number as a 9 ("0.6g" → "0.69"): when the line's other amounts are in
  // grams with one fewer decimal, take the 9 as the g.
  const dec = (r: string) => (r.split(/[.,]/)[1] ?? '').length;
  const gs = out.filter((t) => t.u === 'g').map((t) => dec(t.raw));
  if (gs.length) {
    for (const t of out) {
      if (!t.u && /9$/.test(t.raw) && dec(t.raw) === gs[0] + 1) { t.raw = t.raw.slice(0, -1); t.v = Number(t.raw.replace(',', '.')); t.u = 'g'; }
    }
  }
  return out;
}

/** Common OCR slips on panels: "kJ" read as "k]", "k)", "kl". */
const tidy = (line: string) => line.replace(/(\d)\s*k[\])|lIij1](?![a-z])/g, '$1kJ');

/** Read a nutrition information panel (Australian and New Zealand, US or EU style) from OCR text. Lines it can't
 *  read are left out, for the person to check and fill in. */
export function parsePanel(text: string): PanelData {
  const lines = text.split(/\r?\n/).map((l) => tidy(l.replace(/[|]/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const head = lines.find((l) => /per\s*(serv|100)/i.test(l)) ?? '';
  const iServ = head.search(/per\s*serv/i), i100 = head.search(/per\s*100/i);
  // Which column comes first. Panels that only list per 100 g count as per 100.
  const firstIs100 = i100 >= 0 && (iServ < 0 || i100 < iServ);
  const perServing: Nutrients = {}, per100: Nutrients = {};
  const put = (key: string, vals: number[]) => {
    if (!vals.length) return;
    const [a, b] = vals;
    if (firstIs100) { per100[key] ??= a; if (b !== undefined && iServ >= 0) perServing[key] ??= b; } else { perServing[key] ??= a; if (b !== undefined) per100[key] ??= b; }
  };
  let servingQty: number | undefined, servingUnit: 'g' | 'mL' | undefined;
  for (const raw of lines) {
    const l = raw.toLowerCase().replace(/^[-–•*]\s*/, '');
    const sv = /serving size.*?(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(raw);
    if (sv) { servingQty = Number(sv[1].replace(',', '.')); servingUnit = sv[2].toLowerCase() === 'g' ? 'g' : 'mL'; continue; }
    if (/servings? per|per serv|per 100|average quantity|nutrition (information|facts)|daily value/.test(l) && !/^(energy|calories)/.test(l)) continue;
    if (/added sugars?/.test(l)) continue;
    const def = NUTRIENTS.find((d) => d.panel.test(l));
    if (!def) continue;
    // Names with digits ("Vitamin B12", "(B3)", "D3") aren't amounts.
    const toks = tokens(raw.replace(/\b(vitamin\s*)?[bdk]\s?\d{1,2}\b(?!\s*(mg|µg|ug|mcg|g)\b)/gi, ' '));
    if (def.key === 'kcal') {
      const kj = toks.filter((t) => t.u === 'kj').map((t) => t.v / KJ_PER_KCAL);
      const cal = toks.filter((t) => t.u === 'cal' || t.u === 'kcal').map((t) => t.v);
      const bare = toks.filter((t) => !t.u).map((t) => t.v);
      put('kcal', (cal.length && cal.length >= kj.length ? cal : kj.length ? kj : bare).map((v) => roundNutrient(v, 'kcal')));
      continue;
    }
    const vals = toks.map((t) => roundNutrient(t.u && UNIT_TO[t.u] !== undefined ? t.v * UNIT_TO[t.u] * FROM_G[def.unit] : t.v, def.unit));
    put(def.key, vals);
  }
  return { perServing, per100, servingQty, servingUnit };
}

// ── Hand portions (meals you make, without weighing) ─────────────────────────────────────────────────

/** Rough averages for one portion of each, for an everyday mixed meal. Estimates, not measurements. */
export const PORTIONS: { key: keyof Portions; label: string; hint: string; per: Nutrients }[] = [
  { key: 'palm', label: 'Palm of protein', hint: 'Meat, fish, eggs, tofu, Greek yoghurt', per: { kcal: 130, protein: 22, fat: 4, carbs: 2 } },
  { key: 'cupped', label: 'Cupped hand of carbs', hint: 'Rice, pasta, potato, bread, oats, fruit', per: { kcal: 110, carbs: 22, protein: 3, fat: 1, fibre: 2 } },
  { key: 'fist', label: 'Fist of veg', hint: 'Salad, greens, most vegetables', per: { kcal: 30, carbs: 5, protein: 2, fibre: 2 } },
  { key: 'thumb', label: 'Thumb of fats', hint: 'Oil, butter, cheese, nuts, creamy sauce', per: { kcal: 75, fat: 8 } },
];

export const noPortions = (): Portions => ({ palm: 0, cupped: 0, fist: 0, thumb: 0 });

export function portionNutrients(p: Portions): Nutrients {
  return addNutrients(...PORTIONS.map((x) => scaleNutrients(x.per, p[x.key] || 0)));
}

/** Sizes for a meal you make (it's never quite the same twice). */
export const MEAL_SIZES = [{ f: 0.75, label: 'Smaller' }, { f: 1, label: 'Usual' }, { f: 1.25, label: 'Bigger' }, { f: 1.5, label: 'Much bigger' }];

/** "2 palms, 1 cupped hand, 2 fists" */
export function fmtPortions(p: Portions): string {
  const w = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : '');
  return [w(p.palm, 'palm', 'palms'), w(p.cupped, 'cupped hand', 'cupped hands'), w(p.fist, 'fist', 'fists'), w(p.thumb, 'thumb', 'thumbs')].filter(Boolean).join(', ') || 'Nothing yet';
}
