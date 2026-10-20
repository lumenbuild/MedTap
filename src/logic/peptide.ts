// Peptides and other mixed (reconstituted) injections: a powder vial mixed with water, drawn up with an insulin
// syringe. Pure arithmetic on the person's own numbers: MedTap never suggests a dose.
import { addDays, format } from 'date-fns';
import type { Dose, Medication, PeptideSetup, Schedule, SyringeType } from '../db/schema';

export const SYRINGES: { value: SyringeType; label: string; unitsPerMl: number }[] = [
  { value: 'U-100', label: 'U-100 insulin syringe', unitsPerMl: 100 },
  { value: 'U-40', label: 'U-40 insulin syringe', unitsPerMl: 40 },
];
export const unitsPerMl = (s: SyringeType) => SYRINGES.find((x) => x.value === s)?.unitsPerMl ?? 100;

/** Syringe sizes, as their capacity in units on a U-100 syringe (0.3, 0.5 and 1 mL). */
export const SYRINGE_SIZES = [30, 50, 100];

const r = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Amount units that can be converted to each other. */
const TO_MCG: Record<string, number> = { mcg: 1, mg: 1000, g: 1_000_000 };
export function convert(amount: number, from: string, to: string): number | undefined {
  if (from === to) return amount;
  if (!(from in TO_MCG) || !(to in TO_MCG)) return undefined;
  return (amount * TO_MCG[from]) / TO_MCG[to];
}

/** Amount per mL once mixed (in the vial's unit). */
export const concentration = (vialAmount: number, waterMl: number) => (waterMl > 0 ? vialAmount / waterMl : NaN);

export interface Draw { ml: number; units: number }

/** How much to draw for a dose. The dose and vial amount are in the same unit. */
export function drawFor(dose: number, vialAmount: number, waterMl: number, syringe: SyringeType): Draw {
  const ml = (dose * waterMl) / vialAmount;
  return { ml: r(ml, 4), units: r(ml * unitsPerMl(syringe), 2) };
}

/** The dose in a number of units on the syringe. */
export function doseForUnits(units: number, vialAmount: number, waterMl: number, syringe: SyringeType): number {
  return r(((units / unitsPerMl(syringe)) * vialAmount) / waterMl, 4);
}

/** How much water to add so the dose is a given number of units (e.g. 10 units for an easy draw). */
export function waterForUnits(dose: number, vialAmount: number, targetUnits: number, syringe: SyringeType): number {
  return r(((targetUnits / unitsPerMl(syringe)) * vialAmount) / dose, 3);
}

export type DrawWarning = 'too-small' | 'too-big' | 'not-exact';

/** Things worth double-checking about a draw. Under 2 units is hard to measure accurately. */
export function drawWarnings(d: Draw, capacityUnits: number): DrawWarning[] {
  const w: DrawWarning[] = [];
  if (d.units > 0 && d.units < 2) w.push('too-small');
  if (d.units > capacityUnits) w.push('too-big');
  if (Math.abs(d.units * 2 - Math.round(d.units * 2)) > 0.05) w.push('not-exact'); // not on a half-unit mark
  return w;
}

/** "10 units", "7.5 units" */
export const fmtUnits = (u: number) => `${Number.isInteger(r(u, 1)) ? r(u, 0) : r(u, 1)} unit${r(u, 1) === 1 ? '' : 's'}`;
export const fmtMl = (ml: number) => `${r(ml, ml < 0.1 ? 3 : 2)} mL`;

export interface VialStatus {
  mixedAt: number;
  used: number;
  left: number;
  /** Doses of the usual size still in the vial. */
  dosesLeft: number;
  useBy?: number;
  expired: boolean;
}

/** The vial in use: what's left (from doses logged since it was mixed) and its use-within date. */
export function vialStatus(med: Pick<Medication, 'id' | 'strength' | 'defaultAmount' | 'peptide'>, doses: Dose[], now: number): VialStatus | undefined {
  const p = med.peptide;
  if (!p?.mixedAt || !(med.strength > 0)) return undefined;
  const mixedAt = Date.parse(p.mixedAt);
  const used = doses.filter((d) => d.medicationId === med.id && !d.skipped && !d.deletedAt && Date.parse(d.takenAt) >= mixedAt)
    .reduce((s, d) => s + d.amount, 0);
  const left = Math.max(0, r(med.strength - used, 4));
  const useBy = p.useWithinDays ? mixedAt + p.useWithinDays * 86_400_000 : undefined;
  return {
    mixedAt, used: r(used, 4), left,
    dosesLeft: med.defaultAmount > 0 ? Math.floor(r(left / med.defaultAmount, 6)) : 0,
    useBy, expired: useBy !== undefined && now > useBy,
  };
}

// ── Titration ───────────────────────────────────────────────────────────────────────────────────────

export interface TitrationInput {
  /** First step's dose and the date it starts ('YYYY-MM-DD'). */
  start: number; from: string;
  /** Change at each step (negative to step down). */
  step: number;
  /** Days between steps (7 for weekly, 28 for every 4 weeks). */
  everyDays: number;
  /** Stop at this dose (included). */
  until: number;
}

export interface TitrationStep { from: string; dose: number }

export const MAX_STEPS = 52;

/** Dose steps from `start` towards `until`, one every `everyDays`. Empty if the numbers don't lead there. */
export function titrationSteps(t: TitrationInput): TitrationStep[] {
  if (!(t.start > 0) || !(t.until > 0) || !(t.everyDays >= 1) || !t.step || !Number.isFinite(t.step)) return [];
  const up = t.until >= t.start;
  if ((up && t.step < 0) || (!up && t.step > 0)) return [];
  const steps: TitrationStep[] = [];
  const day0 = new Date(`${t.from}T12:00`);
  let dose = t.start;
  for (let i = 0; i < MAX_STEPS; i++) {
    steps.push({ from: format(addDays(day0, i * t.everyDays), 'yyyy-MM-dd'), dose: r(dose, 4) });
    if (r(dose, 4) === r(t.until, 4)) break;
    const next = dose + t.step;
    dose = up ? Math.min(next, t.until) : Math.max(next, t.until);
  }
  return steps;
}

/** The same schedule at a single new dose (set times and every-few-hours doses all use it). */
export function scheduleAtDose(sc: Schedule): Schedule {
  if (sc.type === 'fixed') {
    const slots = sc.slots?.length ? sc.slots.map(({ time }) => ({ time })) : sc.slots;
    return { ...sc, slots };
  }
  if (sc.type === 'interval') return { ...sc, doseAmounts: undefined };
  return sc;
}

export const isMixedVial = (m: Pick<Medication, 'peptide'>): m is { peptide: PeptideSetup } => !!m.peptide;
