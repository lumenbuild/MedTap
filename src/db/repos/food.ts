// Food: saved products, meals and recipes, and what was eaten. A logged food's protein is added to the day's protein
// (so Today, widgets, the watch and Trends all count it) and its caffeine makes a caffeine check-in (so the
// caffeine-and-sleep finding counts it); removing the entry takes both back off.
import { db } from '../db';
import { DEFAULT_PERSON, type Food, type FoodLog, type Nutrients } from '../schema';
import { addIntake } from './training';
import { addCheckIn, removeCheckIn, restoreCheckIn } from './checkIns';
import { storedPerson } from './people';
import { CAFFEINE } from '../../logic/lifestyle';
import { scaleNutrients } from '../../logic/nutrition';

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
  personId: string;
}

/** Log something eaten. Returns the entry, for undo. */
export async function logFood(x: LogInput): Promise<FoodLog> {
  const now = nowIso();
  const personId = storedPerson(x.personId);
  const protein = x.nutrients.protein && x.nutrients.protein > 0 ? x.nutrients.protein : undefined;
  if (protein) await addIntake(x.personId, x.date, 'proteinG', protein);
  const caffeine = (x.nutrients.caffeine ?? 0) >= 1 ? await addCheckIn({ at: x.at, chips: [CAFFEINE], note: x.name, personId }) : undefined;
  const log: FoodLog = {
    id: crypto.randomUUID(), at: x.at, name: x.name, foodId: x.foodId, servings: x.servings, nutrients: x.nutrients,
    proteinPosted: protein, caffeineCheckInId: caffeine?.id, personId, createdAt: now, updatedAt: now,
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
  await db.foodLogs.update(log.id, { servings, nutrients, proteinPosted: protein, updatedAt: nowIso() });
}

/** Remove an entry, taking its protein and caffeine back off. */
export async function removeFoodLog(log: FoodLog, date: string) {
  if (log.proteinPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'proteinG', -log.proteinPosted);
  if (log.caffeineCheckInId) await removeCheckIn(log.caffeineCheckInId);
  await db.foodLogs.update(log.id, { deletedAt: nowIso(), updatedAt: nowIso() });
}

/** Undo a removal. */
export async function restoreFoodLog(log: FoodLog, date: string) {
  if (log.proteinPosted) await addIntake(log.personId ?? DEFAULT_PERSON, date, 'proteinG', log.proteinPosted);
  if (log.caffeineCheckInId) await restoreCheckIn(log.caffeineCheckInId);
  await db.foodLogs.update(log.id, { deletedAt: undefined, updatedAt: nowIso() });
}
