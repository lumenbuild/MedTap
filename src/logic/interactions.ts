// Interaction flags: well-known pairs of medicines (and peptides), from product labels and standard Australian
// references, each in a few words.
// Also research peptides, whose interactions haven't been studied at all. Pure.
import type { Medication } from '../db/schema';
import { ingredientsOf } from './ingredients';

type Group =
  | 'serotonergic' | 'serotonin-other' | 'nsaid' | 'blood-thinner' | 'opioid' | 'sedative' | 'stimulant' | 'decongestant'
  | 'bp-raas' | 'diuretic' | 'potassium-keeping' | 'lithium' | 'pde5' | 'nitrate' | 'glp1' | 'low-sugar' | 'amylin'
  | 'diabetes' | 'gh-releaser' | 'tirzepatide' | 'pill' | 'bremelanotide' | 'naltrexone' | 'maoi'
  | 'melanocortin' | 'sugar-peptide' | 'stim-peptide' | 'calm-peptide'
  // The medicine guide's groups.
  | 'alpha2' | 'bp-lower' | 'slow-heart' | 'beta-blocker' | 'alpha-blocker' | '3a4-inhibitor' | '3a4-inducer' | '3a4-sensitive' | 'qt'
  | '2d6-inhibitor' | '2d6-sensitive' | 'opioid-prodrug' | 'amphetamine' | 'anorectic' | 'bupropion' | 'seizure-lowering' | 'warfarin'
  | 'warfarin-raiser' | 'clopidogrel' | 'ppi-2c19' | 'trimethoprim' | 'methotrexate' | 'valproate' | 'lamotrigine' | 'isotretinoin'
  | 'tetracycline' | 'levothyroxine' | 'enzyme-pill' | 'guanfacine' | 'sglt2';

