// Training weights in the person's units. Stored in kg; shown and entered in kg or lb. Steps up and plates are worked
// out in the unit the person loads, so 135 lb goes to 140 lb (not 140.5).
import type { Units } from '../db/repos/settings';
import type { ExerciseDef } from './exercises';

const LB = 0.45359237;
export const loadUnit = (u: Units) => (u === 'imperial' ? 'lb' : 'kg');
/** kg → the number shown: kg to 2 dp (trimmed), lb to the nearest 0.5. */
export const showLoad = (kg: number, u: Units) => (u === 'imperial' ? Math.round((kg / LB) * 2) / 2 : Math.round(kg * 100) / 100);
export const fromLoad = (v: number, u: Units) => (u === 'imperial' ? v * LB : v);
export const fmtLoad = (kg: number, u: Units) => `${showLoad(kg, u)} ${loadUnit(u)}`;

/** The step up in the person's unit: kg as set on the exercise; in lb the nearest usual jump (2.5 kg → 5 lb). */
export function stepIn(def: Pick<ExerciseDef, 'increment'>, u: Units): number {
  if (u !== 'imperial' || def.increment <= 0) return def.increment;
  const lb = def.increment / LB;
  return [2.5, 5, 10].reduce((b, x) => (Math.abs(x - lb) < Math.abs(b - lb) ? x : b), 5);
}

/** Round a load to what can be put on: the nearest step in the person's unit. Returns kg. */
export function roundLoad(kg: number, def: Pick<ExerciseDef, 'increment'>, u: Units): number {
  const step = stepIn(def, u) || (u === 'imperial' ? 1 : 0.5);
  const v = Math.round(kg / (u === 'imperial' ? LB : 1) / step) * step;
  return fromLoad(v, u);
}

export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
export const PLATES_LB = [45, 35, 25, 10, 5, 2.5];
export const BARS = { metric: [20, 15, 10, 7], imperial: [45, 35, 25, 15] } as const;
