// Supplements: what each one is (matched from the name or the ingredients entered), when it's best taken, what to keep
// apart or avoid with the person's other medicines and supplements, daily totals against the upper limits, and notes for
// a coming blood test. Facts from product information and nutrient reference values (Australia/NZ), stated plainly.
// Pure.
import type { Appointment, Dose, Medication } from '../db/schema';
import { ingredientsOf } from './ingredients';
import { inGroup } from './interactions';
import { guideFor, isGlpLike } from './peptideGuide';
import { plannedAmounts, type ScheduleSettings } from './schedule';

export interface Supplement {
  key: string; name: string; re: RegExp;
  /** When it's best taken, in a few words. */
  timing?: string;
  /** Upper limit a day (adults), in `per` units, with what it's measured as. */
  ul?: { amount: number; per: 'mg' | 'mcg'; what?: string };
}

export const SUPPLEMENTS: Supplement[] = [
  { key: 'magnesium', name: 'Magnesium', re: /(?<!(?:prazole|statin) )magnesium|\bmag\b/i, timing: 'Evening suits most people (it can help sleep); glycinate is gentler on the stomach.', ul: { amount: 350, per: 'mg', what: 'from supplements' } },
  { key: 'zinc', name: 'Zinc', re: /\bzinc\b/i, timing: 'With food if it upsets your stomach; apart from iron and calcium.', ul: { amount: 40, per: 'mg' } },
  { key: 'copper', name: 'Copper', re: /\bcopper\b(?! peptide)/i, ul: { amount: 10, per: 'mg' } },
  { key: 'iron', name: 'Iron', re: /\biron\b|ferrous|ferro|maltofer|ferrograd/i, timing: 'On an empty stomach with vitamin C or juice if you can; not with coffee, tea, calcium or antacids.', ul: { amount: 45, per: 'mg' } },
  { key: 'calcium', name: 'Calcium', re: /(?<!(?:statin|folinate|montelukast) )\bcalcium\b|caltrate/i, timing: 'With food, in doses of 500 mg or less.', ul: { amount: 2500, per: 'mg' } },
  { key: 'vitamin-d', name: 'Vitamin D', re: /vitamin\s*d\b|\bvit\s*d\b|d3\b|cholecalciferol|ostelin/i, timing: 'With a meal that has some fat.', ul: { amount: 80, per: 'mcg', what: '3,200 IU' } },
  { key: 'vitamin-c', name: 'Vitamin C', re: /vitamin\s*c\b|\bvit\s*c\b|ascorbic/i, ul: { amount: 2000, per: 'mg' } },
  { key: 'vitamin-b6', name: 'Vitamin B6', re: /\bb6\b|pyridoxine/i, ul: { amount: 50, per: 'mg' } },
  { key: 'vitamin-b12', name: 'Vitamin B12', re: /\bb12\b|cobalamin|cyanocobalamin/i },
  { key: 'b-complex', name: 'B complex', re: /b\s*complex|b-group|multivitamin|multi\b/i },
  { key: 'biotin', name: 'Biotin', re: /biotin|hair skin nails/i },
  { key: 'niacin', name: 'Niacin', re: /niacin|nicotinic acid/i, timing: 'With food; flushing is common with plain niacin.', ul: { amount: 35, per: 'mg', what: 'as nicotinic acid' } },
  { key: 'selenium', name: 'Selenium', re: /selenium/i, ul: { amount: 400, per: 'mcg' } },
  { key: 'vitamin-a', name: 'Vitamin A', re: /vitamin\s*a\b|retinol|retinyl/i, ul: { amount: 3000, per: 'mcg', what: 'as retinol' } },
  { key: 'fish-oil', name: 'Fish oil', re: /fish oil|\bomega[- ]?3\b|krill|\bepa\b|\bdha\b/i, timing: 'With a meal (less fishy burping).' },
  { key: 'creatine', name: 'Creatine', re: /creatine/i, timing: 'Any time of day; it works by being taken daily.' },
  { key: 'melatonin', name: 'Melatonin', re: /melatonin|circadin/i, timing: '30–60 minutes before bed; low doses (0.5–2 mg) often work as well as higher ones.' },
  { key: 'fibre', name: 'Fibre', re: /psyllium|metamucil|fib(re|er)|inulin|benefiber/i, timing: 'With a big glass of water, 2 hours apart from tablets and capsules.' },
  { key: 'st-johns-wort', name: "St John's wort", re: /st\.?\s*john|hypericum/i },
  { key: 'ashwagandha', name: 'Ashwagandha', re: /ashwagandha|withania|ksm-?66/i, timing: 'Evening suits most people.' },
  { key: 'theanine', name: 'L-theanine', re: /theanine/i, timing: 'With caffeine or a stimulant, to take the edge off.' },
  { key: 'tyrosine', name: 'L-tyrosine', re: /tyrosine/i, timing: 'Morning, on an empty stomach.' },
  { key: 'nac', name: 'NAC', re: /\bnac\b|n-acetyl ?cysteine|acetylcysteine/i },
  { key: '5-htp', name: '5-HTP', re: /5-?htp|hydroxytryptophan/i },
  { key: 'berberine', name: 'Berberine', re: /berberine/i, timing: 'With meals.' },
  { key: 'ginkgo', name: 'Ginkgo', re: /ginkgo/i },
  { key: 'turmeric', name: 'Turmeric', re: /turmeric|curcumin/i, timing: 'With a meal that has some fat.' },
  { key: 'caffeine', name: 'Caffeine pills or pre-workout', re: /caffeine|pre-?workout|no-?doz/i },
  { key: 'electrolytes', name: 'Electrolytes', re: /electrolyte|hydralyte|\blmnt\b|sodium chloride|salt tablet/i },
  { key: 'antacid', name: 'Antacid', re: /antacid|gaviscon|mylanta|quick-eze|rennie|bicarbonate/i },
  { key: 'nr-nmn', name: 'NR or NMN', re: /\bnmn\b|nicotinamide (riboside|mononucleotide)|\bnr\b|tru niagen/i },
  { key: 'collagen', name: 'Collagen', re: /collagen/i },
  { key: 'probiotic', name: 'Probiotic', re: /probiotic|lactobacillus|bifido|inner health/i },
];

