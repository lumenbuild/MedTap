// Active ingredients: which medicines contain the same thing (e.g. Panadol and a cold-and-flu tablet both contain
// paracetamol), and the combined amount in 24 hours against the person's own limits. From the medicine's name (a list
// of common Australian brands) or what the person entered. Facts from labels, not advice: always "check with your
// pharmacist". Pure.
import type { Dose, Medication } from '../db/schema';

export interface Ingredient { name: string; mg?: number }
export type DrugClass = 'nsaid' | 'glp1';

const CLASS_OF: Record<string, DrugClass> = {
  ibuprofen: 'nsaid', naproxen: 'nsaid', diclofenac: 'nsaid', aspirin: 'nsaid', celecoxib: 'nsaid', meloxicam: 'nsaid', mefenamic: 'nsaid',
  semaglutide: 'glp1', tirzepatide: 'glp1', liraglutide: 'glp1', dulaglutide: 'glp1', exenatide: 'glp1',
};
export const CLASS_NAME: Record<DrugClass, string> = { nsaid: 'anti-inflammatories (NSAIDs)', glp1: 'GLP-1 medicines' };

/** Brand or generic words → ingredients (with the usual mg per tablet for combinations where it's fixed). Longer
 *  phrases are tried first ("panadeine forte" before "panadeine"). */
const KNOWN: [string, Ingredient[]][] = [
  ['panadeine forte', [{ name: 'paracetamol', mg: 500 }, { name: 'codeine', mg: 30 }]],
  ['panadeine', [{ name: 'paracetamol', mg: 500 }, { name: 'codeine', mg: 8 }]],
  ['mersyndol', [{ name: 'paracetamol', mg: 450 }, { name: 'codeine', mg: 9.75 }, { name: 'doxylamine', mg: 5 }]],
  ['nurofen plus', [{ name: 'ibuprofen', mg: 200 }, { name: 'codeine', mg: 12.8 }]],
  ['maxigesic', [{ name: 'paracetamol', mg: 500 }, { name: 'ibuprofen', mg: 150 }]],
  ['nuromol', [{ name: 'paracetamol', mg: 500 }, { name: 'ibuprofen', mg: 200 }]],
  ['cold and flu', [{ name: 'paracetamol' }]], ['cold & flu', [{ name: 'paracetamol' }]], ['codral', [{ name: 'paracetamol' }]], ['lemsip', [{ name: 'paracetamol' }]],
  ['panadol', [{ name: 'paracetamol' }]], ['panamax', [{ name: 'paracetamol' }]], ['tylenol', [{ name: 'paracetamol' }]], ['herron', [{ name: 'paracetamol' }]],
  ['osteomol', [{ name: 'paracetamol' }]], ['paracetamol', [{ name: 'paracetamol' }]], ['acetaminophen', [{ name: 'paracetamol' }]],
  ['nurofen', [{ name: 'ibuprofen' }]], ['advil', [{ name: 'ibuprofen' }]], ['brufen', [{ name: 'ibuprofen' }]], ['ibuprofen', [{ name: 'ibuprofen' }]],
  ['naprosyn', [{ name: 'naproxen' }]], ['naprogesic', [{ name: 'naproxen' }]], ['aleve', [{ name: 'naproxen' }]], ['naproxen', [{ name: 'naproxen' }]],
  ['voltaren', [{ name: 'diclofenac' }]], ['diclofenac', [{ name: 'diclofenac' }]], ['celebrex', [{ name: 'celecoxib' }]], ['celecoxib', [{ name: 'celecoxib' }]],
  ['mobic', [{ name: 'meloxicam' }]], ['meloxicam', [{ name: 'meloxicam' }]], ['ponstan', [{ name: 'mefenamic' }]],
  ['aspro', [{ name: 'aspirin' }]], ['disprin', [{ name: 'aspirin' }]], ['cartia', [{ name: 'aspirin' }]], ['astrix', [{ name: 'aspirin' }]], ['aspirin', [{ name: 'aspirin' }]],
  ['codeine', [{ name: 'codeine' }]],
  ['zyrtec', [{ name: 'cetirizine' }]], ['cetirizine', [{ name: 'cetirizine' }]], ['claratyne', [{ name: 'loratadine' }]], ['loratadine', [{ name: 'loratadine' }]],
  ['telfast', [{ name: 'fexofenadine' }]], ['fexofenadine', [{ name: 'fexofenadine' }]],
  ['ozempic', [{ name: 'semaglutide' }]], ['wegovy', [{ name: 'semaglutide' }]], ['rybelsus', [{ name: 'semaglutide' }]], ['semaglutide', [{ name: 'semaglutide' }]],
  ['mounjaro', [{ name: 'tirzepatide' }]], ['zepbound', [{ name: 'tirzepatide' }]], ['tirzepatide', [{ name: 'tirzepatide' }]],
  ['saxenda', [{ name: 'liraglutide' }]], ['victoza', [{ name: 'liraglutide' }]], ['liraglutide', [{ name: 'liraglutide' }]],
  ['trulicity', [{ name: 'dulaglutide' }]], ['dulaglutide', [{ name: 'dulaglutide' }]],
  ['vyvanse', [{ name: 'lisdexamfetamine' }]], ['lisdexamfetamine', [{ name: 'lisdexamfetamine' }]],
  ['dexamfetamine', [{ name: 'dexamfetamine' }]], ['dexamphetamine', [{ name: 'dexamfetamine' }]],
  ['ritalin', [{ name: 'methylphenidate' }]], ['concerta', [{ name: 'methylphenidate' }]], ['methylphenidate', [{ name: 'methylphenidate' }]],
  ['zoloft', [{ name: 'sertraline' }]], ['sertraline', [{ name: 'sertraline' }]], ['lexapro', [{ name: 'escitalopram' }]], ['escitalopram', [{ name: 'escitalopram' }]],
  ['metformin', [{ name: 'metformin' }]], ['diabex', [{ name: 'metformin' }]],
].sort((a, b) => b[0].length - a[0].length) as [string, Ingredient[]][];