const GROUPS: Record<Group, string[]> = {
  serotonergic: ['sertraline', 'escitalopram', 'citalopram', 'fluoxetine', 'paroxetine', 'fluvoxamine', 'venlafaxine', 'desvenlafaxine', 'duloxetine', 'vortioxetine'],
  'serotonin-other': ['tramadol', 'tapentadol', 'st johns wort', 'sumatriptan', 'rizatriptan', 'zolmitriptan', 'naratriptan', 'eletriptan', 'lithium', 'methadone', 'linezolid'],
  nsaid: ['ibuprofen', 'naproxen', 'diclofenac', 'aspirin', 'celecoxib', 'meloxicam', 'mefenamic'],
  'blood-thinner': ['warfarin', 'apixaban', 'rivaroxaban', 'dabigatran', 'clopidogrel'],
  opioid: ['codeine', 'tramadol', 'tapentadol', 'oxycodone', 'morphine', 'hydromorphone', 'buprenorphine', 'fentanyl', 'methadone'],
  sedative: ['diazepam', 'temazepam', 'oxazepam', 'alprazolam', 'clonazepam', 'lorazepam', 'zolpidem', 'zopiclone', 'pregabalin', 'gabapentin', 'doxylamine',
    'quetiapine', 'olanzapine', 'mirtazapine', 'amitriptyline', 'nortriptyline', 'promethazine', 'diphenhydramine', 'daridorexant', 'lemborexant', 'suvorexant', 'baclofen'],
  stimulant: ['lisdexamfetamine', 'dexamfetamine', 'methylphenidate', 'amphetamine'],
  decongestant: ['pseudoephedrine', 'phenylephrine'],
  'bp-raas': ['ramipril', 'perindopril', 'enalapril', 'lisinopril', 'candesartan', 'irbesartan', 'telmisartan', 'losartan', 'valsartan', 'olmesartan'],
  diuretic: ['furosemide', 'hydrochlorothiazide', 'indapamide', 'chlorthalidone'],
  'potassium-keeping': ['spironolactone'],
  lithium: ['lithium'],
  pde5: ['sildenafil', 'tadalafil', 'vardenafil', 'avanafil'],
  nitrate: ['glyceryl trinitrate', 'isosorbide'],
  glp1: ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide', 'exenatide', 'retatrutide', 'survodutide', 'mazdutide'],
  'low-sugar': ['insulin', 'gliclazide', 'glimepiride', 'glibenclamide', 'glipizide'],
  amylin: ['cagrilintide', 'pramlintide'],
  diabetes: ['insulin', 'gliclazide', 'glimepiride', 'glibenclamide', 'glipizide', 'metformin', 'empagliflozin', 'dapagliflozin', 'sitagliptin', 'linagliptin'],
  'gh-releaser': ['ipamorelin', 'cjc-1295', 'sermorelin', 'tesamorelin', 'hexarelin', 'ghrp', 'ibutamoren'],
  tirzepatide: ['tirzepatide'],
  pill: ['oral contraceptive', 'levonorgestrel', 'ethinylestradiol', 'norethisterone', 'drospirenone', 'desogestrel', 'gestodene', 'cyproterone', 'nomegestrol', 'dienogest'],
  bremelanotide: ['bremelanotide'],
  naltrexone: ['naltrexone'],
  maoi: ['phenelzine', 'tranylcypromine', 'moclobemide', 'selegiline', 'rasagiline'],
  melanocortin: ['bremelanotide', 'melanotan'],
  'sugar-peptide': ['mots-c'],
  'stim-peptide': ['semax'],
  'calm-peptide': ['selank', 'dsip'],
  alpha2: ['guanfacine', 'clonidine'],
  guanfacine: ['guanfacine'],
  'bp-lower': ['ramipril', 'perindopril', 'enalapril', 'lisinopril', 'candesartan', 'irbesartan', 'telmisartan', 'losartan', 'valsartan', 'olmesartan',
    'amlodipine', 'felodipine', 'lercanidipine', 'nifedipine', 'verapamil', 'diltiazem', 'metoprolol', 'atenolol', 'bisoprolol', 'nebivolol', 'carvedilol',
    'propranolol', 'hydrochlorothiazide', 'indapamide', 'chlorthalidone', 'furosemide', 'spironolactone', 'prazosin', 'doxazosin', 'minoxidil'],
  'slow-heart': ['metoprolol', 'atenolol', 'bisoprolol', 'nebivolol', 'carvedilol', 'propranolol', 'sotalol', 'verapamil', 'diltiazem', 'digoxin', 'ivabradine'],
  'beta-blocker': ['metoprolol', 'atenolol', 'bisoprolol', 'nebivolol', 'carvedilol', 'propranolol', 'sotalol'],
  'alpha-blocker': ['prazosin', 'doxazosin', 'tamsulosin'],
  '3a4-inhibitor': ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole', 'ritonavir', 'fluconazole', 'verapamil', 'diltiazem'],
  '3a4-inducer': ['rifampicin', 'carbamazepine', 'phenytoin', 'st johns wort'],
  '3a4-sensitive': ['guanfacine', 'simvastatin', 'atorvastatin', 'quetiapine', 'lurasidone', 'colchicine', 'alprazolam', 'oxycodone', 'sildenafil', 'tadalafil',
    'daridorexant', 'lemborexant', 'suvorexant', 'domperidone', 'apixaban', 'rivaroxaban', 'buspirone'],
  qt: ['citalopram', 'escitalopram', 'ondansetron', 'domperidone', 'azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin', 'ciprofloxacin', 'levofloxacin',
    'moxifloxacin', 'quetiapine', 'haloperidol', 'methadone', 'amitriptyline', 'nortriptyline', 'fluconazole', 'hydroxychloroquine', 'sotalol'],
  '2d6-inhibitor': ['fluoxetine', 'paroxetine', 'bupropion'],
  '2d6-sensitive': ['atomoxetine', 'metoprolol', 'aripiprazole', 'vortioxetine', 'amitriptyline', 'nortriptyline', 'codeine', 'tramadol'],
  'opioid-prodrug': ['codeine', 'tramadol'],
  amphetamine: ['lisdexamfetamine', 'dexamfetamine', 'amphetamine'],
  anorectic: ['phentermine'],
  bupropion: ['bupropion'],
  'seizure-lowering': ['tramadol'],
  warfarin: ['warfarin'],
  'warfarin-raiser': ['clarithromycin', 'erythromycin', 'ciprofloxacin', 'metronidazole', 'fluconazole', 'trimethoprim', 'amoxicillin clavulanate'],
  clopidogrel: ['clopidogrel'],
  'ppi-2c19': ['omeprazole', 'esomeprazole'],
  trimethoprim: ['trimethoprim'],
  methotrexate: ['methotrexate'],
  valproate: ['valproate'],
  lamotrigine: ['lamotrigine'],
  isotretinoin: ['isotretinoin'],
  tetracycline: ['doxycycline', 'minocycline'],
  levothyroxine: ['levothyroxine'],
  'enzyme-pill': ['rifampicin', 'carbamazepine', 'phenytoin', 'st johns wort', 'modafinil', 'armodafinil', 'topiramate'],
  sglt2: ['empagliflozin', 'dapagliflozin'],
};