/** The supplements a medication is, from its name and the ingredients entered. */
export function supplementsOf(med: Pick<Medication, 'name' | 'ingredients'>): Supplement[] {
  const text = [med.name, ...(med.ingredients ?? []).map((i) => i.name)].join(' ');
  return SUPPLEMENTS.filter((s) => s.re.test(text));
}

export type RuleKind = 'avoid' | 'apart' | 'pair' | 'lab';
export interface SupplementRule { id: string; kind: RuleKind; text: string; meds: string[] }

const STIMULANT = (m: Medication) => inGroup(m, 'stimulant');
const AMPHETAMINE = (m: Medication) => /vyvanse|elvanse|lisdex|dexam|dexamph|adderall|amphetamine/i.test([m.name, ...(m.ingredients ?? []).map((i) => i.name)].join(' '));
const SEROTONIN = (m: Medication) => inGroup(m, 'serotonergic') || inGroup(m, 'serotonin-other');
const THINNER = (m: Medication) => inGroup(m, 'blood-thinner') || inGroup(m, 'nsaid');
const SEDATIVE = (m: Medication) => inGroup(m, 'sedative') || inGroup(m, 'opioid');
const SUGAR = (m: Medication) => inGroup(m, 'low-sugar') || inGroup(m, 'diabetes') || inGroup(m, 'glp1');
const PILL = (m: Medication) => inGroup(m, 'pill');
const has = (m: Medication, key: string) => supplementsOf(m).some((s) => s.key === key);
const TABLET = (m: Medication) => !m.peptide && m.form !== 'injection' && m.form !== 'patch';

/** Every rule that applies to these medicines and supplements together: things to avoid together, keep apart, pair,
 *  or know before a blood test. `bloodTestSoon`: an appointment in the next 7 days (labs often follow). */
