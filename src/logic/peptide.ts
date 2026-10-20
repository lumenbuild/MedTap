// Peptides and other mixed (reconstituted) injections: a powder vial mixed with water, drawn up with an insulin
// syringe. Pure arithmetic on the person's own numbers: MedTap never suggests a dose.
import { addDays, format } from 'date-fns';
import type { CheckIn, Dose, Medication, PeptideSetup, PeptideVial, Schedule, Supply, SupplyKind, SyringeType } from '../db/schema';

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

// ── Vials and pens ─────────────────────────────────────────────────────────────────────────────────

type VialMed = Pick<Medication, 'id' | 'strength' | 'defaultAmount' | 'peptide' | 'vials'>;
export const isPen = (m: Pick<Medication, 'peptide'>) => m.peptide?.kind === 'pen';

/** The medication's vials/pens, including the one recorded before vial records existed. */
export function vialsOf(med: VialMed): PeptideVial[] {
  if (med.vials?.length) return med.vials;
  const p = med.peptide;
  if (!p?.mixedAt) return [];
  return [{ id: 'legacy', status: 'in-use', amount: med.strength, waterMl: p.waterMl, addedAt: p.mixedAt, startedAt: p.mixedAt }];
}

/** The vial or pen being used now (the most recently started). */
export function currentVial(med: VialMed): PeptideVial | undefined {
  return vialsOf(med).filter((v) => v.status === 'in-use').sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
}

/** Unopened vials/pens, the one to use next first (soonest expiry, then oldest). */
export function stockVials(med: VialMed): PeptideVial[] {
  return vialsOf(med).filter((v) => v.status === 'stock')
    .sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') || a.addedAt.localeCompare(b.addedAt));
}

/** Doses that came from a vial: recorded against it, or (older doses) logged while it was in use. */
export function dosesFromVial(vial: PeptideVial, medId: string, doses: Dose[]): Dose[] {
  const from = vial.startedAt ? Date.parse(vial.startedAt) : Infinity;
  const to = vial.finishedAt ? Date.parse(vial.finishedAt) : Infinity;
  return doses.filter((d) => d.medicationId === medId && !d.skipped && !d.deletedAt
    && (d.vialId ? d.vialId === vial.id : Date.parse(d.takenAt) >= from && Date.parse(d.takenAt) < to));
}

export interface VialStatus {
  vial: PeptideVial;
  startedAt: number;
  used: number;
  left: number;
  /** Doses of the usual size still in it. */
  dosesLeft: number;
  useBy?: number;
  expired: boolean;
}

/** The vial or pen in use: what's left (from the doses logged from it) and its use-within date. */
export function vialStatus(med: VialMed, doses: Dose[], now: number, vial = currentVial(med)): VialStatus | undefined {
  if (!vial?.startedAt || !(vial.amount > 0)) return undefined;
  const startedAt = Date.parse(vial.startedAt);
  const used = dosesFromVial(vial, med.id, doses).reduce((n, d) => n + d.amount, 0);
  const left = Math.max(0, r(vial.amount - used, 4));
  const days = med.peptide?.useWithinDays;
  const useBy = days ? startedAt + days * 86_400_000 : undefined;
  return {
    vial, startedAt, used: r(used, 4), left,
    dosesLeft: med.defaultAmount > 0 ? Math.floor(r(left / med.defaultAmount, 6)) : 0,
    useBy, expired: useBy !== undefined && now > useBy,
  };
}

/** What to draw (vials) or dial (pens) for a dose, from the vial or pen in use. */
export type Guide = { kind: 'draw'; draw: Draw; capacity: number; syringe: SyringeType; waterMl: number; amount: number }
  | { kind: 'pen'; clicks?: number };

export function doseGuide(med: Pick<Medication, 'strength' | 'peptide' | 'vials' | 'id' | 'defaultAmount'>, dose: number): Guide | undefined {
  const p = med.peptide;
  if (!p || !(dose > 0)) return undefined;
  if (p.kind === 'pen') return { kind: 'pen', clicks: p.amountPerClick ? r(dose / p.amountPerClick, 1) : undefined };
  const v = currentVial(med);
  const amount = v?.amount ?? med.strength;
  const waterMl = v?.waterMl ?? p.waterMl;
  if (!(amount > 0) || !(waterMl > 0)) return undefined;
  return { kind: 'draw', draw: drawFor(dose, amount, waterMl, p.syringe), capacity: p.syringeUnits, syringe: p.syringe, waterMl, amount };
}

// ── Blends ──────────────────────────────────────────────────────────────────────────────────────────

export interface BlendAmount { name: string; amount: number; unit: string }

/** Each peptide in a dose of a blend: the medication's own amount, and the others in proportion. */
export function blendAmounts(med: Pick<Medication, 'name' | 'strength' | 'unit' | 'peptide'>, dose: number): BlendAmount[] {
  const parts = med.peptide?.blend ?? [];
  if (!parts.length || !(med.strength > 0)) return [];
  return [{ name: med.name, amount: r(dose, 4), unit: med.unit }, ...parts.map((b) => ({ name: b.name, amount: r((dose * b.amount) / med.strength, 4), unit: b.unit }))];
}

// ── Estimated level ─────────────────────────────────────────────────────────────────────────────────

/** Estimated amount still in the body at each time, from each dose halving every `halfLifeHours`.
 *  A rough model (immediate absorption, simple decay) on the person's own half-life figure. */