/** Research peptides: no studies of how they mix with medicines, so no pair can be ruled in or out. */
export const RESEARCH_PEPTIDES = ['bpc-157', 'tb-500', 'ghk-cu', 'aod-9604', 'melanotan', 'epitalon', 'dsip', 'selank', 'semax', 'kpv', 'mots-c',
  'ipamorelin', 'cjc-1295', 'hexarelin', 'ghrp', 'ibutamoren', 'retatrutide', 'cagrilintide', 'survodutide', 'mazdutide',
  'thymosin alpha-1', 'ss-31'];

/** avoid: labels say not together. caution: worth knowing, and asking a pharmacist about. info: often prescribed
 *  together; good to know what each does to the other. */
export type Level = 'avoid' | 'caution' | 'info';
interface Rule { key: string; a: Group; b: Group; why: string; level?: Level }

// Wording is shared by both apps (TapDose shows no peptide wording: these name the medicine, never the word).
// More specific rules first: one flag per pair, the first that fits.
const RULES: Rule[] = [
  { key: 'maoi-stim', a: 'maoi', b: 'stimulant', why: 'Labels say not together, or within 14 days: dangerous blood pressure rise', level: 'avoid' },
  { key: 'maoi-sero', a: 'maoi', b: 'serotonergic', why: 'Labels say not together: serotonin toxicity', level: 'avoid' },
  { key: 'maoi-anorectic', a: 'maoi', b: 'anorectic', why: 'Labels say not together, or within 14 days: dangerous blood pressure rise', level: 'avoid' },
  { key: 'maoi-bupropion', a: 'maoi', b: 'bupropion', why: 'Labels say not together, or within 14 days', level: 'avoid' },
  { key: 'maoi-decongestant', a: 'maoi', b: 'decongestant', why: 'Labels say not together: dangerous blood pressure rise', level: 'avoid' },
  { key: 'nitrate', a: 'pde5', b: 'nitrate', why: 'Labels say not together: big BP drop', level: 'avoid' },
  { key: 'isotretinoin-tetra', a: 'isotretinoin', b: 'tetracycline', why: 'Labels say not together: raised pressure around the brain', level: 'avoid' },
  { key: 'methotrexate-tmp', a: 'methotrexate', b: 'trimethoprim', why: 'Together can dangerously lower blood counts: labels say avoid', level: 'avoid' },
  { key: 'clopidogrel-ppi', a: 'clopidogrel', b: 'ppi-2c19', why: 'Omeprazole and esomeprazole weaken clopidogrel (pantoprazole does much less)' },
  { key: 'guanfacine-inhibitor', a: 'guanfacine', b: '3a4-inhibitor', why: 'Raises guanfacine levels a lot: more sleepiness, low BP and slow heart. The label covers the dose; a question for your prescriber' },
  { key: 'guanfacine-inducer', a: 'guanfacine', b: '3a4-inducer', why: 'Lowers guanfacine levels, so it may work less. The label covers the dose; a question for your prescriber' },
  { key: 'guanfacine-valproate', a: 'guanfacine', b: 'valproate', why: 'Guanfacine can raise valproate levels: more drowsiness' },
  { key: 'alpha2-stim', a: 'alpha2', b: 'stimulant', why: 'Often prescribed together. The stimulant raises heart rate and BP, guanfacine or clonidine lowers them; changes to either shift the balance', level: 'info' },
  { key: 'alpha2-slow', a: 'alpha2', b: 'slow-heart', why: 'Both slow the heart: slower pulse, more dizziness or fainting' },
  { key: 'alpha2-bp', a: 'alpha2', b: 'bp-lower', why: 'Both lower blood pressure: more dizziness on standing' },
  { key: 'alpha2-sedative', a: 'alpha2', b: 'sedative', why: 'Together: more drowsy, and lower blood pressure' },
  { key: 'alpha2-opioid', a: 'alpha2', b: 'opioid', why: 'Together: more drowsy, and lower blood pressure' },
  { key: 'pde5-alpha', a: 'pde5', b: 'alpha-blocker', why: 'Together: a bigger blood pressure drop on standing' },
  { key: 'serotonin', a: 'serotonergic', b: 'serotonin-other', why: 'Together: rare serotonin toxicity' },
  { key: 'amph-sero', a: 'amphetamine', b: 'serotonergic', why: 'Often prescribed together; the label lists a rare serotonin toxicity', level: 'info' },
  { key: 'bupropion-tramadol', a: 'bupropion', b: 'seizure-lowering', why: 'Both lower the seizure threshold' },
  { key: 'opioid-2d6', a: 'opioid-prodrug', b: '2d6-inhibitor', why: 'Weakens codeine and tramadol: the body converts less to the form that relieves pain' },
  { key: '2d6', a: '2d6-inhibitor', b: '2d6-sensitive', why: 'Raises its levels: more of its side effects' },
  { key: '3a4-in', a: '3a4-inhibitor', b: '3a4-sensitive', why: 'Raises its levels: more of its side effects' },
  { key: '3a4-ind', a: '3a4-inducer', b: '3a4-sensitive', why: 'Lowers its levels: it may work less well' },
  { key: 'enzyme-pill', a: 'enzyme-pill', b: 'pill', why: 'The pill can be less reliable, during and for about a month after' },
  { key: 'qt', a: 'qt', b: 'qt', why: 'Both can lengthen the QT interval (heart rhythm); an ECG is sometimes used to check' },
  { key: 'warfarin-raiser', a: 'warfarin', b: 'warfarin-raiser', why: 'Can raise warfarin’s effect (INR): more bleeding risk' },
  { key: 'bleed-ssri', a: 'serotonergic', b: 'nsaid', why: 'Together: more bleeding risk' },
  { key: 'bleed-ssri-thinner', a: 'serotonergic', b: 'blood-thinner', why: 'Together: more bleeding risk' },
  { key: 'bleed-thinner', a: 'blood-thinner', b: 'nsaid', why: 'Together: more bleeding risk' },
  { key: 'breathing', a: 'opioid', b: 'sedative', why: 'Together: more drowsy, slower breathing' },
  { key: 'stim-decongestant', a: 'stimulant', b: 'decongestant', why: 'Both raise blood pressure and heart rate' },
  { key: 'stim-anorectic', a: 'stimulant', b: 'anorectic', why: 'Both raise heart rate and blood pressure, and cut appetite and sleep' },
  { key: 'stim-bupropion', a: 'stimulant', b: 'bupropion', why: 'Both raise blood pressure; bupropion also lowers the seizure threshold', level: 'info' },
  { key: 'kidney', a: 'bp-raas', b: 'nsaid', why: 'Can weaken the BP medicine and strain kidneys' },
  { key: 'kidney-diuretic', a: 'diuretic', b: 'nsaid', why: 'Can weaken the diuretic and strain kidneys' },
  { key: 'potassium', a: 'bp-raas', b: 'potassium-keeping', why: 'Together: higher potassium' },
  { key: 'potassium-tmp', a: 'trimethoprim', b: 'bp-raas', why: 'Together: higher potassium' },
  { key: 'potassium-tmp-spiro', a: 'trimethoprim', b: 'potassium-keeping', why: 'Together: higher potassium' },
  { key: 'lithium-nsaid', a: 'lithium', b: 'nsaid', why: 'Can raise lithium levels' },
  { key: 'lithium-raas', a: 'lithium', b: 'bp-raas', why: 'Can raise lithium levels' },
  { key: 'lithium-diuretic', a: 'lithium', b: 'diuretic', why: 'Can raise lithium levels' },
  { key: 'valproate-lamotrigine', a: 'valproate', b: 'lamotrigine', why: 'Valproate about doubles lamotrigine levels: rash risk' },
  { key: 'lamotrigine-pill', a: 'lamotrigine', b: 'pill', why: 'The pill lowers lamotrigine levels (and they rise in the pill-free week)' },
  { key: 'low-sugar', a: 'glp1', b: 'low-sugar', why: 'Together: blood sugar can go too low' },
  { key: 'hypo-beta', a: 'low-sugar', b: 'beta-blocker', why: 'Beta blockers can hide the shaky, racing-heart signs of low blood sugar' },
  { key: 'amylin-insulin', a: 'amylin', b: 'low-sugar', why: 'Together: blood sugar can go too low' },
  { key: 'sglt2-glp1', a: 'sglt2', b: 'glp1', why: 'Eating very little on both raises the (rare) risk of ketoacidosis: ask about sick-day rules', level: 'info' },
  { key: 'gh-sugar', a: 'gh-releaser', b: 'diabetes', why: 'Can raise blood sugar' },
  { key: 'pill', a: 'tirzepatide', b: 'pill', why: 'Pill less reliable for 4 weeks after starting and after each step up' },
  { key: 'naltrexone', a: 'bremelanotide', b: 'naltrexone', why: 'Less naltrexone absorbed: label says avoid' },
  { key: 'naltrexone-opioid', a: 'naltrexone', b: 'opioid', why: 'Naltrexone blocks opioids: the pain relief won’t work, and it can bring on withdrawal', level: 'avoid' },
  { key: 'glp1-glp1', a: 'glp1', b: 'glp1', why: 'Two GLP-1 medicines: not usually combined' },
  { key: 'gh-glp1', a: 'gh-releaser', b: 'glp1', why: 'Growth hormone raises blood sugar: worth watching glucose' },
  { key: 'melanocortin', a: 'melanocortin', b: 'melanocortin', why: 'Both act on the same receptors: more nausea and blood pressure rise' },
  { key: 'sugar-peptide', a: 'sugar-peptide', b: 'low-sugar', why: 'Can lower blood sugar further' },
  { key: 'stim-peptide', a: 'stim-peptide', b: 'stimulant', why: 'Both stimulating: more anxiety, faster heart, worse sleep' },
  { key: 'calm-peptide', a: 'calm-peptide', b: 'sedative', why: 'Together: more drowsy' },
];

