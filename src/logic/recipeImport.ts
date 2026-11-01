// A recipe from a web page (Woolworths, Coles, taste.com.au, RecipeTin Eats, BBC Good Food…): its name, serves,
// ingredients and nutrition per serve. Most recipe sites embed a schema.org Recipe (JSON-LD); failing that, a
// nutrition table in the page's text, or nutrition in the page's embedded app data. Pure.
import type { Nutrients } from '../db/schema';
import { parsePanel } from './nutrition';

export interface ImportedRecipe { name: string; serves?: number; ingredients: string[]; perServe?: Nutrients; from: 'recipe-data' | 'page-text' | 'app-data' | 'none' }

/** The first web address in shared text ("Check out this recipe https://…"). */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0].replace(/[).,;]+$/, '') : null;
}

/** One form of a recipe's address, so the same recipe shared twice is recognised ("www.", tracking and the
 *  page anchor dropped). */
export function normUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|cid|ref|share|s$|igshid|mc_)/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, '');
    return `${host}${u.pathname.replace(/\/(amp\/?)?$/, '').replace(/\/+$/, '')}${u.search}`;
  } catch { return url.trim(); }
}

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

/** "450 kcal", "1880 kJ", "450 calories" → kcal. */
function energy(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return typeof v === 'string' && /kj|kilojoule/i.test(v) ? Math.round(n / 4.184) : Math.round(n);
}
/** "30 g", "800 mg", "0.8 g" (sodium) → the unit wanted. */
function grams(v: unknown): number | undefined { const n = num(v); if (n === undefined) return undefined; return typeof v === 'string' && /\bmg\b/i.test(v) ? n / 1000 : n; }
function mg(v: unknown): number | undefined { const n = num(v); if (n === undefined) return undefined; return typeof v === 'string' && /\bmg\b/i.test(v) ? n : typeof v === 'string' && /\bg\b/i.test(v) ? n * 1000 : n; }

const strip = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim() : '');

function yieldOf(y: unknown): number | undefined {
  const xs = Array.isArray(y) ? y : [y];
  for (const x of xs) { const n = num(x); if (n && n > 0 && n < 50) return Math.round(n); }
  return undefined;
}

function nutritionOf(n: Record<string, unknown> | undefined): Nutrients | undefined {
  if (!n || typeof n !== 'object') return undefined;
  const out: Nutrients = {};
  const set = (k: keyof Nutrients, v: number | undefined) => { if (v !== undefined && v >= 0) (out as Record<string, number>)[k] = Math.round(v * 10) / 10; };
  set('kcal', energy(n.calories ?? n.energy));
  set('protein', grams(n.proteinContent));
  set('fat', grams(n.fatContent));
  set('satFat', grams(n.saturatedFatContent));
  set('carbs', grams(n.carbohydrateContent));
  set('sugars', grams(n.sugarContent));
  set('fibre', grams(n.fiberContent));
  set('sodium', mg(n.sodiumContent));
  return out.kcal !== undefined || out.protein !== undefined ? out : undefined;
}

/** Every JSON object in the page's JSON-LD blocks, flattened (arrays and @graph). */
function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') { out.push(x as Record<string, unknown>); const g = (x as Record<string, unknown>)['@graph']; if (g) walk(g); }
  };
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim())); } catch { /* a broken block: skip */ } }
  return out;
}

const isRecipe = (o: Record<string, unknown>) => { const t = o['@type']; return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe')); };

/** Nutrition somewhere in the page's embedded app data (a site that builds the page in the browser). */
function appData(html: string): { name?: string; serves?: number; perServe?: Nutrients } | undefined {
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let found: { name?: string; serves?: number; perServe?: Nutrients } | undefined;
  const walk = (x: unknown, depth: number) => {
    if (found || depth > 12 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((y) => walk(y, depth + 1)); return; }
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).map((k) => k.toLowerCase());
    // A nutrition object: energy (or calories) and protein side by side.
    if (keys.some((k) => /^(energy|calories|kcal|kj)/.test(k)) && keys.some((k) => k.startsWith('protein'))) {
      const get = (re: RegExp) => { const k = Object.keys(o).find((x) => re.test(x.toLowerCase())); return k ? o[k] : undefined; };
      const e = get(/^(energy|calories|kcal|kj)/);
      const kj = Object.keys(o).some((k) => /kj/.test(k.toLowerCase())) || (typeof e === 'string' && /kj/i.test(e));
      const kcal = num(e);
      found = { perServe: { kcal: kcal !== undefined ? Math.round(kj ? kcal / 4.184 : kcal) : undefined, protein: num(get(/^protein/)), fat: num(get(/^(fat|totalfat)/)), carbs: num(get(/^carb/)), fibre: num(get(/^fib/)), sodium: num(get(/^sodium/)) } };
      return;
    }
    Object.values(o).forEach((y) => walk(y, depth + 1));
  };
  while ((m = re.exec(html)) && !found) { try { walk(JSON.parse(m[1]), 0); } catch { /* skip */ } }
  return found;
}

/** Text of every element with this itemprop (or its content attribute). */
function microdata(html: string, prop: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<([a-z0-9]+)[^>]*itemprop=["']${prop}["'][^>]*?(?:content=["']([^"']*)["'][^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { const t = strip(m[2] ?? m[3]); if (t) out.push(t); }
  return out;
}

export function parseRecipePage(html: string): ImportedRecipe {
  const r = jsonLd(html).find(isRecipe);
  const title = strip(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title>([^<]+)/i)?.[1] ?? '');
  const name = strip(r?.name) || title.replace(/\s*[|–-]\s*[^|–-]+$/, '') || 'Recipe';
  const serves = r ? yieldOf(r.recipeYield) : yieldOf(microdata(html, 'recipeYield')[0]);
  const ldIngredients = Array.isArray(r?.recipeIngredient) ? (r!.recipeIngredient as unknown[]).map(strip).filter(Boolean) : [];
  // Older sites mark recipes up in the page itself (microdata) rather than JSON-LD.
  const ingredients = ldIngredients.length ? ldIngredients : microdata(html, 'recipeIngredient').concat(microdata(html, 'ingredients'));
  const fromLd = nutritionOf(r?.nutrition as Record<string, unknown> | undefined);
  if (fromLd) return { name, serves, ingredients, perServe: fromLd, from: 'recipe-data' };
  // A nutrition table in the page's text ("Nutrition per serve: Energy 1850 kJ, Protein 38 g…").
  const text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const at = text.search(/nutrition|per serve|per serving/i);
  if (at >= 0) {
    const p = parsePanel(text.slice(at, at + 1500).replace(/(\d)\s*(kj|kcal|cal|mg|g)\b/gi, '$1$2\n').replace(/\b(energy|calories)\b/gi, '\n$1'));
    const per = Object.keys(p.perServing).length ? p.perServing : undefined;
    if (per && (per.kcal !== undefined || per.protein !== undefined)) return { name, serves: serves ?? yieldOf(text.match(/serves\s*(\d+)/i)?.[1]), ingredients, perServe: per, from: 'page-text' };
  }
  const app = appData(html);
  if (app?.perServe && (app.perServe.kcal !== undefined || app.perServe.protein !== undefined)) return { name, serves, ingredients, perServe: app.perServe, from: 'app-data' };
  return { name, serves: serves ?? yieldOf(text.match(/serves\s*(\d+)/i)?.[1]), ingredients, from: 'none' };
}
