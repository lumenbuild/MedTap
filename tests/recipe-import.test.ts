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
