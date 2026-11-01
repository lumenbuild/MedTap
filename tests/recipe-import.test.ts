import { describe, it, expect } from 'vitest';
import { extractUrl, parseRecipePage } from '../src/logic/recipeImport';
import { chipCounts } from '../src/logic/stats';
import type { CheckIn } from '../src/db/schema';

const ld = (o: unknown) => `<html><head><title>One Pan Mexican Chicken | Woolworths</title><script type="application/ld+json">${JSON.stringify(o)}</script></head><body></body></html>`;

describe('recipe links', () => {
  it('finds the link in shared text', () => {
    expect(extractUrl('Check out this recipe! https://www.woolworths.com.au/shop/recipes/one-pan-mexican-chicken.')).toBe('https://www.woolworths.com.au/shop/recipes/one-pan-mexican-chicken');
    expect(extractUrl('(https://www.taste.com.au/recipes/x)')).toBe('https://www.taste.com.au/recipes/x');
    expect(extractUrl('no link here')).toBeNull();
  });

  it('reads a schema.org recipe: kJ to Cal, sodium in g to mg, serves', () => {
    const r = parseRecipePage(ld({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'One Pan Mexican Chicken', recipeYield: '4 serves',
      recipeIngredient: ['500g chicken thigh', '1 &amp; a half cups rice'],
      nutrition: { calories: '2092 kJ', proteinContent: '42g', fatContent: '18 g', saturatedFatContent: '5g', carbohydrateContent: '55g', sugarContent: '6g', fiberContent: '7 g', sodiumContent: '0.9 g' } }));
    expect(r.from).toBe('recipe-data');
    expect(r.name).toBe('One Pan Mexican Chicken');
    expect(r.serves).toBe(4);
    expect(r.ingredients).toEqual(['500g chicken thigh', '1 & a half cups rice']);
    expect(r.perServe).toMatchObject({ kcal: 500, protein: 42, fat: 18, satFat: 5, carbs: 55, sugars: 6, fibre: 7, sodium: 900 });
  });

  it('finds a recipe inside an @graph, with calories and sodium in mg', () => {
    const r = parseRecipePage(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: 'Beef stir-fry', recipeYield: ['6', '6 serves'], nutrition: { calories: '450 calories', proteinContent: '35 g', sodiumContent: '780 mg' } }] }));
    expect(r.from).toBe('recipe-data');
    expect(r.serves).toBe(6);
    expect(r.perServe).toMatchObject({ kcal: 450, protein: 35, sodium: 780 });
  });

  it('falls back to a nutrition table in the page text', () => {
    const html = '<html><head><title>Chicken soup - Site</title></head><body><h1>Chicken soup</h1><p>Serves 4</p><table><tr><th>Nutrition per serve</th></tr><tr><td>Energy</td><td>1600 kJ</td></tr><tr><td>Protein</td><td>30 g</td></tr><tr><td>Fat</td><td>12 g</td></tr><tr><td>Carbohydrate</td><td>40 g</td></tr></table></body></html>';
    const r = parseRecipePage(html);
    expect(r.from).toBe('page-text');
    expect(r.name).toBe('Chicken soup');
    expect(r.serves).toBe(4);
    expect(r.perServe?.protein).toBe(30);
    expect(r.perServe?.kcal).toBeGreaterThan(370);
    expect(r.perServe?.kcal).toBeLessThan(400);
  });

  it('falls back to nutrition in embedded app data', () => {
    const html = `<html><head><title>Pasta bake | Woolworths</title></head><body><script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { recipe: { nutrition: { energyKj: 2500, protein: 38, fat: 20, carbohydrate: 60 } } } })}</script></body></html>`;
    const r = parseRecipePage(html);
    expect(r.from).toBe('app-data');
    expect(r.name).toBe('Pasta bake');
    expect(r.perServe).toMatchObject({ kcal: 598, protein: 38, fat: 20, carbs: 60 });
  });

  it('says when a page has no nutrition', () => {
    const r = parseRecipePage('<html><head><title>Just a page</title></head><body>Hello</body></html>');
    expect(r.from).toBe('none');
    expect(r.perServe).toBeUndefined();
  });
});

describe('noticed most', () => {
  it('leaves drinks out: caffeine and alcohol are not things noticed', () => {
    const st = { createdAt: '', updatedAt: '' };
    const cs: CheckIn[] = [
      { id: 'a', at: '2026-10-01T09:00:00Z', chips: ['Caffeine'], caffeineMg: 95, ...st },
      { id: 'b', at: '2026-10-01T10:00:00Z', chips: ['Caffeine', 'Jittery'], ...st },
      { id: 'c', at: '2026-10-01T20:00:00Z', chips: ['Alcohol'], ...st },
      { id: 'e', at: '2026-10-02T11:00:00Z', chips: ['Period started'], ...st },
      { id: 'd', at: '2026-10-02T09:00:00Z', chips: ['Headache'], ...st },
    ];
    expect(chipCounts(cs, 0, Infinity).map((c) => c.chip)).toEqual(['Headache', 'Jittery']);
  });
});

import { normUrl } from '../src/logic/recipeImport';
import { estimateRecipe, looksLikeIngredients, readLine, tbspFor } from '../src/logic/recipeEstimate';