const groupsOf = (m: Medication) => {
  const names = ingredientsOf(m).map((i) => i.name);
  return new Set((Object.keys(GROUPS) as Group[]).filter((g) => GROUPS[g].some((n) => names.includes(n))));
};

/** Whether a medicine belongs to a group (e.g. a GLP-1, a stimulant), from its ingredients. */
export const inGroup = (m: Medication, g: Group) => groupsOf(m).has(g);

export interface Interaction { key: string; a: Medication; b: Medication; why: string; level: Level }

/** Pairs of active medicines (for the same person, or shared) on the list above. One flag per pair. */
export function interactions(meds: Medication[], personOf: (m: Medication) => string): Interaction[] {
  const live = meds.filter((m) => !m.archived).map((m) => ({ m, g: groupsOf(m) }));
  const out: Interaction[] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (!A.m.shared && !B.m.shared && personOf(A.m) !== personOf(B.m)) continue;
    // A rule within one group (two QT medicines) needs each to be in it; a rule between two needs one in each.
    const rule = RULES.find((r) => (A.g.has(r.a) && B.g.has(r.b)) || (A.g.has(r.b) && B.g.has(r.a)));
    // The 2D6/3A4 rules name what changes: put the affected medicine second.
    if (rule) out.push({ key: `ix:${rule.key}:${[A.m.id, B.m.id].sort().join('|')}`, a: A.m, b: B.m, why: rule.why, level: rule.level ?? 'caution' });
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
