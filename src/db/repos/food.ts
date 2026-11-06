// Food: saved products, meals and recipes, and what was eaten. A logged food's protein is added to the day's protein
// (so Today, widgets, the watch and Trends all count it) and its caffeine makes a caffeine check-in (so the
// caffeine-and-sleep finding counts it); a drink's volume goes on the day's water (not alcohol); removing the entry
// takes them all back off.
import { db } from '../db';
import { DEFAULT_PERSON, type EatWhy, type Food, type FoodLog, type Nutrients } from '../schema';
import { addIntake } from './training';
import { addCheckIn, removeCheckIn, restoreCheckIn } from './checkIns';
import { storedPerson } from './people';
import { CAFFEINE } from '../../logic/lifestyle';
import { scaleNutrients } from '../../logic/nutrition';
import { drinkMl } from '../../logic/caffeine';

const nowIso = () => new Date().toISOString();

export type FoodInput = Omit<Food, 'id' | 'createdAt' | 'updatedAt'>;

/** Save a food (a product with the same barcode is updated rather than added twice). */
export async function saveFood(input: FoodInput): Promise<Food> {
  const now = nowIso();
  const same = input.barcode ? (await db.foods.where('barcode').equals(input.barcode).toArray()).find((f) => !f.deletedAt) : undefined;
  const food: Food = same ? { ...same, ...input, id: same.id, createdAt: same.createdAt, updatedAt: now } : { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.foods.put(food);
  return food;
}

export async function updateFood(id: string, patch: Partial<FoodInput>) {
  await db.foods.update(id, { ...patch, updatedAt: nowIso() });
}

export async function removeFood(id: string) {
  await db.foods.update(id, { deletedAt: nowIso(), updatedAt: nowIso() });
}

/** A recipe saved from this web page before (the address normalised). */
export async function foodBySourceUrl(url: string): Promise<Food | undefined> {
  return (await db.foods.filter((f) => f.sourceUrl === url && !f.deletedAt).toArray())[0];
}

export async function foodByBarcode(code: string): Promise<Food | undefined> {
  return (await db.foods.where('barcode').equals(code).toArray()).find((f) => !f.deletedAt);
}

export interface LogInput {
  name: string; foodId?: string; servings: number;
  /** Nutrients for the amount eaten (servings already applied). */
  nutrients: Nutrients;
  at: string;
  /** The person's day it counts towards ('YYYY-MM-DD'), for the protein total. */
  date: string;
  hunger?: number; why?: EatWhy;
  personId: string;
}

const ALCOHOL = /\b(beer|lager|ale|stout|cider|wine|champagne|prosecco|spritz|vodka|gin|rum|whisk(e)?y|bourbon|tequila|seltzer|cocktail|pre-?mix|rtd|sake|liqueur)\b/i;
const NOT_A_DRINK = /\b(sauce|oil|dressing|syrup|vinegar|soup|gravy|cream)\b/i;

/** How much of an entry is something to drink (mL), to count toward the day's water: a product measured in mL (100 mL
 *  or more, not sauces or oils), or a caffeine drink whose size is known. Never alcohol. */
export function waterFromLog(name: string, servings: number, food?: Pick<Food, 'servingQty' | 'servingUnit' | 'kind'>, caffeine?: number): number | undefined {
  if (ALCOHOL.test(name) || NOT_A_DRINK.test(name)) return undefined;
  if (food?.servingUnit === 'mL' && food.servingQty && food.kind === 'product') {
    const ml = Math.round(food.servingQty * servings);
    return ml >= 100 ? ml : undefined;
  }
  const known = (caffeine ?? 0) >= 1 ? drinkMl(name) : undefined;
  return known ? Math.round(known * servings) : undefined;
}

/** Log something eaten. Returns the entry, for undo. */
export async function logFood(x: LogInput): Promise<FoodLog> {
  const now = nowIso();
  const personId = storedPerson(x.personId);
  const protein = x.nutrients.protein && x.nutrients.protein > 0 ? x.nutrients.protein : undefined;
  if (protein) await addIntake(x.personId, x.date, 'proteinG', protein);
  const caffeine = (x.nutrients.caffeine ?? 0) >= 1 ? await addCheckIn({ at: x.at, chips: [CAFFEINE], note: x.name, personId, caffeineMg: Math.round(x.nutrients.caffeine!) }, { water: false }) : undefined;
  const food = x.foodId ? await db.foods.get(x.foodId) : undefined;
  const water = waterFromLog(x.name, x.servings, food, x.nutrients.caffeine);
  if (water) await addIntake(x.personId, x.date, 'waterMl', water);
  const log: FoodLog = {
    id: crypto.randomUUID(), at: x.at, name: x.name, foodId: x.foodId, servings: x.servings, nutrients: x.nutrients,
    proteinPosted: protein, caffeineCheckInId: caffeine?.id, waterPosted: water, hunger: x.hunger, why: x.why, personId, createdAt: now, updatedAt: now,
  };
  await db.foodLogs.add(log);
  if (x.foodId) await db.foods.update(x.foodId, { lastUsedAt: now });
  return log;
}

/** Change how much was eaten (the nutrients scale with it, and the protein total follows). */
export async function changeServings(log: FoodLog, servings: number, date: string) {
  if (!(servings > 0) || !(log.servings > 0)) return;
  const nutrients = scaleNutrients(log.nutrients, servings / log.servings);
  const protein = nutrients.protein && nutrients.protein > 0 ? nutrients.protein : undefined;
  const delta = (protein ?? 0) - (log.proteinPosted ?? 0);
  if (delta) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'proteinG', delta);
  const water = log.waterPosted ? Math.round((log.waterPosted * servings) / log.servings) : undefined;
  if (water && log.waterPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'waterMl', water - log.waterPosted);
  await db.foodLogs.update(log.id, { servings, nutrients, proteinPosted: protein, waterPosted: water, updatedAt: nowIso() });
}

/** Remove an entry, taking its protein and caffeine back off. */
export async function removeFoodLog(log: FoodLog, date: string) {
  if (log.proteinPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'proteinG', -log.proteinPosted);
  if (log.caffeineCheckInId) await removeCheckIn(log.caffeineCheckInId);
  if (log.waterPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'waterMl', -log.waterPosted);
  await db.foodLogs.update(log.id, { deletedAt: nowIso(), updatedAt: nowIso() });
}

/** Undo a removal. */
export async function restoreFoodLog(log: FoodLog, date: string) {
  if (log.proteinPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'proteinG', log.proteinPosted);
  if (log.caffeineCheckInId) await restoreCheckIn(log.caffeineCheckInId);
  if (log.waterPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'waterMl', log.waterPosted);
  await db.foodLogs.update(log.id, { deletedAt: undefined, updatedAt: nowIso() });
}
