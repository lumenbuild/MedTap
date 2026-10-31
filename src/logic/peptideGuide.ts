// The peptide guide: what each one is, what the research shows and what people notice, how it's mixed, taken and
// stored, the doses used, side effects, when to get help, and what's worth tracking. Each entry also fills in the
// injection form, so a peptide is set up in one tap. Neutral reference text: the facts, for the person to decide.
import type { Medication, Schedule, StepPlan, StepUpCriteria } from '../db/schema';
import { drawFor } from './peptide';
import { LOWEST_STEP_UP } from './stepUp';

export interface GuideEntry {
  id: string; name: string;
  /** Other names (shown, and matched against a medication's name). */
  aka: string[];
  /** Other spellings and short forms, matched but not shown. */
  match?: string[];
  what: string;
  /** What studies have found, the good and the limits. */
  research: string[];
  /** What people commonly notice. */
  notice: string[];
  /** Common vial sizes, in `unit`, and the water that gives easy-to-read draws for each. */
  vials: { amount: number; waterMl: number }[];
  unit: 'mg' | 'mcg';
  /** Doses to show in the mixing table (in `unit`). */
  tableDoses: number[];
  route: string;
  when: string;
  cycle?: string;
  doses: string[];
  /** A step-up, in `unit` per dose, each step lasting `weeks`. */
  steps?: { amount: number; weeks: number }[];
  /** The lowest dose that works: step by this much (weekly amount) only once loss slows, up to `max` a week. */
  lowest?: { by: number; max: number };
  storage: { powder: string; mixed: string; useWithinDays: number };
  halfLifeHours?: number;
  sideEffects: string[];
  getHelp: string[];
  /** Interactions and conditions worth knowing about. */
  worthKnowing: string[];
  tips: string[];
  /** Check-in words worth one tap (added to the check-in chips when it's set up). */
  chips: string[];
  sources: string[];
  /** The injection form, filled in: starting amount, schedule and syringe size. */
  setup: { defaultAmount: number; schedule: (today: string, dow: number) => Schedule; syringeUnits: number };
}

const daily = (time: string, extra: Partial<Schedule> = {}): Schedule => ({ type: 'fixed', slots: [{ time }], ...extra });
const SITE = 'Swelling of the face or throat, or trouble breathing: call 000.';
const INFECTION = 'Redness spreading out from the site, heat, pus or a fever.';

