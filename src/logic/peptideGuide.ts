// The peptide guide: what each one is, where the evidence stands, how it's mixed, taken and stored, the doses people
// report (each labelled with where it comes from: a published trial, or user reports only), side effects, when to get
// help, and what's worth tracking. Each entry also fills in the injection form, so a peptide is set up in one tap.
// Reference text only: the numbers are what's published or commonly reported, never a recommendation for anyone.
import type { Medication, Schedule } from '../db/schema';
import { drawFor } from './peptide';

export type Evidence = 'trials' | 'small' | 'animal';
export const EVIDENCE: Record<Evidence, { label: string; long: string }> = {
  trials: { label: 'In clinical trials', long: 'Tested in large human trials, not yet approved' },
  small: { label: 'Small human studies', long: 'Only small or older human studies' },
  animal: { label: 'Mostly animal studies', long: 'Mostly lab and animal studies; little human data' },
};

/** A dose people report, and where the figure comes from. */
export interface Reported { text: string; source: 'trial' | 'label' | 'users' }

export interface GuideEntry {
  id: string; name: string;
  /** Other names (shown, and matched against a medication's name). */
  aka: string[];
  /** Other spellings and short forms, matched but not shown. */
  match?: string[];
  what: string;
  evidence: Evidence;
  status: string;
  /** Common vial sizes, in `unit`, and the water that gives easy-to-read draws for each. */
  vials: { amount: number; waterMl: number }[];
  unit: 'mg' | 'mcg';
  /** Doses to show in the mixing table (in `unit`). */
  tableDoses: number[];
  route: string;
  when: string;
  cycle?: string;
  reported: Reported[];
  /** A published step-up, in `unit` per dose, each step lasting `weeks`. */
  steps?: { amount: number; weeks: number }[];
  storage: { powder: string; mixed: string; useWithinDays: number };
  halfLifeHours?: number;
  sideEffects: string[];
  getHelp: string[];
  checkFirst: string[];
  tips: string[];
  /** Check-in words worth one tap (added to the check-in chips when it's set up). */
  chips: string[];
  sources: string[];
  /** The injection form, filled in: starting amount, schedule and syringe size. */
  setup: { defaultAmount: number; schedule: (today: string, dow: number) => Schedule; syringeUnits: number };
}

const daily = (time: string, extra: Partial<Schedule> = {}): Schedule => ({ type: 'fixed', slots: [{ time }], ...extra });

