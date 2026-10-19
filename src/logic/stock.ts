import type { Medication } from '../db/schema';

/** How much one logged dose takes off the stock count (e.g. a 20 mg dose of 10 mg tablets = 2). */
export function stockUnitsFor(med: Pick<Medication, 'strength'>, amount: number): number {
  return med.strength > 0 ? round(amount / med.strength) : 1;
}

export const round = (n: number) => Math.round(n * 1000) / 1000;