const MASS = new Set(['mg', 'mcg', 'g']);
const toMg = (v: number, unit: string) => (unit === 'g' ? v * 1000 : unit === 'mcg' ? v / 1000 : v);

/** The medicine's ingredients: as entered, else from its name. A single ingredient takes the medicine's strength. */
export function ingredientsOf(med: Pick<Medication, 'name' | 'strength' | 'unit'> & { ingredients?: Ingredient[] }): Ingredient[] {
  if (med.ingredients?.length) return med.ingredients;
  const n = ` ${med.name.toLowerCase().replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hit = KNOWN.find(([k]) => n.includes(` ${k} `) || n.includes(` ${k}`));
  if (!hit) return [];
  const list = hit[1].map((i) => ({ ...i }));
  if (list.length === 1 && list[0].mg === undefined && med.strength > 0 && MASS.has(med.unit)) list[0].mg = toMg(med.strength, med.unit);
  return list;
}

export const parseIngredients = (text: string): Ingredient[] =>
  text.split(/[,;+\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*(mg|mcg|g)?$/i);
    return m && m[1] ? { name: m[1].toLowerCase(), mg: toMg(Number(m[2]), (m[3] ?? 'mg').toLowerCase()) } : { name: x.toLowerCase() };
  });
export const ingredientsText = (list: Ingredient[]) => list.map((i) => `${i.name}${i.mg !== undefined ? ` ${Math.round(i.mg * 100) / 100} mg` : ''}`).join(', ');

export interface Overlap { key: string; a: Medication; b: Medication; what: string; kind: 'same' | 'class' }

/** Pairs of active medicines (for the same person, or shared) with an ingredient or a class in common. */
export function overlaps(meds: Medication[], personOf: (m: Medication) => string): Overlap[] {
  const live = meds.filter((m) => !m.archived);
  const out: Overlap[] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (!a.shared && !b.shared && personOf(a) !== personOf(b)) continue;
    const ia = ingredientsOf(a).map((x) => x.name), ib = ingredientsOf(b).map((x) => x.name);
    const same = ia.filter((x) => ib.includes(x));
    const key = [a.id, b.id].sort().join('|');
    if (same.length) { out.push({ key, a, b, what: same.join(' and '), kind: 'same' }); continue; }
    const ca = ia.map((x) => CLASS_OF[x]).filter(Boolean), cb = ib.map((x) => CLASS_OF[x]).filter(Boolean);
    const cls = ca.find((c) => cb.includes(c));
    if (cls) out.push({ key, a, b, what: CLASS_NAME[cls], kind: 'class' });
  }
  return out;
}

export interface CombinedNote { ingredient: string; totalMg: number; limitMg: number; others: string[] }

/** Logging `amount` of `med` at `when`: the 24-hour total of each of its ingredients across every medicine containing
 *  it, against the lowest limit the person set on any of them (limit × mg per unit). Only where amounts are known. */
export function combinedTotals(med: Medication, amount: number, meds: Medication[], doses: Dose[], when: number, isMine: (d: Dose) => boolean): CombinedNote[] {
  const out: CombinedNote[] = [];
  for (const ing of ingredientsOf(med)) {
    if (ing.mg === undefined) continue;
    const holders = meds.map((m) => ({ m, per: ingredientsOf(m).find((x) => x.name === ing.name)?.mg })).filter((x) => x.per !== undefined) as { m: Medication; per: number }[];
    if (holders.length < 2) continue;
    // Doses are logged in the medicine's unit (e.g. 1000 mg of a 500 mg tablet = 2 tablets): tablets × mg per tablet.
    const mgOf = (m: Medication, per: number, amt: number) => (MASS.has(m.unit) && m.strength > 0 ? amt / m.strength : amt) * per;
    let total = mgOf(med, ing.mg, amount);
    const others = new Set<string>();
    for (const { m, per } of holders) {
      const ds = doses.filter((d) => d.medicationId === m.id && !d.deletedAt && !d.skipped && isMine(d) && Date.parse(d.takenAt) <= when && Date.parse(d.takenAt) > when - 86_400_000);
      if (!ds.length) continue;
      total += ds.reduce((n, d) => n + mgOf(m, per, d.amount), 0);
      if (m.id !== med.id) others.add(m.name);
    }
    const limits = holders.map(({ m, per }) => (m.schedule.maxAmountPer24h ? mgOf(m, per, m.schedule.maxAmountPer24h) : m.schedule.maxPer24h ? mgOf(m, per, m.schedule.maxPer24h * (m.defaultAmount || m.strength || 1)) : undefined)).filter((x): x is number => !!x);
    if (!others.size || !limits.length) continue;
    const limitMg = Math.min(...limits);
    if (total > limitMg + 1e-6) out.push({ ingredient: ing.name, totalMg: Math.round(total), limitMg: Math.round(limitMg), others: [...others] });
  }
  return out;
}
