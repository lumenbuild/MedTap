// Interaction flags: well-known pairs of medicines (and peptides), from product labels and standard Australian
// references, each in a few words.
// Also research peptides, whose interactions haven't been studied at all. Pure.
import type { Medication } from '../db/schema';
import { ingredientsOf } from './ingredients';

type Group =
  | 'serotonergic' | 'serotonin-other' | 'nsaid' | 'blood-thinner' | 'opioid' | 'sedative' | 'stimulant' | 'decongestant'
  | 'bp-raas' | 'diuretic' | 'potassium-keeping' | 'lithium' | 'pde5' | 'nitrate' | 'glp1' | 'low-sugar' | 'amylin'
  | 'diabetes' | 'gh-releaser' | 'tirzepatide' | 'pill' | 'bremelanotide' | 'naltrexone';

const GROUPS: Record<Group, string[]> = {
  serotonergic: ['sertraline', 'escitalopram', 'citalopram', 'fluoxetine', 'paroxetine', 'fluvoxamine', 'venlafaxine', 'desvenlafaxine', 'duloxetine'],
  'serotonin-other': ['tramadol', 'tapentadol', 'st johns wort', 'sumatriptan', 'rizatriptan', 'zolmitriptan', 'naratriptan', 'eletriptan'],
  nsaid: ['ibuprofen', 'naproxen', 'diclofenac', 'aspirin', 'celecoxib', 'meloxicam', 'mefenamic'],
  'blood-thinner': ['warfarin', 'apixaban', 'rivaroxaban', 'dabigatran', 'clopidogrel'],
  opioid: ['codeine', 'tramadol', 'tapentadol', 'oxycodone', 'morphine', 'hydromorphone', 'buprenorphine', 'fentanyl'],
  sedative: ['diazepam', 'temazepam', 'oxazepam', 'alprazolam', 'clonazepam', 'lorazepam', 'zolpidem', 'zopiclone', 'pregabalin', 'gabapentin', 'doxylamine'],
  stimulant: ['lisdexamfetamine', 'dexamfetamine', 'methylphenidate'],
  decongestant: ['pseudoephedrine', 'phenylephrine'],
  'bp-raas': ['ramipril', 'perindopril', 'enalapril', 'lisinopril', 'candesartan', 'irbesartan', 'telmisartan', 'losartan', 'valsartan', 'olmesartan'],
  diuretic: ['furosemide', 'hydrochlorothiazide', 'indapamide', 'chlorthalidone'],
  'potassium-keeping': ['spironolactone'],
  lithium: ['lithium'],
  pde5: ['sildenafil', 'tadalafil', 'vardenafil'],
  nitrate: ['glyceryl trinitrate', 'isosorbide'],
  glp1: ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide', 'exenatide', 'retatrutide', 'survodutide', 'mazdutide'],
  'low-sugar': ['insulin', 'gliclazide', 'glimepiride', 'glibenclamide', 'glipizide'],
  amylin: ['cagrilintide', 'pramlintide'],
  diabetes: ['insulin', 'gliclazide', 'glimepiride', 'glibenclamide', 'glipizide', 'metformin', 'empagliflozin', 'dapagliflozin'],
  'gh-releaser': ['ipamorelin', 'cjc-1295', 'sermorelin', 'tesamorelin', 'hexarelin', 'ghrp', 'ibutamoren'],
  tirzepatide: ['tirzepatide'],
  pill: ['oral contraceptive', 'levonorgestrel', 'ethinylestradiol', 'norethisterone', 'drospirenone', 'desogestrel', 'gestodene', 'cyproterone', 'nomegestrol', 'dienogest'],
  bremelanotide: ['bremelanotide'],
  naltrexone: ['naltrexone'],
};

/** Research peptides: no studies of how they mix with medicines, so no pair can be ruled in or out. */
export const RESEARCH_PEPTIDES = ['bpc-157', 'tb-500', 'ghk-cu', 'aod-9604', 'melanotan', 'epitalon', 'dsip', 'selank', 'semax', 'kpv', 'mots-c',
  'ipamorelin', 'cjc-1295', 'hexarelin', 'ghrp', 'ibutamoren', 'retatrutide', 'cagrilintide', 'survodutide', 'mazdutide'];