describe('the same recipe, shared twice', () => {
  it('normalises the link', () => {
    const a = normUrl('https://www.woolworths.com.au/shop/recipes/one-pan-mexican-chicken/?utm_source=app&utm_medium=share#method');
    expect(a).toBe('woolworths.com.au/shop/recipes/one-pan-mexican-chicken');
    expect(normUrl('https://woolworths.com.au/shop/recipes/one-pan-mexican-chicken')).toBe(a);
    expect(normUrl('https://example.com/recipe?id=42')).toBe('example.com/recipe?id=42');
  });
});

describe('older recipe pages (microdata)', () => {
  it('reads ingredients and serves from itemprop markup', () => {
    const html = '<html><head><title>Beef chilli | Site</title></head><body><span itemprop="recipeYield">Serves 6</span><ul><li itemprop="recipeIngredient">500g beef mince</li><li itemprop="recipeIngredient">2 x 400g cans kidney beans, drained</li></ul></body></html>';
    const r = parseRecipePage(html);
    expect(r.ingredients).toEqual(['500g beef mince', '2 x 400g cans kidney beans, drained']);
    expect(r.serves).toBe(6);
    expect(r.from).toBe('none');
  });
});

describe('nutrition from the ingredients', () => {
  it('reads amounts as grams', () => {
    expect(readLine('500g chicken thigh fillets, trimmed').grams).toBe(500);
    expect(readLine('500g chicken thigh fillets, trimmed').as).toBe('Chicken thigh');
    expect(readLine('1 cup (200g) long grain white rice').grams).toBe(200);
    expect(readLine('1½ cups basmati rice').grams).toBe(300);
    expect(readLine('1/2 cup grated cheddar').grams).toBe(50);
    expect(readLine('2 x 400g cans black beans, rinsed, drained').grams).toBe(480); // drained
    expect(readLine('400g can diced tomatoes').grams).toBe(400); // nothing to drain
    expect(readLine('1 brown onion, finely chopped').grams).toBe(150);
    expect(readLine('2 large eggs').grams).toBeCloseTo(135.2);
    expect(readLine('3 garlic cloves').grams).toBe(15);
    expect(readLine('1 tbsp olive oil', 20).grams).toBeCloseTo(18.4);
    expect(readLine('1 tbsp olive oil', 15).grams).toBeCloseTo(13.8);
    expect(readLine('1kg potatoes').grams).toBe(1000);
  });
  it('the longest name wins', () => {
    expect(readLine('2 sweet potatoes').as).toBe('Sweet potato');
    expect(readLine('1 can coconut milk').as).toBe('Coconut milk');
    expect(readLine('1/4 cup sour cream').as).toBe('Sour cream');
    expect(readLine('2 cups chicken stock').as).toBe('Stock');
    expect(readLine('2 cups cooked rice').as).toBe('Cooked rice');
    expect(readLine('1 cup rice, cooked').as).toBe('Cooked rice');
    expect(readLine('Lime wedges, to serve').as).toBe('Lemon');
  });
  it('says what it leaves out', () => {
    expect(readLine('Steamed rice, to serve').skip).toBe('no-amount');
    expect(readLine('Salt and pepper, to taste').skip).toBe('minor');
    expect(readLine('2 cups dragonfruit glaze').skip).toBe('unknown');
    expect(readLine('For the salsa:').skip).toBe('minor');
  });
  it('a whole recipe, per serve, in a sensible range', () => {
    const lines = ['500g chicken thigh fillets', '1 tbsp olive oil', '1 brown onion', '2 garlic cloves', '35g sachet taco seasoning', '1 red capsicum',
      '1 cup (200g) long grain white rice', '400g can black beans, drained', '400g can diced tomatoes', '1½ cups salt-reduced chicken stock', 'Coriander, to serve'];
    const e = estimateRecipe(lines, 4);
    expect(e.perServe.kcal).toBeGreaterThan(480);
    expect(e.perServe.kcal).toBeLessThan(620);
    expect(e.perServe.protein).toBeGreaterThan(28);
    expect(e.perServe.protein).toBeLessThan(40);
    expect(e.counted).toBe(e.of);
    // Leaving the rice out takes about 180 Cal off a serve.
    const noRice = estimateRecipe(lines, 4, { leaveOut: new Set([6]) });
    expect(e.perServe.kcal! - noRice.perServe.kcal!).toBeGreaterThan(160);
    // Twice the serves, half each.
    expect(estimateRecipe(lines, 8).perServe.kcal).toBeCloseTo(e.perServe.kcal! / 2, -1);
  });
  it('spots an ingredient list in screenshot text, and the spoon size by site', () => {
    expect(looksLikeIngredients('Ingredients\n500g beef mince\n1 onion\n2 x 400g cans tomatoes\nMethod\nBrown the mince.')).toBe(true);
    expect(looksLikeIngredients('Nutrition per serve\nEnergy 2000kJ\nProtein 30g')).toBe(false);
    expect(tbspFor('https://www.taste.com.au/x')).toBe(20);
    expect(tbspFor('https://www.bbcgoodfood.com/x')).toBe(15);
    expect(tbspFor()).toBe(20);
  });
});
