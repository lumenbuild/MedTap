// Nutrition of a recipe estimated from its ingredient lines ("1½ cups basmati rice", "2 x 400g cans chickpeas,
// drained", "500g chicken thigh fillets, sliced", "Salt and pepper, to taste"): each line's amount in grams times
// the ingredient's typical nutrition, added up and shared by the serves. Lines it can't place, or that give no
// amount, are listed so you can see what isn't counted. Pure.
import type { Nutrients } from '../db/schema';
import { addNutrients, scaleNutrients } from './nutrition';
import { RECIPE_INGREDIENTS, ingredientById, type RecipeIngredient } from './recipeIngredients';

export interface EstimatedLine {
  line: string;
  /** What it was read as ("Chicken thigh"), and how much. */
  as?: string; grams?: number; nutrients?: Nutrients;
  /** Why it isn't counted. */
  skip?: 'unknown' | 'no-amount' | 'minor';
}

export interface RecipeEstimate {
  lines: EstimatedLine[];
  total: Nutrients; perServe: Nutrients; serves: number;
  /** Lines counted, of the lines that matter (minor ones and headings left out). */
  counted: number; of: number;
}

const FRACTIONS: Record<string, string> = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8', '⅕': ' 1/5', '⅙': ' 1/6' };
const NUM = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?`;
const UNIT = String.raw`kg|kilograms?|g|grams?|gm|gms|mg|ml|mls|millilitres?|milliliters?|l|litres?|liters?|cups?|c|tbsps?|tablespoons?|tbs|tbl|tbsp\.|tsps?|teaspoons?|tsp\.|oz|ounces?|lbs?|pounds?|cans?|tins?|jars?|cloves?|slices?|rashers?|pinch(?:es)?|handfuls?|bunch(?:es)?|sachets?|packets?|pkts?|pk|packs?|sheets?|fillets?|stalks?|sticks?|heads?|scoops?|pieces?|pcs|cm|knobs?|sprigs?|leaves|dash(?:es)?|splash(?:es)?|drizzle|cobs?|ears?|bags?|punnets?|bottles?|cartons?|tubs?|blocks?|wedges?|strips?|thighs?|breasts?`;

const num = (s: string): number => s.trim().split(/\s+/).reduce((a, p) => { const [n, d] = p.split('/'); return a + (d ? Number(n) / Number(d) : Number(n)); }, 0);

function clean(line: string): string {
  let s = line;
  for (const [k, v] of Object.entries(FRACTIONS)) s = s.split(k).join(v);
  return s.replace(/(\d)\s*-\s*(\d)/g, '$1-$2').replace(/\s+/g, ' ').trim();
}

/** Grams in one of a mass unit, or undefined. */
function massG(u?: string): number | undefined {
  const k = (u ?? '').toLowerCase();
  if (/^(kg|kilograms?)$/.test(k)) return 1000;
  if (/^(g|grams?|gm|gms)$/.test(k)) return 1;
  if (k === 'mg') return 0.001;
  if (/^(oz|ounces?)$/.test(k)) return 28.35;
  if (/^(lbs?|pounds?)$/.test(k)) return 453.6;
  return undefined;
}
function volumeMl(u: string, tbspMl: number): number | undefined {
  const k = u.toLowerCase().replace(/\.$/, '');
  if (/^(ml|mls|millilitres?|milliliters?)$/.test(k)) return 1;
  if (/^(l|litres?|liters?)$/.test(k)) return 1000;
  if (/^(cups?|c)$/.test(k)) return 250;
  if (/^(tbsps?|tablespoons?|tbs|tbl)$/.test(k)) return tbspMl;
  if (/^(tsps?|teaspoons?)$/.test(k)) return 5;
  if (/^(dash(es)?|splash(es)?|drizzle)$/.test(k)) return 5;
  return undefined;
}

/** The ingredient a line names: the longest matching word wins ("sweet potato" over "potato", "coconut milk" over "milk"). */
export function matchIngredient(text: string): RecipeIngredient | undefined {
  const t = ` ${text.toLowerCase().replace(/yogurt/g, 'yoghurt').replace(/\bchili\b/g, 'chilli').replace(/[^a-z0-9&%'\- ]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { ing: RecipeIngredient; len: number } | undefined;
  for (const ing of RECIPE_INGREDIENTS) {
    for (const w of ing.words) {
      if (w.length <= (best?.len ?? 0)) continue;
      const re = new RegExp(`[ \\-]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?[ \\-]`);
      if (re.test(t)) best = { ing, len: w.length };
    }
  }
  return best?.ing;
}

const isHeading = (s: string) => /:$/.test(s.trim()) || /^(for the|to serve|to garnish|sauce|marinade|dressing|topping|filling|base|garnish|optional|ingredients|method)\b[^,\d]*$/i.test(s.trim()) && !/\d/.test(s);

/** One ingredient line read as grams of something. */
export function readLine(raw: string, tbspMl = 20): EstimatedLine {
  const line = raw.replace(/^[\s•·\-–*▢□☐◻]+/, '').trim();
  if (!line || isHeading(line)) return { line, skip: 'minor' };
  let s = clean(line).toLowerCase();
  // "2 x 400g cans", "2 × 400 g tins"
  let mult = 1;
  const times = s.match(new RegExp(`^(${NUM})\\s*[x×]\\s*`));
  if (times) { mult = num(times[1]); s = s.slice(times[0].length); }
  const q = s.match(new RegExp(`^(?:about |approx\\.? |around )?(${NUM})(?:-(${NUM}))?\\s*(?:(${UNIT})\\b\\.?)?\\s*`, 'i'));
  let qty: number | undefined, unit: string | undefined, rest = s;
  if (q) {
    qty = q[2] ? (num(q[1]) + num(q[2])) / 2 : num(q[1]);
    unit = q[3]?.toLowerCase();
    rest = s.slice(q[0].length);
    // "1 large can", "2 medium onions", "1 small bunch": the unit may follow a size.
    const sized = rest.match(new RegExp(`^(large|big|medium|small|heaped|level|rounded|generous|good|small-medium)\\s+(?:(${UNIT})\\b\\.?\\s*)?`, 'i'));
    if (sized) { rest = rest.slice(sized[0].length); if (!unit && sized[2]) unit = sized[2].toLowerCase(); if (!massG(unit)) qty *= /large|big|heaped|generous|good/.test(sized[1]) ? 1.3 : /small/.test(sized[1]) ? 0.7 : 1; }
    // "1 can (400g) …", "400g can …": a weight in brackets or right after.
    if (!massG(unit)) {
      const w = rest.match(/\(?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b\s*\)?/i);
      const each = unit ? /^(cans?|tins?|jars?|sachets?|packets?|pkts?|pk|packs?|bags?|punnets?|bottles?|cartons?|tubs?|blocks?)$/.test(unit) || /\beach\b/.test(rest) : /\beach\b/.test(rest);
      if (w && (unit || /\(/.test(w[0]))) {
        const wg = Number(w[1]) * (/kg|^l$/i.test(w[2]) ? 1000 : 1);
        qty = each ? qty * wg : wg;
        unit = 'g';
        rest = rest.replace(w[0], ' ');
      }
    }
  }
  const named = rest.replace(/\([^)]*\)/g, ' ').split(',')[0];
  let ing = matchIngredient(named) ?? matchIngredient(rest);
  if (!ing) return { line, skip: 'unknown' };
  if (ing.cooked && /\bcooked\b|\bleftover\b|\bsteamed\b/.test(rest)) ing = ingredientById(ing.cooked) ?? ing;
  const as = ing.id[0].toUpperCase() + ing.id.slice(1);
  const minorNoAmount = (): EstimatedLine => ({ line, as, skip: ing!.minor ? 'minor' : 'no-amount' });
  if (/\bspray\b/.test(rest) && ing.per100.fat === 100) return { line, as, grams: 1, nutrients: scaleNutrients(ing.per100, 0.01) };
  if (qty === undefined || !(qty > 0)) return minorNoAmount();
  let grams: number | undefined;
  // A can's weight ("400g can chickpeas, drained") includes its liquid.
  const drained = ing.drain && /\b(cans?|tins?)\b/.test(rest) ? ing.drain : undefined;
  if (unit) {
    const vol = volumeMl(unit, tbspMl);
    const m = massG(unit);
    if (m) grams = qty * m * (drained ?? 1);
    else if (vol) grams = qty * vol * ((ing.cup ?? 250) / 250);
    else if (/^(cans?|tins?|jars?|sachets?|packets?|pkts?|pk|packs?|bags?|bottles?|cartons?|tubs?|punnets?)$/.test(unit)) grams = ing.can ? qty * ing.can * (ing.drain ?? 1) : ing.each ? qty * ing.each : undefined;
    else if (/^bunch/.test(unit)) grams = qty * (ing.bunch ?? 30);
    else if (/^handful/.test(unit)) grams = qty * 30;
    else if (/^pinch/.test(unit)) grams = qty * 0.5;
    else if (unit === 'cm' || /^knob/.test(unit)) grams = qty * 5;
    else if (/^(sprigs?|leaves)$/.test(unit)) grams = qty * 1;
    else grams = ing.each ? qty * ing.each : undefined; // cloves, slices, rashers, fillets, sheets, scoops, pieces…
  } else grams = ing.each ? qty * ing.each : ing.can ? qty * ing.can * (ing.drain ?? 1) : undefined;
  if (grams === undefined) return minorNoAmount();
  grams = Math.round(grams * mult * 10) / 10;
  return { line, as, grams, nutrients: scaleNutrients(ing.per100, grams / 100) };
}

/** Pull ingredient lines out of free text (pasted, typed or read from a screenshot). */
export function ingredientLines(text: string): string[] {
  return text.split(/\r?\n|;/).map((l) => l.replace(/^[\s•·\-–*▢□☐◻]+/, '').trim()).filter((l) => l.length > 1 && /[a-z]/i.test(l));
}

/** Does this text read like an ingredient list (several lines starting with an amount)? */
export function looksLikeIngredients(text: string): boolean {
  const ls = ingredientLines(text);
  return ls.filter((l) => new RegExp(`^(${NUM}|[½¼¾⅓⅔])`).test(clean(l))).length >= 3;
}

export function estimateRecipe(lines: string[], serves: number, opts: { tbspMl?: number; leaveOut?: Set<number> } = {}): RecipeEstimate {
  const read = lines.map((l) => readLine(l, opts.tbspMl ?? 20));
  const used = read.filter((r, i) => r.nutrients && !opts.leaveOut?.has(i));
  const total = addNutrients(...used.map((r) => r.nutrients!));
  const s = Math.max(1, Math.round(serves) || 1);
  const matters = read.filter((r) => r.skip !== 'minor' && !(r.nutrients && (r.nutrients.kcal ?? 0) < 5 && !r.grams));
  return {
    lines: read, total, serves: s,
    perServe: roundAll(scaleNutrients(total, 1 / s)),
    counted: matters.filter((r) => r.nutrients).length, of: matters.length,
  };
}

function roundAll(n: Nutrients): Nutrients {
  const out: Nutrients = {};
  for (const [k, v] of Object.entries(n)) if (typeof v === 'number') (out as Record<string, number>)[k] = k === 'kcal' || k === 'sodium' ? Math.round(v) : Math.round(v * 10) / 10;
  return out;
}

/** Tablespoon size for a recipe's site: 20 mL in Australia, 15 mL elsewhere. */
export const tbspFor = (url?: string): number => { try { return !url || new URL(url).hostname.endsWith('.au') ? 20 : 15; } catch { return 20; } };