export const GUIDE: GuideEntry[] = [
  {
    id: 'retatrutide', name: 'Retatrutide', aka: ['LY3437943'], match: ['reta'],
    what: 'A weekly injection that acts on three hunger and metabolism hormones at once: GLP-1, GIP and glucagon. It lowers appetite, slows the stomach and raises energy use.',
    research: [
      'Phase 2 trial (338 adults, 48 weeks): average weight loss of 8.7% at 1 mg, 17.1% at 4 mg, 22.8% at 8 mg and 24.2% at 12 mg, against 2.1% on placebo. On the higher doses, weight was still falling at 48 weeks.',
      'Waist, blood pressure, triglycerides and blood sugar improved too. In people with fatty liver, liver fat returned to normal in most of those on 8 or 12 mg.',
      'Made by Eli Lilly; larger phase 3 trials (TRIUMPH) are running.',
    ],
    notice: ['Much less appetite and “food noise”.', 'Full sooner, smaller portions.', 'Steady weekly weight loss, often faster than with semaglutide or tirzepatide.'],
    vials: [{ amount: 10, waterMl: 1 }, { amount: 5, waterMl: 1 }, { amount: 20, waterMl: 2 }],
    unit: 'mg', tableDoses: [0.5, 1, 2, 3, 4, 6, 8, 12],
    route: 'Under the skin: belly at least 5 cm from the navel, front of the thigh, or back of the upper arm. Rotate sites.',
    when: 'Once a week on the same day, or the weekly amount split into two shots 3–4 days apart. Any time of day, with or without food.',
    doses: [
      'Trial doses: 1, 4, 8 or 12 mg once a week.',
      'The 12 mg group started at 2 mg and stepped up every 4 weeks: 2 → 4 → 8 → 12 mg. Starting at 2 mg rather than 4 mg meant less nausea.',
      'Many people stay on the lowest dose that keeps working rather than climbing to the top, stepping up only when loss slows. The app can do this for you: it holds the dose while you’re losing and asks about a step only once loss has slowed for 3 weeks.',
      'Splitting the weekly amount into two shots (e.g. 1 mg Monday and Thursday instead of 2 mg Monday) gives a steadier level and, for many, less nausea after each shot.',
    ],
    steps: [{ amount: 2, weeks: 4 }, { amount: 4, weeks: 4 }, { amount: 8, weeks: 4 }, { amount: 12, weeks: 4 }],
    lowest: { by: 1, max: 12 },
    storage: { powder: 'Fridge (2–8 °C). The freezer for long-term storage.', mixed: 'Fridge, away from light. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    halfLifeHours: 144,
    sideEffects: [
      'Nausea, diarrhoea, vomiting and constipation: the most common, mostly mild, worst after each step up and settling over a few weeks.',
      'Faster resting heart rate (in the trial it peaked around week 24, then eased).',
      'Early fullness, burping, heartburn, tiredness.',
      'Tingling or sensitive skin (dysaesthesia), seen in a phase 3 trial.',
      'Hair shedding with fast weight loss.',
    ],
    getHelp: [
      'Severe, constant stomach pain that may go through to the back, with or without vomiting (pancreatitis).',
      'Pain under the right ribs, fever, or yellow skin or eyes (gallbladder).',
      'Vomiting or diarrhoea so much you can’t keep fluids down, or very little urine (dehydration can hurt the kidneys).',
      'A racing or irregular heartbeat at rest, chest pain or fainting.',
      SITE,
      'A lump in the neck, a hoarse voice or trouble swallowing.',
    ],
    worthKnowing: [
      'The same cautions as semaglutide and tirzepatide: medullary thyroid cancer or MEN2 (or a family history), and past pancreatitis.',
      'Not combined with another GLP-1 medicine (Ozempic, Wegovy, Mounjaro).',
      'With insulin or a sulfonylurea (e.g. gliclazide), blood sugar can go too low: those doses usually come down.',
      'Contraceptive pill: tirzepatide’s label advises a backup method for 4 weeks after starting and after each step up, as the pill can be absorbed less well. The same applies in principle here.',
      'Pregnancy: semaglutide’s label says stop 2 months before trying to conceive.',
      'Before surgery or a scope, the anaesthetist will want to know: food stays in the stomach longer.',
    ],
    tips: [
      'Smaller meals, stopping at the first sign of fullness, and going easy on fatty food in the days after a shot all ease nausea.',
      'Protein at every meal and some strength training help keep muscle while losing fat.',
      'Water and fibre for constipation.',
      'Missed a shot: tirzepatide’s rule is to take it within 4 days, otherwise skip it and keep your usual day. On a split schedule, many take it if the next shot is more than 2 days away.',
    ],
    chips: ['Nausea', 'Constipation', 'Heart racing', 'Reflux'],
    sources: ['Jastreboff et al., N Engl J Med 2023: phase 2 obesity trial, 338 adults, 48 weeks.', 'Sanyal et al., Nat Med 2024: retatrutide and liver fat.', 'Eli Lilly TRIUMPH phase 3 programme.'],
    setup: { defaultAmount: 2, syringeUnits: 50, schedule: (_t, dow) => daily('08:00', { days: [dow] }) },
  },
  {
    id: 'glutathione', name: 'Glutathione', aka: ['GSH', 'L-glutathione'],
    what: 'An antioxidant the body makes itself, from three amino acids. Injected to raise levels, often for skin, liver or recovery.',
    research: [
      'Injected glutathione raises blood levels quickly; taken by mouth, much of it is broken down (liposomal forms do better).',
      'Small trials found skin lightening and more even tone with injected and oral use.',
      'IV glutathione has been studied alongside some chemotherapy to reduce nerve damage. Studies for energy, liver and recovery are small.',
    ],
    notice: ['Brighter, more even skin over weeks to months.', 'Some notice better recovery or less fatigue.'],
    vials: [{ amount: 600, waterMl: 3 }, { amount: 1500, waterMl: 10 }],
    unit: 'mg', tableDoses: [100, 200, 300, 600],
    route: 'Into a muscle (buttock or thigh: this needs a longer needle than an insulin syringe) or slowly under the skin. Clinics also give it by drip.',
    when: 'One to three times a week. Any time of day.',
    doses: ['Commonly 200–600 mg, one to three times a week, by injection.', 'Clinic drips are often 600–1,200 mg.'],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. It breaks down once mixed: commonly used within 2 weeks.', useWithinDays: 14 },
    sideEffects: ['Stinging, redness or a lump where it went in.', 'Stomach cramps or bloating.', 'Rash.', 'Lighter skin with high doses over time.'],
    getHelp: [SITE, INFECTION],
    worthKnowing: ['During chemotherapy, antioxidants may interfere with some treatments: worth raising with the oncologist.', 'Not studied in pregnancy or breastfeeding.', 'Breathed in (nebulised) it can trigger wheezing in asthma; injections don’t do this.'],
    tips: ['200 mg from a 600 mg vial in 3 mL is 1 mL: use a 1 mL (100-unit) syringe.', 'Yellowing or cloudiness means it has broken down.'],
    chips: ['Site sting'],
    sources: ['Sonthalia et al., Indian J Dermatol Venereol Leprol 2016: glutathione for the skin.', 'Cascinu et al., J Clin Oncol 1995: glutathione and nerve damage from cisplatin.'],
    setup: { defaultAmount: 200, syringeUnits: 100, schedule: () => daily('08:00', { days: [1, 3, 5] }) },
  },
  {
    id: 'ghk-cu', name: 'GHK-Cu', aka: ['copper peptide'], match: ['ghk', 'ghk cu'],
    what: 'A small copper-carrying peptide found naturally in blood, which falls with age. Used for skin, hair and healing.',
    research: [
      'In skin creams it’s well studied: more collagen, firmer skin, fewer fine lines and faster wound healing.',
      'Lab studies show it switches on many tissue-repair and antioxidant genes.',
      'Injected use comes from people’s experience rather than published trials.',
    ],
    notice: ['Better skin texture and firmness.', 'Thicker hair for some.', 'Faster healing of cuts and minor injuries.'],
    vials: [{ amount: 50, waterMl: 2.5 }, { amount: 100, waterMl: 5 }],
    unit: 'mg', tableDoses: [0.5, 1, 2],
    route: 'Under the skin: belly or thigh. Rotate sites.',
    when: 'Once a day, usually in the evening.',
    cycle: 'Usually 4–8 weeks, then a break of a few weeks.',
    doses: ['Commonly 1–2 mg a day under the skin, for 4–8 weeks.'],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. Commonly used within 4 weeks of mixing. A blue colour is normal.', useWithinDays: 28 },
    sideEffects: ['Stinging or burning as it goes in: very common. More water (a weaker mix) and going slowly helps.', 'Redness or a small lump at the site.', 'Some notice tiredness or a metallic taste.'],
    getHelp: [SITE, INFECTION],
    worthKnowing: ['Wilson’s disease or anything else that affects copper.', 'Extra copper supplements alongside it add up.', 'Not studied in pregnancy or breastfeeding.'],
    tips: ['If it stings a lot, mix it with more water so the same dose is a bigger, weaker draw.'],
    chips: ['Site sting'],
    sources: ['Pickart & Margolina, Int J Mol Sci 2018: review of GHK-Cu.'],
    setup: { defaultAmount: 1, syringeUnits: 30, schedule: (t) => daily('20:00', { course: { start: t, days: 42, remindAfterDays: 28 } }) },
  },
  {
    id: 'dsip', name: 'DSIP', aka: ['delta sleep-inducing peptide'], match: ['delta sleep inducing peptide', 'disp'],
    what: 'Delta sleep-inducing peptide: a small brain peptide first found in 1977. Used for deeper sleep and stress.',
    research: [
      'Small human studies in the 1980s and 1990s found better sleep in some people with insomnia, and eased symptoms during alcohol and opioid withdrawal. Others found little effect.',
      'It also seems to lower stress hormones. How it works is still not fully understood.',
    ],
    notice: ['Deeper, more refreshing sleep for some.', 'Calmer in the evening.'],
    vials: [{ amount: 5, waterMl: 2 }, { amount: 2, waterMl: 1 }],
    unit: 'mg', tableDoses: [0.1, 0.2, 0.25, 0.3, 0.5],
    route: 'Under the skin: belly or thigh.',
    when: 'In the evening, 30 minutes to 3 hours before bed.',
    cycle: 'Usually short runs (a week or two), or a few nights a week.',
    doses: ['Commonly 100–300 mcg (0.1–0.3 mg) before bed; some use up to 500 mcg.'],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Headache.', 'Grogginess the next morning.', 'Vivid dreams.', 'Nausea.'],
    getHelp: [SITE, INFECTION],
    worthKnowing: ['Alcohol, sleeping tablets, opioids and other sedatives add to the drowsiness.', 'Next-morning grogginess matters for driving.', 'Not studied in pregnancy or breastfeeding.'],
    tips: ['Log how you slept the next morning: the check-in’s sleep score shows whether it’s doing anything for you.'],
    chips: ['Slept well', 'Groggy'],
    sources: ['Kovalzon & Strekalova, J Neurochem 2006: review of DSIP research.'],
    setup: { defaultAmount: 0.25, syringeUnits: 30, schedule: (t) => daily('21:00', { course: { start: t, days: 14, remindAfterDays: 14 } }) },
  },
  {
    id: 'bpc-157', name: 'BPC-157', aka: ['body protection compound'], match: ['bpc', 'bpc 157', 'bpc157'],
    what: 'A 15-amino-acid peptide based on a protein in stomach juice. Used for tendon, ligament, muscle and gut healing.',
    research: [
      'Many animal studies show faster healing of tendons, ligaments, muscle, bone and the gut lining, and protection against stomach damage from anti-inflammatories.',
      'In people: small reports of less knee pain and bladder pain after injections, and a small 2025 pilot that found intravenous doses well tolerated. Larger human trials haven’t been done yet.',
    ],
    notice: ['Less pain and faster recovery from injuries.', 'Calmer gut for some.'],
    vials: [{ amount: 5000, waterMl: 2 }, { amount: 10000, waterMl: 2 }],
    unit: 'mcg', tableDoses: [250, 500],
    route: 'Under the skin: belly, or near the injured area. Rotate sites.',
    when: 'Once or twice a day.',
    cycle: 'Usually 4–6 weeks, then a break.',
    doses: ['Commonly 250–500 mcg once or twice a day, for 4–6 weeks.'],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Redness, itch or a small lump at the site.', 'Nausea, dizziness or headache.', 'Flushing.'],
    getHelp: [SITE, INFECTION],
    worthKnowing: ['It encourages new blood vessels to grow, which is part of how it helps healing. That’s a consideration with any current or past cancer.', 'Not studied in pregnancy or breastfeeding.', 'On the banned list in tested sport (WADA).'],
    tips: ['Log pain or how the injury feels in check-ins, so you can see the trend.'],
    chips: ['Pain better', 'Pain worse'],
    sources: ['Vasireddi et al., HSS J 2025: review of BPC-157 for musculoskeletal healing.', 'Sikiric et al.: animal studies of BPC-157 (1990s–2020s).'],
    setup: { defaultAmount: 250, syringeUnits: 30, schedule: (t) => daily('08:00', { course: { start: t, days: 28, remindAfterDays: 28 } }) },
  },
  {
    id: 'nad', name: 'NAD+', aka: ['nicotinamide adenine dinucleotide'], match: ['nad', 'nad 500', 'nad500'],
    what: 'A coenzyme every cell uses to make energy, which falls with age. Injected for energy, recovery and healthy ageing.',
    research: [
      'NAD+ levels fall with age, and low levels are linked to age-related decline in animal studies.',
      'Building blocks by mouth (NR, NMN) reliably raise NAD+ in people; effects on energy and health markers so far are modest and mixed.',
      'Injected NAD+ itself has little published research yet; clinics have used drips for years.',
    ],
    notice: ['More energy and mental clarity, often within a day or two.', 'Better recovery after training for some.'],
    vials: [{ amount: 500, waterMl: 5 }, { amount: 1000, waterMl: 10 }],
    unit: 'mg', tableDoses: [25, 50, 100],
    route: 'Under the skin (belly or thigh) or into a muscle. Inject slowly.',
    when: 'In the morning: it can be stimulating and keep you up.',
    doses: ['Commonly 50–100 mg under the skin, two to three times a week. Many start at 25–50 mg to see how they react.', 'Clinic drips are often 250–1,000 mg over a few hours.'],
    storage: { powder: 'Fridge, away from light.', mixed: 'Fridge, away from light. Commonly used within 2–4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Flushing, warmth or a racing feeling soon after: more with a fast push or higher doses.', 'Nausea, stomach cramps or tightness in the chest.', 'Stinging at the site.', 'Headache.'],
    getHelp: ['Chest pain that doesn’t ease within a few minutes.', SITE, INFECTION],
    worthKnowing: ['Not studied in pregnancy or breastfeeding.', 'With an active cancer, raising NAD+ is a debated question.'],
    tips: ['Injecting slowly over 30–60 seconds makes the biggest difference to flushing and cramps.', 'A 500 mg vial with 5 mL of water is 100 mg per mL: 50 mg is 50 units on a 1 mL syringe.'],
    chips: ['Flushing', 'Energy up'],
    sources: ['Rajman et al., Cell Metab 2018: review of NAD+ in people.'],
    setup: { defaultAmount: 50, syringeUnits: 100, schedule: () => daily('08:00', { days: [1, 3, 5] }) },
  },
  {
    id: 'semax', name: 'Semax', aka: ['N-Acetyl Semax', 'ACTH(4-10) analogue'], match: ['na semax'],
    what: 'A small peptide (Met-Glu-His-Phe-Pro-Gly-Pro) based on a fragment of the stress hormone ACTH. Used for focus, memory and mental energy.',
    research: [
      'A prescription medicine in Russia (nose drops, 0.1% and 1%) for stroke recovery, attention and some other brain conditions, backed by Russian clinical studies.',
      'Animal studies show it raises BDNF, a growth factor that supports brain cells and learning.',
    ],
    notice: ['Sharper focus and mental energy within minutes to hours.', 'Better mood for some.'],
    vials: [{ amount: 5000, waterMl: 2.5 }, { amount: 10000, waterMl: 5 }],
    unit: 'mcg', tableDoses: [100, 200, 300, 500],
    route: 'Usually in the nose (drops or a spray). Some inject it under the skin (belly or thigh) from a mixed vial.',
    when: 'In the morning or early afternoon: it’s stimulating and can keep you up if taken late.',
    cycle: 'Usually 1–2 weeks on, then a break of a week or more.',
    doses: [
      'The Russian 0.1% drops have 1 mg per mL: one drop is about 50 mcg. For focus, 2–3 drops in each nostril, 2–3 times a day (about 400–900 mcg a day).',
      'Commonly 200–600 mcg a day in the nose, or 200–500 mcg once a day under the skin, for 1–2 weeks at a time.',
    ],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing (sprays: about 2 weeks).', useWithinDays: 28 },
    sideEffects: ['Irritation in the nose.', 'Headache.', 'Feeling wired, anxious or irritable.', 'Poor sleep if taken late in the day.'],
    getHelp: ['Chest pain, a racing heart that doesn’t settle, or fainting.', SITE, INFECTION],
    worthKnowing: [
      'It’s stimulating. With Ritalin, Vyvanse, dexamphetamine or lots of caffeine the effects add up: more anxiety, a faster heart, worse sleep. A low start and mornings only keeps that in check.',
      'Anxiety, and any history of psychosis, mania or seizures, can be affected by stimulating peptides.',
      'Not studied in pregnancy or breastfeeding.',
    ],
    tips: ['Log focus and anxiety in check-ins for a week on and a week off: the difference shows what it’s doing for you.', 'For a nose spray, a typical pump gives about 0.1 mL a spray: in a 1 mg per mL mix that’s about 100 mcg.'],
    chips: ['Focus', 'Anxious'],
    sources: ['Russian State Register: Semax 0.1% and 1% nasal drops.', 'Dolotov et al., Brain Res 2006: Semax and BDNF.'],
    setup: { defaultAmount: 200, syringeUnits: 30, schedule: (t) => daily('08:00', { course: { start: t, days: 14, remindAfterDays: 7 } }) },
  },
  {
    id: 'epitalon', name: 'Epitalon', aka: ['Epithalon', 'AEDG'], match: ['epithilian', 'epithalamin'],
    what: 'A small synthetic peptide (Ala-Glu-Asp-Gly) based on an extract from the pineal gland. Used for sleep and healthy ageing.',
    research: [
      'Russian studies in older people found better sleep and a restored melatonin rhythm, and long-term follow-up reported lower death rates in those treated.',
      'Lab studies show it switches on telomerase and lengthens telomeres in human cells; animal studies show longer lifespan.',
      'Most of this work comes from one research group (Khavinson, St Petersburg).',
    ],
    notice: ['Deeper sleep and vivid dreams during a course.', 'A general sense of wellbeing for some.'],
    vials: [{ amount: 10, waterMl: 1 }, { amount: 50, waterMl: 5 }],
    unit: 'mg', tableDoses: [1, 5, 10],
    route: 'Under the skin: belly or thigh.',
    when: 'Once a day, usually in the evening.',
    cycle: 'A short course (10–20 days), repeated once or twice a year.',
    doses: ['Commonly 5–10 mg a day for 10–20 days, repeated every 4–6 months. Some use 1–2 mg a day over a longer course.'],
    storage: { powder: 'Fridge or freezer.', mixed: 'Fridge. Commonly used within 4 weeks of mixing.', useWithinDays: 28 },
    sideEffects: ['Few reported.', 'Redness at the site.', 'Changes in sleep, vivid dreams.'],
    getHelp: [SITE, INFECTION],
    worthKnowing: ['Not studied in pregnancy or breastfeeding.', 'Because it acts on telomerase, its use with an active cancer is a debated question.'],
    tips: ['A 10 mg vial with 1 mL of water is 10 mg per mL: 5 mg is 50 units.'],
    chips: ['Slept well'],
    sources: ['Khavinson et al.: studies of epithalamin and epitalon (1990s–2000s).', 'Khavinson et al., Bull Exp Biol Med 2003: epitalon and telomerase in human cells.'],
    setup: { defaultAmount: 5, syringeUnits: 100, schedule: (t) => daily('21:00', { course: { start: t, days: 20, remindAfterDays: 140 } }) },
  },
];

/** For all of them: supplies, mixing, injecting, checking a batch and getting help. */
export const BASICS: { title: string; points: string[] }[] = [
  { title: 'What you need', points: [
    'Bacteriostatic water (with 0.9% benzyl alcohol): it keeps a vial you use more than once clean. Sterile water is for a single use.',
    'Insulin syringes: U-100, 29–31 gauge, 8 mm or shorter. 0.3 mL (30 units) for small doses, 0.5 mL (50 units) or 1 mL (100 units) for bigger ones.',
    'A bigger syringe to add the water (e.g. 3 mL with a drawing-up needle), alcohol swabs and a sharps container.',
  ] },
  { title: 'Mixing a vial', points: [
    'Wash your hands. Swab the rubber tops of both vials and let them dry.',
    'Draw up the water, then let it run slowly down the inside wall of the peptide vial rather than onto the powder.',
    'Swirl gently or let it sit until clear. Shaking can damage peptides.',
    'Write the date and strength on the vial (or add it in the app: it works out the draw for you). Keep it in the fridge.',
  ] },
  { title: 'Injecting', points: [
    'A new syringe every time.',
    'Swab the vial and the skin, and let both dry.',
    'Pinch a fold of skin, go in at 45–90°, push slowly, wait a few seconds, then withdraw.',
    'Rotate sites, at least 2–3 cm from the last one, 5 cm from the navel, away from bruises, scars and moles.',
    'Straight into the sharps container without recapping.',
  ] },
  { title: 'Checking a batch', points: [
    'A third-party test report shows what’s in a batch: HPLC for purity, mass spec for identity, and ideally an endotoxin test.',
    'Mixed peptides are normally clear (GHK-Cu is blue). Cloudiness, bits or a colour change mean it has broken down.',
    'The app keeps the lot, supplier and purity for each vial, and compares results by batch on Protocol.',
  ] },
  { title: 'Get help', points: [
    'Swelling of the face, lips or throat, trouble breathing, or a widespread rash: call 000.',
    'Redness spreading out from a site, heat, pus or a fever: a doctor the same day.',
    'The Protocol report puts everything you take on one page, for any appointment.',
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

/** The step-up as planned changes from `start` ('YYYY-MM-DD'): each later step on its own date. */
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

/** How far the level falls between shots, as a share of its peak, if a shot were absorbed at once: 1 − 2^(−gap ÷ half-life).
 *  An upper bound: see steadySwing for the version with absorption. */
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
export function splitView(halfLifeHours: number | undefined, days: number[] | undefined, tmaxHours = 24): SplitView | null {
  if (!halfLifeHours || halfLifeHours < 24 || !days?.length) return null;
  const swing = steadySwing(halfLifeHours, weekGaps(days), tmaxHours);
  return days.length === 1
    ? { perWeek: 1, swing, other: { perWeek: 2, swing: steadySwing(halfLifeHours, [3, 4], tmaxHours) } }
    : { perWeek: days.length, swing, other: { perWeek: 1, swing: steadySwing(halfLifeHours, [7], tmaxHours) } };
}

/** The rate it's absorbed from under the skin, from the hours to its highest level after a shot (`tmax`), for a
 *  one-compartment model: tmax = ln(ka/ke) / (ka − ke), solved for ka. */
function absorptionRate(ke: number, tmaxHours: number): number {
  let lo = ke * 1.0001, hi = 50;
  for (let i = 0; i < 80; i++) { const ka = (lo + hi) / 2; const t = Math.log(ka / ke) / (ka - ke); if (t > tmaxHours) lo = ka; else hi = ka; }
  return (lo + hi) / 2;
}

/** How far the level falls from its highest to its lowest through a week once it's settled, with the shot absorbed over
 *  a day or so rather than all at once (the swing is smaller than the elimination alone would say). Equal doses at the
 *  given gaps (days), repeated for 12 weeks; the last week is measured. */
export function steadySwing(halfLifeHours: number, gapsDays: number[], tmaxHours = 24): number {
  const ke = Math.LN2 / halfLifeHours, ka = absorptionRate(ke, tmaxHours);
  const shots: number[] = [];
  for (let t = 0, i = 0; t < 12 * 168; t += gapsDays[i % gapsDays.length] * 24, i++) shots.push(t);
  const level = (t: number) => shots.reduce((sum, s) => (t >= s ? sum + (Math.exp(-ke * (t - s)) - Math.exp(-ka * (t - s))) : sum), 0);
  let hi = -Infinity, lo = Infinity;
  for (let t = 11 * 168; t < 12 * 168; t += 1) { const v = level(t); hi = Math.max(hi, v); lo = Math.min(lo, v); }
  return hi > 0 ? (hi - lo) / hi : 0;
}

/** The lowest-dose plan for a guide entry: step by `by` (a weekly amount, halved per shot when split) once loss slows. */
export function lowestPlan(g: GuideEntry, perWeek: number): { plan: StepPlan; criteria: StepUpCriteria } | null {
  if (!g.lowest) return null;
  return { plan: { by: g.lowest.by / Math.max(1, perWeek), max: g.lowest.max, maxPer: 'week', lowest: true }, criteria: LOWEST_STEP_UP };
}