export const GUIDE: GuideEntry[] = [
  {
    id: 'retatrutide', name: 'Retatrutide', aka: ['LY3437943'], match: ['reta'],
    what: 'A weekly injection that acts on three hunger and metabolism hormones at once: GLP-1, GIP and glucagon. It lowers appetite, slows the stomach and raises energy use.',
    evidence: 'trials',
    status: 'Made by Eli Lilly and still in phase 3 trials (TRIUMPH). It isn’t approved anywhere yet, so anything sold now isn’t the trial medicine and its purity is unknown.',
    vials: [{ amount: 10, waterMl: 1 }, { amount: 5, waterMl: 1 }, { amount: 20, waterMl: 2 }],
    unit: 'mg', tableDoses: [1, 2, 4, 6, 8, 12],
    route: 'Under the skin (subcutaneous): belly at least 5 cm from the navel, front of the thigh, or back of the upper arm. Rotate sites.',
    when: 'Once a week, on the same day. Any time of day, with or without food.',
    reported: [
      { text: 'Phase 2 trial: weekly 1, 4, 8 or 12 mg for 48 weeks. Average weight loss was 8.7%, 17.1%, 22.8% and 24.2% (placebo 2.1%).', source: 'trial' },
      { text: 'The 12 mg group started at 2 mg and stepped up every 4 weeks: 2 → 4 → 8 → 12 mg. Starting at 2 mg rather than 4 mg meant less nausea.', source: 'trial' },
      { text: 'Many people stay on the lowest dose that’s still working, rather than climbing to the top, and some step up more slowly than every 4 weeks.', source: 'users' },
      { text: 'Some split the weekly amount into two shots 3–4 days apart (e.g. 1 mg Monday and Thursday instead of 2 mg Monday) for a steadier level and less nausea after each shot. The trials only tested once a week.', source: 'users' },
    ],
    steps: [{ amount: 2, weeks: 4 }, { amount: 4, weeks: 4 }, { amount: 8, weeks: 4 }, { amount: 12, weeks: 4 }],
    storage: { powder: 'Fridge (2–8 °C). The freezer for long-term storage.', mixed: 'Fridge, away from light. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    halfLifeHours: 144,
    sideEffects: [
      'Nausea, diarrhoea, vomiting and constipation: the most common, mostly mild, worst after each step up and settling over a few weeks.',
      'Faster resting heart rate (in the trial it peaked around week 24, then eased).',
      'Less appetite, early fullness, burping, heartburn, tiredness.',
      'Tingling or sensitive skin (dysaesthesia), reported in a phase 3 trial.',
      'Hair shedding with fast weight loss.',
    ],
    getHelp: [
      'Severe, constant stomach pain that may go through to the back, with or without vomiting (pancreatitis).',
      'Pain under the right ribs, fever, or yellow skin or eyes (gallbladder).',
      'Vomiting or diarrhoea so much you can’t keep fluids down, or very little urine (dehydration can hurt the kidneys).',
      'A racing or irregular heartbeat at rest, chest pain or fainting.',
      'Swelling of the face or throat, trouble breathing, a widespread rash: call 000.',
      'A lump in the neck, a hoarse voice or trouble swallowing.',
    ],
    checkFirst: [
      'Not for anyone with medullary thyroid cancer or MEN2 (or a family history), or a past pancreatitis: the same warnings as semaglutide and tirzepatide.',
      'Don’t combine with another GLP-1 medicine (Ozempic, Wegovy, Mounjaro).',
      'With insulin or a sulfonylurea (e.g. gliclazide), blood sugar can go too low: those doses usually need lowering. Talk to your doctor first.',
      'Contraceptive pill: tirzepatide’s label says to use a backup method for 4 weeks after starting and after each step up. Retatrutide hasn’t been studied for this, so the same care makes sense.',
      'Not in pregnancy or breastfeeding. Stop well before trying to conceive (semaglutide’s label says 2 months).',
      'Before surgery or a scope, tell the anaesthetist: food stays in the stomach longer.',
    ],
    tips: [
      'Eat smaller meals, stop at the first sign of fullness, and go easy on fatty and fried food, especially in the days after a shot.',
      'Protein at every meal and some strength training help keep muscle while losing fat.',
      'Drink plenty of water and get enough fibre for constipation.',
      'Missed a shot? The trials don’t give a rule. Tirzepatide’s label says take it within 4 days, otherwise skip it and keep your usual day.',
    ],
    chips: ['Nausea', 'Constipation', 'Heart racing', 'Reflux'],
    sources: ['Jastreboff et al., N Engl J Med 2023: phase 2 obesity trial, 338 adults, 48 weeks.', 'Eli Lilly TRIUMPH phase 3 programme (ongoing).'],
    setup: { defaultAmount: 2, syringeUnits: 50, schedule: (_t, dow) => daily('08:00', { days: [dow] }) },
  },
  {
    id: 'glutathione', name: 'Glutathione', aka: ['GSH', 'L-glutathione'],
    what: 'An antioxidant the body makes itself, from three amino acids. Injected to raise levels, often for skin, liver or recovery.',
    evidence: 'small',
    status: 'Sold as a supplement by mouth. Injections are offered by clinics, but the evidence for injecting it is limited. Regulators (the TGA and FDA) have warned about injections marketed for skin lightening.',
    vials: [{ amount: 600, waterMl: 3 }, { amount: 1500, waterMl: 10 }],
    unit: 'mg', tableDoses: [100, 200, 300, 600],
    route: 'Into a muscle (IM: buttock or thigh, which needs a longer needle than an insulin syringe) or slowly under the skin. Clinics also give it through a drip.',
    when: 'One to three times a week. Any time of day.',
    reported: [
      { text: 'Commonly 200–600 mg, one to three times a week, by injection.', source: 'users' },
      { text: 'Clinic drips are often 600–1,200 mg.', source: 'users' },
    ],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. It breaks down once mixed: commonly used within 2 weeks.', useWithinDays: 14 },
    sideEffects: ['Stinging, redness or a lump where it went in.', 'Stomach cramps or bloating.', 'Rash.', 'Lighter skin with high doses over time.'],
    getHelp: ['Swelling of the face or throat, trouble breathing, or a widespread rash: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: [
      'If you’re having chemotherapy, ask your oncologist first: antioxidants may interfere with some treatments.',
      'Not studied in pregnancy or breastfeeding.',
      'Asthma: breathing it in (nebulised) can trigger wheezing. That doesn’t apply to injections, but worth mentioning to your doctor.',
    ],
    tips: ['A dose of 200 mg from a 600 mg vial in 3 mL is 1 mL: use a 1 mL (100-unit) syringe.', 'If it’s yellow, cloudy or has bits in it, don’t use it.'],
    chips: ['Site sting'],
    sources: ['TGA and FDA safety alerts on injectable glutathione for skin lightening.', 'No published dosing trials for injected glutathione; figures are from user and clinic reports.'],
    setup: { defaultAmount: 200, syringeUnits: 100, schedule: () => daily('08:00', { days: [1, 3, 5] }) },
  },
  {
    id: 'ghk-cu', name: 'GHK-Cu', aka: ['copper peptide'], match: ['ghk', 'ghk cu'],
    what: 'A small copper-carrying peptide found naturally in blood, which falls with age. Used for skin, hair and healing.',
    evidence: 'animal',
    status: 'There’s good evidence for it in skin creams. There are no human trials of injecting it; the injected doses come from user reports.',
    vials: [{ amount: 50, waterMl: 2.5 }, { amount: 100, waterMl: 5 }],
    unit: 'mg', tableDoses: [0.5, 1, 2],
    route: 'Under the skin: belly or thigh. Rotate sites.',
    when: 'Once a day, usually in the evening.',
    cycle: 'Usually 4–8 weeks, then a break of a few weeks.',
    reported: [{ text: 'Commonly 1–2 mg a day under the skin, for 4–8 weeks.', source: 'users' }],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. Commonly used within 4 weeks of mixing. A blue colour is normal.', useWithinDays: 28 },
    sideEffects: ['Stinging or burning as it goes in: very common. More water (a weaker mix) and going slowly helps.', 'Redness or a small lump at the site.', 'Some report tiredness or a metallic taste.'],
    getHelp: ['Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: ['Not with Wilson’s disease or anything else that affects copper.', 'Not studied in pregnancy or breastfeeding.', 'Don’t take extra copper supplements alongside it.'],
    tips: ['If it stings a lot, mix it with more water so the same dose is a bigger, weaker draw.'],
    chips: ['Site sting'],
    sources: ['Pickart & Margolina, Int J Mol Sci 2018: review of GHK-Cu (mostly skin and lab studies).'],
    setup: { defaultAmount: 1, syringeUnits: 30, schedule: (t) => daily('20:00', { course: { start: t, days: 42 } }) },
  },
  {
    id: 'dsip', name: 'DSIP', aka: ['delta sleep-inducing peptide'], match: ['delta sleep inducing peptide', 'disp'],
    what: 'Delta sleep-inducing peptide: a small brain peptide first found in 1977. Used for deeper sleep and stress.',
    evidence: 'small',
    status: 'A few small human studies from the 1980s and 1990s (sleep problems, withdrawal) with mixed results. Not approved anywhere.',
    vials: [{ amount: 5, waterMl: 2 }, { amount: 2, waterMl: 1 }],
    unit: 'mg', tableDoses: [0.1, 0.2, 0.25, 0.3, 0.5],
    route: 'Under the skin: belly or thigh.',
    when: 'In the evening, 30 minutes to 3 hours before bed.',
    cycle: 'Usually short runs (a week or two), or a few nights a week, rather than every night long-term.',
    reported: [{ text: 'Commonly 100–300 mcg (0.1–0.3 mg) before bed; some use up to 500 mcg.', source: 'users' }],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Headache.', 'Grogginess the next morning.', 'Vivid dreams.', 'Nausea.'],
    getHelp: ['Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: ['Careful with alcohol, sleeping tablets, opioids or anything else that makes you drowsy.', 'Don’t drive until you know how it affects you the next morning.', 'Not studied in pregnancy or breastfeeding.'],
    tips: ['Log how you slept the next morning: the check-in’s sleep score shows whether it’s doing anything.'],
    chips: ['Slept well', 'Groggy'],
    sources: ['Kovalzon & Strekalova, J Neurochem 2006: review of DSIP research.'],
    setup: { defaultAmount: 0.25, syringeUnits: 30, schedule: (t) => daily('21:00', { course: { start: t, days: 14 } }) },
  },
  {
    id: 'bpc-157', name: 'BPC-157', aka: ['body protection compound'], match: ['bpc', 'bpc 157', 'bpc157'],
    what: 'A 15-amino-acid peptide based on a protein in stomach juice. Used for tendon, ligament, muscle and gut healing.',
    evidence: 'animal',
    status: 'Many rat studies, but only a handful of small human reports. Not approved anywhere. The FDA lists it as a safety concern for compounding, and WADA bans it in sport.',
    vials: [{ amount: 5000, waterMl: 2 }, { amount: 10000, waterMl: 2 }],
    unit: 'mcg', tableDoses: [250, 500],
    route: 'Under the skin: belly, or near the injured area. Rotate sites.',
    when: 'Once or twice a day.',
    cycle: 'Usually 4–6 weeks, then a break.',
    reported: [{ text: 'Commonly 250–500 mcg once or twice a day, for 4–6 weeks.', source: 'users' }],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Redness, itch or a small lump at the site.', 'Nausea, dizziness or headache.', 'Flushing.'],
    getHelp: ['Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: [
      'It encourages new blood vessels to grow. That’s why it’s used for healing, but it’s a worry with any current or past cancer. Talk to your doctor.',
      'Not studied in pregnancy or breastfeeding.',
      'Banned in tested sport (WADA S0).',
    ],
    tips: ['Log pain or how the injury feels in check-ins, so you can see whether it’s helping.'],
    chips: ['Pain better', 'Pain worse'],
    sources: ['Vasireddi et al., HSS J 2025: review of BPC-157 for musculoskeletal healing (mostly animal studies).', 'FDA bulk substances list, category 2 (2023).'],
    setup: { defaultAmount: 250, syringeUnits: 30, schedule: (t) => daily('08:00', { course: { start: t, days: 28 } }) },
  },
  {
    id: 'nad', name: 'NAD+', aka: ['nicotinamide adenine dinucleotide'], match: ['nad', 'nad 500', 'nad500'],
    what: 'A coenzyme every cell uses to make energy, which falls with age. Injected for energy, recovery and healthy ageing.',
    evidence: 'small',
    status: 'Taking its building blocks by mouth (NR, NMN) raises NAD levels in people. Whether injecting NAD+ itself helps hasn’t been shown. Clinics give it by drip.',
    vials: [{ amount: 500, waterMl: 5 }, { amount: 1000, waterMl: 10 }],
    unit: 'mg', tableDoses: [25, 50, 100],
    route: 'Under the skin (belly or thigh) or into a muscle. Inject slowly.',
    when: 'In the morning: it can be stimulating and keep you up.',
    reported: [
      { text: 'Commonly 50–100 mg under the skin, two to three times a week. Many start at 25–50 mg to see how they react.', source: 'users' },
      { text: 'Clinic drips are often 250–1,000 mg over a few hours.', source: 'users' },
    ],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. Commonly used within 2–4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Flushing, warmth or a racing feeling soon after: worse when injected fast or at higher doses.', 'Nausea, stomach cramps or tightness in the chest.', 'Stinging at the site.', 'Headache.'],
    getHelp: ['Chest pain that doesn’t ease within a few minutes.', 'Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: ['Not studied in pregnancy or breastfeeding.', 'With any current cancer, ask your doctor first.'],
    tips: ['Inject slowly over 30–60 seconds: that’s what makes the biggest difference to flushing and cramps.', 'A 500 mg vial with 5 mL of water is 100 mg per mL: 50 mg is 50 units on a 1 mL syringe.'],
    chips: ['Flushing', 'Energy up'],
    sources: ['Rajman et al., Cell Metab 2018: review of NAD+ in people.'],
    setup: { defaultAmount: 50, syringeUnits: 100, schedule: () => daily('08:00', { days: [1, 3, 5] }) },
  },
  {
    id: 'semax', name: 'Semax', aka: ['N-Acetyl Semax', 'ACTH(4-10) analogue'], match: ['na semax'],
    what: 'A small peptide (Met-Glu-His-Phe-Pro-Gly-Pro) based on a fragment of the stress hormone ACTH. Used for focus, memory and mental energy.',
    evidence: 'small',
    status: 'A prescription medicine in Russia (nose drops, 0.1% and 1%) for stroke recovery and some brain conditions, with Russian human studies behind it. Not approved in Australia, the US or Europe.',
    vials: [{ amount: 5000, waterMl: 2.5 }, { amount: 10000, waterMl: 5 }],
    unit: 'mcg', tableDoses: [100, 200, 300, 500],
    route: 'Usually in the nose (drops or a spray). Some inject it under the skin (belly or thigh) from a mixed vial.',
    when: 'In the morning or early afternoon: it’s stimulating and can keep you up if taken late.',
    cycle: 'Usually 1–2 weeks on, then a break of a week or more.',
    reported: [
      { text: 'The Russian 0.1% drops have 1 mg per mL: one drop is about 50 mcg. For focus, 2–3 drops in each nostril, 2–3 times a day (about 400–900 mcg a day).', source: 'label' },
      { text: 'Commonly 200–600 mcg a day in the nose, or 200–500 mcg once a day under the skin, for 1–2 weeks at a time.', source: 'users' },
    ],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing (sprays: about 2 weeks).', useWithinDays: 28 },
    sideEffects: ['Irritation in the nose.', 'Headache.', 'Feeling wired, anxious or irritable.', 'Poor sleep if taken late in the day.'],
    getHelp: ['Chest pain, a racing heart that doesn’t settle, or fainting.', 'Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: [
      'It’s stimulating. With Ritalin, Vyvanse, dexamphetamine or lots of caffeine the effects can add up: more anxiety, a faster heart, worse sleep. Start low and keep it to mornings.',
      'Careful with anxiety, and not with a history of psychosis, mania or seizures without talking to your doctor.',
      'Not studied in pregnancy or breastfeeding.',
    ],
    tips: ['Log focus and anxiety in check-ins for a week on and a week off: the difference shows whether it’s doing anything for you.', 'For a nose spray, a typical pump gives about 0.1 mL a spray: in a 1 mg per mL mix that’s about 100 mcg.'],
    chips: ['Focus', 'Anxious'],
    sources: ['Russian State Register: Semax 0.1% and 1% nasal drops.', 'Dolotov et al., Brain Res 2006: Semax and BDNF (animal study).'],
    setup: { defaultAmount: 200, syringeUnits: 30, schedule: (t) => daily('08:00', { course: { start: t, days: 14 } }) },
  },
  {
    id: 'epitalon', name: 'Epitalon', aka: ['Epithalon', 'AEDG'], match: ['epithilian', 'epithalamin'],
    what: 'A small synthetic peptide (Ala-Glu-Asp-Gly) based on an extract from the pineal gland. Used for sleep, and as an anti-ageing peptide.',
    evidence: 'small',
    status: 'Mostly lab and animal work, plus small studies in older people from one Russian research group. Lab studies suggest it can switch on telomerase. Not approved anywhere.',
    vials: [{ amount: 10, waterMl: 1 }, { amount: 50, waterMl: 5 }],
    unit: 'mg', tableDoses: [1, 5, 10],
    route: 'Under the skin: belly or thigh.',
    when: 'Once a day, usually in the evening.',
    cycle: 'A short course (10–20 days), repeated once or twice a year.',
    reported: [{ text: 'Commonly 5–10 mg a day for 10–20 days, repeated every 4–6 months. Some use 1–2 mg a day over a longer course.', source: 'users' }],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Few reported.', 'Redness at the site.', 'Changes in sleep, vivid dreams.'],
    getHelp: ['Swelling of the face or throat, or trouble breathing: call 000.', 'Spreading redness, heat or pus at the injection site, or a fever.'],
    checkFirst: ['Not studied in pregnancy or breastfeeding.', 'With any current cancer, ask your doctor first (it’s claimed to act on telomeres).'],
    tips: ['A 10 mg vial with 1 mL of water is 10 mg per mL: 5 mg is 50 units.'],
    chips: ['Slept well'],
    sources: ['Khavinson et al.: studies of epithalamin and epitalon (1990s–2000s), mostly animal and small human studies.'],
    setup: { defaultAmount: 5, syringeUnits: 100, schedule: (t) => daily('21:00', { course: { start: t, days: 20 } }) },
  },
];

/** Before starting any of them: supplies, mixing, injecting and staying safe. */
export const BASICS: { title: string; points: string[] }[] = [
  { title: 'What you need', points: [
    'Bacteriostatic water (with 0.9% benzyl alcohol): it keeps a vial you use more than once safe. Sterile water is only for a single use.',
    'Insulin syringes: U-100, 29–31 gauge, 8 mm or shorter. Choose 0.3 mL (30 units) for small doses, 0.5 mL (50 units) or 1 mL (100 units) for bigger ones.',
    'A bigger syringe to add the water (e.g. 3 mL with a drawing-up needle), alcohol swabs and a sharps container.',
  ] },
  { title: 'Mixing a vial', points: [
    'Wash your hands. Swab the rubber tops of both vials and let them dry.',
    'Draw up the water, then let it run slowly down the inside wall of the peptide vial. Don’t squirt it onto the powder.',
    'Swirl gently or let it sit until clear. Never shake it.',
    'Write the date and strength on the vial (or add it in the app: it works out the draw for you). Keep it in the fridge.',
  ] },
  { title: 'Injecting', points: [
    'A new syringe every time. Never share one.',
    'Swab the vial and the skin, and let both dry.',
    'Pinch a fold of skin, go in at 45–90°, push slowly, wait a few seconds, then withdraw.',
    'Rotate sites, at least 2–3 cm from the last one. Stay 5 cm away from your navel. Avoid bruises, scars and moles.',
    'Straight into the sharps container: don’t recap.',
  ] },
  { title: 'Quality', points: [
    'Most of these are sold as “research chemicals”, so nothing checks what’s in the vial. Buy only where each batch has an independent test (HPLC purity and mass), and ideally an endotoxin test.',
    'Don’t use a vial that’s cloudy, has bits in it, or has changed colour (GHK-Cu is meant to be blue).',
    'In Australia, most of these are prescription-only or not approved, and importing them without a prescription can break TGA rules.',
    'In tested sport, WADA bans substances not approved for human use (S0): that covers most of these.',
  ] },
  { title: 'Get help', points: [
    'Swelling of the face, lips or throat, trouble breathing, or a widespread rash: call 000.',
    'Redness spreading out from a site, heat, pus or a fever: see a doctor the same day.',
    'Tell your doctor what you take. The app’s Protocol report has everything on one page.',
  ] },
];

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()} `;

/** The guide entry a medication's name matches, if any. */
export function guideFor(name: string): GuideEntry | undefined {
  const n = norm(name);
  return GUIDE.find((g) => [g.name, g.id, ...g.aka, ...(g.match ?? [])].some((k) => n.includes(norm(k))));
}

export const guideById = (id: string) => GUIDE.find((g) => g.id === id);

/** The draw for each dose in the table, for a vial and water amount. Doses over the vial are left out. */
export function mixTable(g: GuideEntry, vial: { amount: number; waterMl: number }): { dose: number; units: number; ml: number }[] {
  return g.tableDoses.filter((d) => d <= vial.amount).map((dose) => ({ dose, ...drawFor(dose, vial.amount, vial.waterMl, 'U-100') }));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** "250 mcg", "0.25 mg (250 mcg)", "5 mg" for 5,000 mcg. */
export function fmtDose(n: number, unit: string): string {
  if (unit === 'mcg' && n >= 1000) return `${r3(n / 1000)} mg`;
  if (unit === 'mg' && n < 1) return `${r3(n)} mg (${r3(n * 1000)} mcg)`;
  return `${r3(n).toLocaleString('en-AU')} ${unit}`;
}

/** A medication set up from the guide: the first vial size, its water, U-100 syringes, its schedule and starting amount. */
/** A once-a-week entry can be split into two shots a week. */
export const canSplit = (g: GuideEntry) => g.setup.schedule('2026-01-01', 1).days?.length === 1;

/** A medication set up from the guide: the first vial size, its water, U-100 syringes, its schedule and starting amount.
 *  `split`: half the amount twice a week, 3 then 4 days apart (from today's weekday). */
export function guideMed(g: GuideEntry, now: number, split = false): Omit<Medication, 'id' | 'createdAt' | 'updatedAt' | 'color' | 'icon' | 'archived'> {
  const d = new Date(now);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const v = g.vials[0];
  const sc = g.setup.schedule(today, d.getDay());
  const halve = split && canSplit(g);
  return {
    name: g.name, strength: v.amount, unit: g.unit, form: 'injection', defaultAmount: halve ? g.setup.defaultAmount / 2 : g.setup.defaultAmount,
    schedule: halve ? { ...sc, days: [d.getDay(), (d.getDay() + 3) % 7].sort((a, b) => a - b) } : sc,
    peptide: { kind: 'vial', waterMl: v.waterMl, syringe: 'U-100', syringeUnits: g.setup.syringeUnits, useWithinDays: g.storage.useWithinDays, halfLifeHours: g.halfLifeHours },
  };
}

/** The published step-up as planned changes from `start` ('YYYY-MM-DD'): each later step on its own date. */
export function stepChanges(g: GuideEntry, start: string, split = false): { from: string; amount: number }[] {
  if (!g.steps) return [];
  const out: { from: string; amount: number }[] = [];
  let days = 0;
  for (let i = 0; i < g.steps.length; i++) {
    if (i > 0) {
      const d = new Date(`${start}T12:00`); d.setDate(d.getDate() + days);
      out.push({ from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, amount: split ? g.steps[i].amount / 2 : g.steps[i].amount });
    }
    days += g.steps[i].weeks * 7;
  }
  return out;
}

/** How far the level falls between shots, as a share of its peak (absorption left out): 1 − 2^(−gap ÷ half-life). */
export const levelSwing = (halfLifeHours: number, gapHours: number) => 1 - 2 ** (-gapHours / halfLifeHours);

/** The gaps between shots through a week, in days, for shots on these weekdays (0 = Sunday). */
export function weekGaps(days: number[]): number[] {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length < 2) return d.length ? [7] : [];
  return d.map((x, i) => (i + 1 < d.length ? d[i + 1] - x : 7 - x + d[0]));
}

export interface SplitView {
  /** Shots a week now, and the biggest drop between shots (0–1). */
  perWeek: number; swing: number;
  /** Once a week: the swing with two shots 3–4 days apart. Twice or more: the swing with one a week. */
  other: { perWeek: number; swing: number };
}

/** For a long-acting peptide on set weekdays: how steady the level is between shots, against the other way of
 *  splitting the week. Only when the half-life is at least a day (shorter ones are gone between shots either way). */
export function splitView(halfLifeHours: number | undefined, days: number[] | undefined): SplitView | null {
  if (!halfLifeHours || halfLifeHours < 24 || !days?.length) return null;
  const gaps = weekGaps(days);
  const swing = levelSwing(halfLifeHours, Math.max(...gaps) * 24);
  return days.length === 1
    ? { perWeek: 1, swing, other: { perWeek: 2, swing: levelSwing(halfLifeHours, 4 * 24) } }
    : { perWeek: days.length, swing, other: { perWeek: 1, swing: levelSwing(halfLifeHours, 7 * 24) } };
}