interface Rule { key: string; a: Group; b: Group; why: string }

// Wording is shared by both apps (TapDose shows no peptide wording: these name the medicine, never the word).
const RULES: Rule[] = [
  { key: 'serotonin', a: 'serotonergic', b: 'serotonin-other', why: 'Together: rare serotonin toxicity' },
  { key: 'bleed-ssri', a: 'serotonergic', b: 'nsaid', why: 'Together: more bleeding risk' },
  { key: 'bleed-ssri-thinner', a: 'serotonergic', b: 'blood-thinner', why: 'Together: more bleeding risk' },
  { key: 'bleed-thinner', a: 'blood-thinner', b: 'nsaid', why: 'Together: more bleeding risk' },
  { key: 'breathing', a: 'opioid', b: 'sedative', why: 'Together: more drowsy, slower breathing' },
  { key: 'stim-decongestant', a: 'stimulant', b: 'decongestant', why: 'Both raise blood pressure and heart rate' },
  { key: 'kidney', a: 'bp-raas', b: 'nsaid', why: 'Can weaken the BP medicine and strain kidneys' },
  { key: 'potassium', a: 'bp-raas', b: 'potassium-keeping', why: 'Together: higher potassium' },
  { key: 'lithium-nsaid', a: 'lithium', b: 'nsaid', why: 'Can raise lithium levels' },
  { key: 'lithium-raas', a: 'lithium', b: 'bp-raas', why: 'Can raise lithium levels' },
  { key: 'lithium-diuretic', a: 'lithium', b: 'diuretic', why: 'Can raise lithium levels' },
  { key: 'nitrate', a: 'pde5', b: 'nitrate', why: 'Labels say not together: big BP drop' },
  { key: 'low-sugar', a: 'glp1', b: 'low-sugar', why: 'Together: blood sugar can go too low' },
  { key: 'amylin-insulin', a: 'amylin', b: 'low-sugar', why: 'Together: blood sugar can go too low' },
  { key: 'gh-sugar', a: 'gh-releaser', b: 'diabetes', why: 'Can raise blood sugar' },
  { key: 'pill', a: 'tirzepatide', b: 'pill', why: 'Pill less reliable for 4 weeks after each step up' },
  { key: 'naltrexone', a: 'bremelanotide', b: 'naltrexone', why: 'Less naltrexone absorbed: label says avoid' },
];

const groupsOf = (m: Medication) => {
  const names = ingredientsOf(m).map((i) => i.name);
  return new Set((Object.keys(GROUPS) as Group[]).filter((g) => GROUPS[g].some((n) => names.includes(n))));
};

export interface Interaction { key: string; a: Medication; b: Medication; why: string }

/** Pairs of active medicines (for the same person, or shared) on the list above. One flag per pair. */
export function interactions(meds: Medication[], personOf: (m: Medication) => string): Interaction[] {
  const live = meds.filter((m) => !m.archived).map((m) => ({ m, g: groupsOf(m) }));
  const out: Interaction[] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (!A.m.shared && !B.m.shared && personOf(A.m) !== personOf(B.m)) continue;
    const rule = RULES.find((r) => (A.g.has(r.a) && B.g.has(r.b)) || (A.g.has(r.b) && B.g.has(r.a)));
    if (rule) out.push({ key: `ix:${rule.key}:${[A.m.id, B.m.id].sort().join('|')}`, a: A.m, b: B.m, why: rule.why });
  }
  return out;
}

/** A peptide (or research compound) whose interactions haven't been studied: from its name, or set up as a peptide
 *  with no known ingredient. */
export function unstudied(m: Medication): boolean {
  const names = ingredientsOf(m).map((i) => i.name);
  if (names.some((n) => RESEARCH_PEPTIDES.includes(n))) return true;
  return !!m.peptide && !names.length;
}