export function supplementRules(meds: Medication[], opts: { bloodTestSoon?: boolean } = {}): SupplementRule[] {
  const live = meds.filter((m) => !m.archived);
  const name = (m: Medication) => m.nickname || m.name;
  const any = (f: (m: Medication) => boolean) => live.filter(f);
  const out: SupplementRule[] = [];
  const rule = (id: string, kind: RuleKind, a: Medication[], b: Medication[], text: (an: string, bn: string) => string) => {
    if (!a.length || !b.length) return;
    const an = a.map(name).join(', '), bn = b.map(name).join(', ');
    out.push({ id: `${id}:${[...a, ...b].map((m) => m.id).sort().join('|')}`, kind, text: text(an, bn), meds: [...a, ...b].map((m) => m.id) });
  };
  const sup = (key: string) => any((m) => has(m, key));

  // Avoid together.
  rule('sjw-serotonin', 'avoid', sup('st-johns-wort'), any((m) => SEROTONIN(m) && !has(m, 'st-johns-wort')), (a, b) => `${a} with ${b}: both raise serotonin (a rare but serious reaction)`);
  rule('sjw-amph', 'avoid', sup('st-johns-wort'), any(AMPHETAMINE), (a, b) => `${a} with ${b}: adds to serotonin, and St John's wort lowers the levels of many medicines`);
  rule('sjw-pill', 'avoid', sup('st-johns-wort'), any(PILL), (a, b) => `${a} makes ${b} less reliable as contraception`);
  rule('5htp-serotonin', 'avoid', sup('5-htp'), any(SEROTONIN), (a, b) => `${a} with ${b}: both raise serotonin`);
  rule('caffeine-stim', 'avoid', sup('caffeine'), any(STIMULANT), (a, b) => `${a} on top of ${b}: the effects add up (heart rate, anxiety, sleep)`);
  rule('fish-thinner', 'avoid', sup('fish-oil'), any(THINNER), (a, b) => `${a} at high doses (over 3 g a day) with ${b}: more bleeding risk`);
  rule('ginkgo-thinner', 'avoid', sup('ginkgo'), any(THINNER), (a, b) => `${a} with ${b}: more bleeding risk`);
  rule('turmeric-thinner', 'avoid', sup('turmeric'), any((m) => inGroup(m, 'blood-thinner')), (a, b) => `${a} in supplement doses with ${b}: may add to bleeding risk`);
  rule('ash-sedative', 'avoid', sup('ashwagandha'), any(SEDATIVE), (a, b) => `${a} with ${b}: more drowsy`);
  rule('mel-sedative', 'avoid', sup('melatonin'), any(SEDATIVE), (a, b) => `${a} with ${b}: more drowsy, especially the next morning`);
  rule('berb-sugar', 'avoid', sup('berberine'), any(SUGAR), (a, b) => `${a} with ${b}: both lower blood sugar, and berberine changes how some medicines are broken down`);
  rule('nr-nad', 'pair', sup('nr-nmn'), any((m) => guideFor(m.name)?.id === 'nad'), (a, b) => `${a} with ${b}: both raise NAD+; most people use one or the other`);
  rule('niacin-nad', 'apart', sup('niacin'), any((m) => guideFor(m.name)?.id === 'nad'), (a, b) => `${a} and ${b} both cause flushing: not on the same day at first`);

  // Keep apart.
  rule('vitc-amph', 'apart', any((m) => has(m, 'vitamin-c')), any(AMPHETAMINE), (a, b) => `${a} (and fruit juice) lowers how much of ${b} is absorbed: keep them at least an hour apart`);
  rule('antacid-amph', 'apart', sup('antacid'), any(AMPHETAMINE), (a, b) => `${a} increases how much of ${b} is absorbed: keep them apart`);
  const minerals = [...sup('iron'), ...sup('calcium'), ...sup('zinc'), ...sup('magnesium')];
  const iron = sup('iron');
  rule('iron-minerals', 'apart', iron, minerals.filter((m) => !iron.includes(m)), (a, b) => `${a} and ${b} block each other: 2 hours apart`);
  rule('fibre-tablets', 'apart', sup('fibre'), any((m) => TABLET(m) && !has(m, 'fibre')), (a, b) => `${a} 2 hours apart from ${b}, which it can stop being absorbed`);
  rule('zinc-copper', 'apart', sup('zinc'), [...sup('copper'), ...any((m) => guideFor(m.name)?.id === 'ghk-cu')], (a, b) => `${a} over about 40 mg a day for long lowers copper; ${b} adds copper back`);

  // Pairs well.
  rule('theanine-stim', 'pair', sup('theanine'), any(STIMULANT), (a, b) => `${a} with ${b} or caffeine takes the edge off for many people`);
  rule('vitc-iron', 'pair', any((m) => has(m, 'vitamin-c')), iron, (a, b) => `${a} with ${b} helps the iron absorb`);
  rule('nac-glut', 'pair', sup('nac'), any((m) => guideFor(m.name)?.id === 'glutathione'), (a, b) => `${a} is what the body makes glutathione from: it works alongside ${b}`);
  rule('fibre-glp1', 'pair', sup('fibre'), any((m) => isGlpLike(m)), (a, b) => `${a} helps the constipation common on ${b}`);
  rule('electro-glp1', 'pair', sup('electrolytes'), any((m) => isGlpLike(m)), (a, b) => `${a} on the days after a ${b} shot, and with nausea or diarrhoea`);
  rule('mag-stim', 'pair', sup('magnesium'), any(STIMULANT), (a, b) => `${a} in the evening suits many on ${b} (sleep, jaw clenching)`);

  // Blood tests.
  const lab = (key: string, text: string) => { for (const m of sup(key)) out.push({ id: `lab-${key}:${m.id}`, kind: 'lab', text: text.replace('{n}', name(m)), meds: [m.id] }); };
  lab('biotin', opts.bloodTestSoon ? '{n}: stop it 2–3 days before your blood test; it throws off thyroid, hormone and heart tests' : '{n}: stop it 2–3 days before a blood test; it throws off thyroid, hormone and heart tests');
  if (any((m) => has(m, 'b-complex') && /biotin|hair/i.test(m.name)).length === 0 && opts.bloodTestSoon) lab('b-complex', '{n} may contain biotin: check the label and stop it 2–3 days before your blood test');
  lab('creatine', '{n} raises creatinine on blood tests (it can look like lower kidney function): mention it when you have bloods');
  if (any((m) => isGlpLike(m)).length && any((m) => /metformin/i.test(m.name)).length) out.push({ id: 'lab-b12', kind: 'lab', text: 'On metformin, B12 is worth checking once a year', meds: [] });
  return out;
}

