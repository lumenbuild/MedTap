// The person's own water and protein amounts (their cup, their bottle, their scoop), kept most recently used first so
// the buttons on Today, the widget and a tag all offer what they actually drink.

export type IntakeField = 'waterMl' | 'proteinG';
export const MAX_AMOUNTS = 4;
export const INTAKE_LIMIT: Record<IntakeField, number> = { waterMl: 5000, proteinG: 300 };

/** A typed amount, or null if it isn't one: whole numbers, more than 0, no more than a sane single serving. */
export function parseAmount(text: string, field: IntakeField): number | null {
  const n = Math.round(Number(text.replace(',', '.')));
  return Number.isFinite(n) && n > 0 && n <= INTAKE_LIMIT[field] ? n : null;
}

/** Used: to the front, if it's one of the buttons. */
export const usedAmount = (list: number[], n: number) => (list.includes(n) ? [n, ...list.filter((x) => x !== n)] : list);

/** Kept as a button: to the front; past the limit, the one used longest ago goes. */
export const keepAmount = (list: number[], n: number) => [n, ...list.filter((x) => x !== n)].slice(0, MAX_AMOUNTS);

/** The buttons in size order, so they stay put as the order of use changes. */
export const shownAmounts = (list: number[]) => [...list].sort((a, b) => a - b);
