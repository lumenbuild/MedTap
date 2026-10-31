// A check on the amount before a dose is logged: far outside the peptide's usual range, what looks like a mg/mcg slip
// (1,000 times out), much more or less than the person's own usual dose, or more than is left in the vial. Each flag
// says what it noticed and, for a slip, the amount that was probably meant. It never blocks logging. Pure.
import type { Dose, Medication } from '../db/schema';
import { guideFor } from './peptideGuide';
import { convert, vialStatus } from './peptide';
import { fmtAmount } from './format';

export interface DoseFlag { kind: 'slip' | 'high' | 'low' | 'usual' | 'vial'; text: string; suggest?: number }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The usual single dose for a guide entry, in the medicine's unit: from the mixing table and the step-up. */
export function usualRange(med: Pick<Medication, 'name' | 'unit'>): [number, number] | undefined {
  const g = guideFor(med.name);
  if (!g) return undefined;
  const all = [...g.tableDoses, ...(g.steps ?? []).map((s) => s.amount), g.setup.defaultAmount];
  const lo = Math.min(...all), hi = Math.max(...all);
  if (med.unit === g.unit) return [lo, hi];
  const a = convert(lo, g.unit, med.unit), b = convert(hi, g.unit, med.unit);
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

export function doseCheck(med: Medication, amount: number, doses: Dose[], now: number): DoseFlag[] {
  if (!(amount > 0)) return [];
  const out: DoseFlag[] = [];
  const range = usualRange(med);
  const name = guideFor(med.name)?.name ?? med.name;
  const inRange = (x: number) => !!range && x >= range[0] / 2 && x <= range[1] * 2;

  if (range && !inRange(amount)) {
    // 1,000 times out and the other way round fits: a mg/mcg slip.
    const fix = [amount / 1000, amount * 1000].find(inRange);
    if (fix !== undefined) out.push({ kind: 'slip', text: `${fmtAmount(amount, med.unit)} is 1,000 times the usual ${name} dose. Did you mean ${fmtAmount(fix, med.unit)}?`, suggest: fix });
    else if (amount > range[1] * 2) out.push({ kind: 'high', text: `${fmtAmount(amount, med.unit)} is over twice the usual top dose of ${name} (${fmtAmount(range[1], med.unit)}).` });
    else out.push({ kind: 'low', text: `${fmtAmount(amount, med.unit)} is well under the usual starting dose of ${name} (${fmtAmount(range[0], med.unit)}).` });
  }

  // Against their own last 5 doses: 3 times more or less.
  const recent = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped && d.amount > 0).sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, 5).map((d) => d.amount);
  if (recent.length >= 3 && !out.some((f) => f.kind === 'slip')) {
    const usual = median(recent);
    if (amount >= usual * 3) out.push({ kind: 'usual', text: `That’s ${Math.round(amount / usual)} times your usual dose (${fmtAmount(usual, med.unit)}).`, suggest: usual });
    else if (amount <= usual / 3) out.push({ kind: 'usual', text: `That’s a third or less of your usual dose (${fmtAmount(usual, med.unit)}).`, suggest: usual });
  }

  // More than is left in the vial or pen in use.
  if (med.peptide) {
    const v = vialStatus(med, doses, now);
    if (v && !v.expired && amount > v.left + 1e-9) out.push({ kind: 'vial', text: v.left > 0 ? `Only about ${fmtAmount(v.left, med.unit)} is left in this ${med.peptide.kind === 'pen' ? 'pen' : 'vial'}: the rest comes from the next one.` : `This ${med.peptide.kind === 'pen' ? 'pen' : 'vial'} should be empty: time to start a new one.` });
  }
  return out;
}