export interface Total { key: string; name: string; perDay: number; per: 'mg' | 'mcg'; ul: number; what?: string; over: boolean; from: string[] }

const toUnit = (v: number, unit: string, per: 'mg' | 'mcg', key: string): number | undefined => {
  const u = unit.toLowerCase();
  if (u === 'mg') return per === 'mg' ? v : v * 1000;
  if (u === 'mcg' || u === 'µg') return per === 'mcg' ? v : v / 1000;
  if (u === 'g') return per === 'mg' ? v * 1000 : v * 1e6;
  if ((u === 'units' || u === 'iu') && key === 'vitamin-d') return per === 'mcg' ? v / 40 : v / 40000;
  return undefined;
};

/** Each nutrient's daily total across everything taken (the planned amounts today, or for as-needed the last 2 weeks'
 *  average), against its upper limit. Only what can be worked out from the amounts entered. */
export function dailyTotals(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings): Total[] {
  const out = new Map<string, Total>();
  for (const m of meds.filter((x) => !x.archived)) {
    for (const sp of supplementsOf(m).filter((x) => x.ul)) {
      const ul = sp.ul!;
      const planned = plannedAmounts(m, now, s);
      const amounts = planned.length ? planned
        : m.schedule.type === 'prn' ? [doses.filter((d) => d.medicationId === m.id && !d.deletedAt && !d.skipped && Date.parse(d.takenAt) > now - 14 * 86_400_000).reduce((a, d) => a + d.amount, 0) / 14] : [];
      const amount = amounts.reduce((a, b) => a + b, 0);
      if (!amount) continue;
      // Amounts are in the medicine's unit: mg/mcg/IU directly, or tablets of its strength (or of the ingredient entered).
      let per = toUnit(amount, m.unit, ul.per, sp.key);
      if (per === undefined) {
        const ing = ingredientsOf(m).find((i) => sp.re.test(i.name));
        if (ing?.mg !== undefined) per = toUnit(amount * ing.mg, 'mg', ul.per, sp.key);
      }
      if (per === undefined) continue;
      const t = out.get(sp.key) ?? { key: sp.key, name: sp.name, perDay: 0, per: ul.per, ul: ul.amount, what: ul.what, over: false, from: [] };
      t.perDay += per; t.from.push(m.nickname || m.name);
      out.set(sp.key, t);
    }
  }
  return [...out.values()].map((t) => ({ ...t, perDay: Math.round(t.perDay * 10) / 10, over: t.perDay > t.ul }));
}

/** A blood test is likely soon: an appointment in the next 7 days. */
export const bloodTestSoon = (appointments: Appointment[], now: number) => appointments.some((a) => !a.deletedAt && new Date(`${a.date}T12:00`).getTime() - now < 7 * 86_400_000 && new Date(`${a.date}T23:59`).getTime() >= now);
