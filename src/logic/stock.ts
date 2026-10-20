import type { Dose, Medication } from '../db/schema';

/** How much one logged dose takes off the stock count (e.g. a 20 mg dose of 10 mg tablets = 2). */
export function stockUnitsFor(med: Pick<Medication, 'strength'>, amount: number): number {
  return med.strength > 0 ? round(amount / med.strength) : 1;
}

export const round = (n: number) => Math.round(n * 1000) / 1000;

/** Stock = the count last set (by hand or a refill) − doses logged since + doses since deleted that were logged
 *  before it. Undefined when the medication doesn't track stock or has no starting point. */
export function recountStock(med: Pick<Medication, 'id' | 'strength' | 'stockCount' | 'stockBase'>, doses: Dose[]): number | undefined {
  const base = med.stockBase;
  if (!base || med.stockCount === undefined || med.stockCount === null) return undefined;
  let n = base.count;
  for (const d of doses) {
    if (d.medicationId !== med.id || d.skipped) continue;
    const units = stockUnitsFor(med, d.amount);
    const loggedAfter = d.createdAt > base.at;
    if (loggedAfter && !d.deletedAt) n -= units;
    else if (!loggedAfter && d.deletedAt && d.deletedAt > base.at) n += units;
  }
  return round(n);
}
