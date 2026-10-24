import { describe, it, expect } from 'vitest';
import { addNutrients, fmtEnergy, fmtNutrient, fromOpenFoodFacts, parsePanel, portionNutrients, scaleNutrients, totalsFor } from '../src/logic/nutrition';
import type { FoodLog } from '../src/db/schema';

const MONSTER_AU = `NUTRITION INFORMATION
Servings per package: 1
Serving size: 500mL
Average Quantity per Serving per 100mL
Energy 46kJ 9kJ
Protein 0.0g 0.0g
Fat, total 0.0g 0.0g
- saturated 0.0g 0.0g
Carbohydrate 4.5g 0.9g
- sugars 0.0g 0.0g
Sodium 190mg 38mg
Niacin (B3) 8.5mg 1.7mg
Vitamin B6 0.85mg 0.17mg
Vitamin B12 2.4µg 0.48µg
Caffeine 150mg 30mg
Taurine 2000mg 400mg`;

const SHAKE = `Servings per pack: 33
Serving size: 30g
Avg Qty per Serving | per 100g
Energy 480kJ (115Cal) 1600kJ (382Cal)
Protein 24.0g 80.0g
Fat, total 1.5g 5.0g
- saturated 0.9 g 3.0 g
Carbohydrate 1.2g 4.0g
- sugars 1.0g 3.3g
Sodium 45mg 150mg
Calcium 150mg 500mg`;

const US = `Nutrition Facts
Serving size 1 can (473mL)
Calories 10
Total Fat 0g 0%
Sodium 370mg 16%
Total Carbohydrate 3g 1%
Total Sugars 0g
Includes 0g Added Sugars 0%
Protein 0g
Niacin 40mg 250%
Vitamin B6 4mg 240%
Vitamin B12 12mcg 500%`;

describe('reading a nutrition panel', () => {
  it('an Australian energy drink: per serving and per 100 mL, macros and micros', () => {
    const p = parsePanel(MONSTER_AU);
    expect(p.servingQty).toBe(500);
    expect(p.servingUnit).toBe('mL');
    expect(p.perServing).toMatchObject({ kcal: 11, protein: 0, fat: 0, carbs: 4.5, sugars: 0, sodium: 190, b3: 8.5, b6: 0.85, b12: 2.4, caffeine: 150, taurine: 2000 });
    expect(p.per100).toMatchObject({ kcal: 2, carbs: 0.9, caffeine: 30 });
  });
  it('a protein powder with Cal beside kJ', () => {
    const p = parsePanel(SHAKE);
    expect(p.servingQty).toBe(30);
    expect(p.perServing).toMatchObject({ kcal: 115, protein: 24, fat: 1.5, satFat: 0.9, carbs: 1.2, sugars: 1, sodium: 45, calcium: 150 });
    expect(p.per100).toMatchObject({ kcal: 382, protein: 80 });
  });
  it('a US label: calories, daily-value percentages skipped, mcg', () => {
    const p = parsePanel(US);
    expect(p.servingQty).toBe(473);
    expect(p.perServing).toMatchObject({ kcal: 10, fat: 0, sodium: 370, carbs: 3, sugars: 0, protein: 0, b3: 40, b6: 4, b12: 12 });
    expect(p.per100).toEqual({});
  });
});

describe('Open Food Facts', () => {
  it('per serving from per 100 mL and the serving size, in each nutrient\'s unit', () => {
    const p = fromOpenFoodFacts({
      product_name: 'Monster Energy Ultra', brands: 'Monster Energy, Coca-Cola', serving_size: '500 ml', serving_quantity: 500,
      nutriments: { 'energy-kcal_100g': 2, 'energy-kj_100g': 9, proteins_100g: 0, carbohydrates_100g: 0.9, sugars_100g: 0, sodium_100g: 0.038,
        caffeine_100g: 0.03, 'vitamin-b6_100g': 0.00017, 'vitamin-b12_100g': 0.00000048, 'vitamin-pp_100g': 0.0017 },
    });
    expect(p.name).toBe('Monster Energy Ultra');
    expect(p.brand).toBe('Monster Energy');
    expect(p.servingUnit).toBe('mL');
    expect(p.nutrients).toMatchObject({ kcal: 10, carbs: 4.5, sodium: 190, caffeine: 150, b6: 0.85, b12: 2.4, b3: 8.5 });
    expect(p.per100).toMatchObject({ caffeine: 30 });
  });
  it('per 100 g when there is no serving size, and kJ only', () => {
    const p = fromOpenFoodFacts({ product_name: 'Oats', nutriments: { 'energy-kj_100g': 1590, proteins_100g: 12, carbohydrates_100g: 58 } });
    expect(p.serving).toBe('100 g');
    expect(p.nutrients).toMatchObject({ kcal: 380, protein: 12, carbs: 58 });
  });
});

describe('meals you make and totals', () => {
  it('hand portions add up to an estimate', () => {
    const n = portionNutrients({ palm: 2, cupped: 1, fist: 2, thumb: 1 });
    expect(n).toMatchObject({ protein: 51, carbs: 36, fat: 17 });
    expect(n.kcal).toBe(505);
  });
  it('scales, adds and formats', () => {
    expect(scaleNutrients({ kcal: 115, protein: 24 }, 1.5)).toEqual({ kcal: 173, protein: 36 });
    expect(addNutrients({ protein: 24 }, { protein: 0.5, caffeine: 150 })).toEqual({ protein: 24.5, caffeine: 150 });
    expect(fmtEnergy(203, 'kcal')).toBe('203 Cal');
    expect(fmtEnergy(203, 'kJ')).toBe('849 kJ');
    expect(fmtNutrient('b12', 2.4)).toBe('2.4 µg');
    const st = { createdAt: '', updatedAt: '' };
    const logs: FoodLog[] = [
      { id: 'a', at: '2026-10-23T01:00:00Z', name: 'Shake', servings: 1, nutrients: { protein: 24 }, ...st },
      { id: 'b', at: '2026-10-23T02:00:00Z', name: 'Gone', servings: 1, nutrients: { protein: 50 }, deletedAt: 'x', ...st },
      { id: 'c', at: '2026-10-22T02:00:00Z', name: 'Yesterday', servings: 1, nutrients: { protein: 50 }, ...st },
    ];
    expect(totalsFor(logs, Date.parse('2026-10-23T00:00:00Z'), Date.parse('2026-10-24T00:00:00Z'))).toEqual({ protein: 24 });
  });
});

describe('OCR slips', () => {
  it('reads k] as kJ and a trailing 9 as g', () => {
    const p = parsePanel(`Average Quantity per Serving per 100mL
Energy 610k] 185k]
Fat, total 2.0g 0.69
- sugars 7.5g 2.39`);
    expect(p.perServing).toMatchObject({ kcal: 146, fat: 2, sugars: 7.5 });
    expect(p.per100).toMatchObject({ kcal: 44, fat: 0.6, sugars: 2.3 });
  });
});