export function estimatedLevel(doses: Dose[], halfLifeHours: number, from: number, to: number, points = 200): { t: number; v: number }[] {
  if (!(halfLifeHours > 0) || to <= from) return [];
  const taken = doses.filter((d) => !d.skipped && !d.deletedAt).map((d) => ({ t: Date.parse(d.takenAt), a: d.amount })).sort((a, b) => a.t - b.t);
  const k = Math.LN2 / (halfLifeHours * 3_600_000);
  const out: { t: number; v: number }[] = [];
  const step = (to - from) / (points - 1);
  for (let i = 0; i < points; i++) {
    const t = from + i * step;
    let v = 0;
    for (const d of taken) if (d.t <= t) v += d.a * Math.exp(-k * (t - d.t));
    out.push({ t, v: r(v, 4) });
  }
  return out;
}

// ── Dose levels: weight and side effects at each dose ───────────────────────────────────────────────

export interface DoseLevel {
  dose: number;
  from: number; to: number;
  doses: number;
  weightStart?: number; weightEnd?: number;
  /** kg per week over the level (needs two weigh-ins). */
  perWeek?: number;
  appetite?: number;
  noticed: { chip: string; n: number }[];
}

/** Periods at each dose amount (from the doses actually logged), with the weight change and check-ins in each. */
export function doseLevels(doses: Dose[], weights: { t: number; kg: number }[], checkIns: CheckIn[], now: number): DoseLevel[] {
  const taken = doses.filter((d) => !d.skipped && !d.deletedAt).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const levels: DoseLevel[] = [];
  for (const d of taken) {
    const t = Date.parse(d.takenAt);
    const last = levels[levels.length - 1];
    if (last && r(last.dose, 4) === r(d.amount, 4)) { last.doses++; continue; }
    if (last) last.to = t;
    levels.push({ dose: d.amount, from: t, to: now, doses: 1, noticed: [] });
  }
  const ws = [...weights].sort((a, b) => a.t - b.t);
  for (const l of levels) {
    const before = ws.filter((w) => w.t <= l.from).pop() ?? ws.find((w) => w.t > l.from && w.t <= l.to);
    const end = ws.filter((w) => w.t <= l.to).pop();
    if (before && end && end.t > before.t) {
      l.weightStart = before.kg; l.weightEnd = end.kg;
      l.perWeek = r(((end.kg - before.kg) / (end.t - before.t)) * 7 * 86_400_000, 2);
    }
    const cis = checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) >= l.from && Date.parse(c.at) < l.to);
    const app = cis.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
    if (app.length) l.appetite = r(app.reduce((a, b) => a + b, 0) / app.length, 1);
    const counts = new Map<string, number>();
    for (const c of cis) for (const chip of c.chips) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    l.noticed = [...counts].map(([chip, n]) => ({ chip, n })).sort((a, b) => b.n - a.n).slice(0, 3);
  }
  return levels;
}

// ── Supplies ────────────────────────────────────────────────────────────────────────────────────────

export const SUPPLY_LABELS: Record<SupplyKind, { name: string; unit: string }> = {
  syringes: { name: 'Syringes', unit: '' },
  'pen-needles': { name: 'Pen needles', unit: '' },
  swabs: { name: 'Alcohol swabs', unit: '' },
  water: { name: 'Bacteriostatic water', unit: 'mL' },
  sharps: { name: 'Sharps container', unit: '' },
};

/** Supplies on hand now: the count set, less what's been used since (doses logged, or water used mixing vials).
 *  For the sharps container, how many are in it. */
export function supplyCount(sup: Pick<Supply, 'kind' | 'base'>, meds: Medication[], doses: Dose[]): number {
  const since = sup.base.at;
  if (sup.kind === 'water') {
    const used = meds.flatMap((m) => m.vials ?? []).filter((v) => v.startedAt && v.startedAt > since && v.waterMl).reduce((n, v) => n + (v.waterMl ?? 0), 0);
    return r(sup.base.count - used, 2);
  }
  const kind = new Map(meds.filter((m) => m.peptide).map((m) => [m.id, m.peptide!.kind ?? 'vial']));
  const uses = doses.filter((d) => !d.skipped && !d.deletedAt && d.createdAt > since && kind.has(d.medicationId))
    .filter((d) => sup.kind === 'swabs' || sup.kind === 'sharps' || (sup.kind === 'syringes' ? kind.get(d.medicationId) === 'vial' : kind.get(d.medicationId) === 'pen'))
    .length;
  return sup.kind === 'sharps' ? sup.base.count + uses : Math.max(0, sup.base.count - uses);
}

/** Supplies to mention on Today: running low, or the sharps container nearly full. */
export function supplyAlerts(supplies: Supply[], meds: Medication[], doses: Dose[]): { supply: Supply; count: number }[] {
  return supplies.filter((x) => !x.deletedAt).map((supply) => ({ supply, count: supplyCount(supply, meds, doses) })).filter(({ supply, count }) =>
    supply.kind === 'sharps'
      ? supply.capacity !== undefined && count >= (supply.warnAt ?? Math.floor(supply.capacity * 0.8))
      : supply.warnAt !== undefined && count <= supply.warnAt);
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

/** "10 units" or "18.5 clicks", for a dose of a vial or pen medication (undefined otherwise). */
export function guideText(med: Pick<Medication, 'strength' | 'peptide' | 'vials' | 'id' | 'defaultAmount'>, dose: number): string | undefined {
  const g = doseGuide(med, dose);
  if (!g) return undefined;
  if (g.kind === 'draw') return fmtUnits(g.draw.units);
  return g.clicks !== undefined ? `${g.clicks} click${g.clicks === 1 ? '' : 's'}` : undefined;
}
