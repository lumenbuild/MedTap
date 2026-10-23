// What a medicine costs (peptide tools, and any medicine with a price): per mg from each vial or pen's price (or the
// medicine's), what's been spent, the weekly and monthly rate now, the next 12 weeks following the plan (dose steps
// included), and the cheapest supplier per mg. From prices the person enters. Pure.
import type { Dose, Medication } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { plannedAmounts } from './schedule';
import { medOn } from './plans';
import { dayKey } from './stats';

const DAY = 86_400_000;

/** Price per unit of the medicine's unit (e.g. $ per mg) for a vial / pen, or for the medicine (per strength unit). */
export function pricePerUnit(med: Medication, vialId?: string): number | undefined {
  const v = vialId ? med.vials?.find((x) => x.id === vialId) : undefined;
  if (v?.cost && v.amount > 0) return v.cost / v.amount;
  if (med.costPerUnit && med.peptide) {
    const amount = v?.amount ?? med.vials?.find((x) => x.status === 'in-use')?.amount ?? med.strength;
    return amount > 0 ? med.costPerUnit / amount : undefined;
  }
  return undefined;
}

export interface CostSummary {
  perUnit?: number;            // now (vial in use or the medicine's price)
  spent: number; spentSince?: number; // priced doses so far
  perWeek?: number; perMonth?: number; // at the recent rate (last 4 weeks)
  next12Weeks?: number;        // following the plan
  cheapest?: { supplier: string; perUnit: number; vials: number }[];
}

export function costSummary(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): CostSummary | null {
  const priced = (med.vials ?? []).some((v) => v.cost) || !!med.costPerUnit;
  if (!priced) return null;
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now);
  const inUse = med.vials?.find((v) => v.status === 'in-use');
  const perUnit = pricePerUnit(med, inUse?.id);
  let spent = 0, first: number | undefined;
  for (const d of mine) {
    const p = pricePerUnit(med, d.vialId) ?? perUnit;
    if (p === undefined) continue;
    spent += d.amount * p;
    first = Math.min(first ?? Infinity, Date.parse(d.takenAt));
  }
  const recent = mine.filter((d) => Date.parse(d.takenAt) > now - 28 * DAY);
  const perWeek = perUnit !== undefined && recent.length ? (recent.reduce((n, d) => n + d.amount, 0) / 4) * perUnit : undefined;
  // The plan, day by day, with planned dose changes switching over on their dates.
  let planned = 0;
  if (perUnit !== undefined && med.schedule.type !== 'prn') {
    for (let i = 1; i <= 84; i++) {
      const t = now + i * DAY;
      planned += plannedAmounts(medOn(med, dayKey(t, s)), t, s).reduce((a, b) => a + b, 0);
    }
  }
  const bySupplier = new Map<string, { total: number; amount: number; vials: number }>();
  for (const v of med.vials ?? []) {
    if (!v.cost || !v.amount) continue;
    const k = v.supplier?.trim() || 'No supplier entered';
    const x = bySupplier.get(k) ?? { total: 0, amount: 0, vials: 0 };
    bySupplier.set(k, { total: x.total + v.cost, amount: x.amount + v.amount, vials: x.vials + 1 });
  }
  const cheapest = [...bySupplier].map(([supplier, x]) => ({ supplier, perUnit: x.total / x.amount, vials: x.vials })).sort((a, b) => a.perUnit - b.perUnit);
  return {
    perUnit, spent: Math.round(spent * 100) / 100, spentSince: first,
    perWeek: perWeek !== undefined ? Math.round(perWeek * 100) / 100 : undefined,
    perMonth: perWeek !== undefined ? Math.round(perWeek * (365.25 / 12 / 7) * 100) / 100 : undefined,
    next12Weeks: planned && perUnit !== undefined ? Math.round(planned * perUnit * 100) / 100 : undefined,
    cheapest: cheapest.length > 1 ? cheapest : undefined,
  };
}

export const money = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: n < 10 ? 2 : 0 });

/** An ordinary medicine priced per pack: about what it costs a month at the last 4 weeks' use (pack price ÷ pack
 *  size per tablet; doses are logged in the medicine's unit). */
export function monthlyPackCost(med: Medication, doses: Dose[], now: number): number | undefined {
  if (med.peptide || !med.costPerUnit || !med.packSize) return undefined;
  const per = med.costPerUnit / med.packSize;
  const mass = ['mg', 'mcg', 'g'].includes(med.unit) && med.strength > 0;
  const recent = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) <= now && Date.parse(d.takenAt) > now - 28 * DAY);
  if (!recent.length) return undefined;
  const units = recent.reduce((n, d) => n + (mass ? d.amount / med.strength : d.amount), 0);
  return Math.round((units / 28) * (365.25 / 12) * per * 100) / 100;
}
