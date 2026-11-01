// Daily targets the app works out and keeps up to date from the person's own data: water, protein, fibre, steps,
// sleep, caffeine and calories. Each comes with a short reason. A target is automatic until the person sets their
// own number, and can go back to automatic at any time. Pure.
import type { AppSettings } from '../db/repos/settings';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import { latestWeight, proteinTarget } from './energy';
import { stepsTarget } from './movement';
import { isStimulant } from './stimulant';
import { inGroup } from './interactions';
import { ingredientsOf } from './ingredients';
import { supplementsOf } from './supplements';
import { findLimit, type CaffeineDay } from './caffeine';

export type TargetKey = 'water' | 'protein' | 'fibre' | 'steps' | 'sleep' | 'caffeine' | 'calories';
export const TARGET_KEYS: TargetKey[] = ['water', 'protein', 'calories', 'fibre', 'steps', 'sleep', 'caffeine'];

/** `why` in a line; `parts` the base and each adjustment, e.g. ["35 mL per kg of your 92 kg", "+500 mL for Retatrutide"]. */
export interface Suggestion { key: TargetKey; value: number; why: string; parts: string[]; /** Names of what in the stack changed it. */ stack: string[] }

/** What in the person's stack changes a target, and why. Pure. */
export function stackOf(meds: Medication[]) {
  const active = meds.filter((m) => !m.archived);
  const named = (xs: Medication[]) => [...new Set(xs.map((m) => m.nickname?.trim() || m.name))].join(' and ');
  const has = (re: RegExp) => active.filter((m) => re.test([m.name, ...ingredientsOf(m).map((i) => i.name)].join(' ')));
  return {
    glp: active.filter((m) => inGroup(m, 'glp1') || inGroup(m, 'amylin')),
    stim: active.filter((m) => isStimulant(m)),
    creatine: active.filter((m) => supplementsOf(m).some((x) => x.key === 'creatine')),
    sglt2: has(/gliflozin/i),
    // Fluids set by a prescriber (a diuretic, lithium): the app doesn't push more water.
    fluidCare: active.filter((m) => inGroup(m, 'diuretic') || inGroup(m, 'lithium')),
    // Slow how fast caffeine is cleared.
    slowCaffeine: has(/fluvoxamine|ciprofloxacin|enoxacin/i),
    named,
  };
}

export interface TargetData {
  body: BodyEntry[]; goalKg?: number; daily: DailyHealth[]; workouts: Workout[]; meds: Medication[]; doses: Dose[]; checkIns: CheckIn[];
  caffeineDays?: CaffeineDay[]; calorieKcal?: number | null; now: number;
}

const DAY = 86_400_000;
const live = (x: { deletedAt?: string }) => !x.deletedAt;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dayMs = (ymd: string) => new Date(`${ymd}T12:00`).getTime();
const n0 = (v: number) => Math.round(v).toLocaleString('en-AU');

/** What each target would be, worked out from the person's data. A key is missing when there's nothing to go on. */
export function suggestTargets(d: TargetData): Partial<Record<TargetKey, Suggestion>> {
  const out: Partial<Record<TargetKey, Suggestion>> = {};
  const kg = latestWeight(d.body);
  const recentDaily = d.daily.filter((x) => live(x) && dayMs(x.date) > d.now - 28 * DAY && dayMs(x.date) < d.now - DAY / 2);
  const k = stackOf(d.meds);
  const make = (key: TargetKey, value: number, parts: string[], by: Medication[] = []): Suggestion =>
    ({ key, value, parts, why: parts.join(', '), stack: [...new Set(by.map((m) => m.nickname?.trim() || m.name))] });

  // Water from drinks: by weight, a little more for a very active month, and more for what's in the stack.
  {
    const parts: string[] = []; const by: Medication[] = [];
    let ml: number;
    // From drinks: about 25 mL per kg (food brings the rest). Well above the goal weight, an adjusted weight (the goal
    // plus 40% of the gap): fat needs little water, so the full weight overshoots.
    if (kg) {
      const ref = d.goalKg && d.goalKg < kg - 10 ? d.goalKg + 0.4 * (kg - d.goalKg) : kg;
      ml = ref * 25;
      parts.push(ref < kg ? `25 mL per kg of an adjusted ${Math.round(ref)} kg (your goal plus 40% of the gap)` : `25 mL per kg of your ${Math.round(kg)} kg`);
    } else { ml = 2000; parts.push('About 2 L from drinks (add your weight to tailor it)'); }
    const active = recentDaily.filter((x) => typeof x.kcalActive === 'number').map((x) => x.kcalActive!);
    if (active.length >= 10 && mean(active) >= 600) { ml += 250; parts.push('+250 mL for how active you are'); }
    if (k.fluidCare.length) { parts.push(`${k.named(k.fluidCare)}: your prescriber's fluid advice comes first`); by.push(...k.fluidCare); }
    else {
      by.push(...k.glp, ...k.creatine, ...k.sglt2, ...k.stim);
      if (k.glp.length) { ml += 500; parts.push(`+500 mL for ${k.named(k.glp)} (less thirst, and fluid lost with nausea)`); }
      if (k.creatine.length) { ml += 500; parts.push(`+500 mL for ${k.named(k.creatine)}`); }
      if (k.sglt2.length) { ml += 250; parts.push(`+250 mL for ${k.named(k.sglt2)}`); }
      if (k.stim.length) { ml += 250; parts.push(`+250 mL for ${k.named(k.stim)} (dry mouth)`); }
    }
    out.water = make('water', Math.round(clamp(ml, 1500, 3800) / 50) * 50, parts, by);
  }

  // Protein: 1.6 g per kg of the goal weight (when lower than now), to keep muscle while losing.
  const p = proteinTarget(kg, d.goalKg);
  if (p && kg) {
    const parts = [`1.6 g per kg of ${d.goalKg && d.goalKg < kg ? 'your goal weight' : 'your weight'}, to keep muscle`];
    let g = p;
    // Losing fast on a GLP-1: never under 1.2 g per kg of today's weight.
    const floor = Math.round((kg * 1.2) / 5) * 5;
    if (k.glp.length && floor > g) { g = floor; parts.push(`at least 1.2 g per kg of today's weight while on ${k.named(k.glp)}`); }
    else if (k.glp.length) parts.push(`it matters more on ${k.named(k.glp)}, with appetite low`);
    out.protein = make('protein', g, parts, k.glp);
  }

  // Fibre: 14 g per 1,000 Cal eaten, between 25 and 35 g.
  {
    const parts: string[] = [];
    let g: number;
    if (d.calorieKcal) { g = clamp((d.calorieKcal / 1000) * 14, 25, 35); parts.push(`14 g per 1,000 Cal of your ${n0(d.calorieKcal)} Cal`); } else { g = 30; parts.push('The usual aim for adults'); }
    if (k.glp.length) { g += 5; parts.push(`+5 g for ${k.named(k.glp)} (constipation is common; with the extra water)`); }
    out.fibre = make('fibre', Math.round(Math.min(g, 40)), parts, k.glp);
  }

  // Steps: a little above the person's usual.
  const st = stepsTarget(d.daily, d.now);
  if (st) {
    const usual = median(recentDaily.filter((x) => x.steps).map((x) => x.steps!));
    out.steps = make('steps', st, [`10% above your usual ${n0(usual)} a day`]);
  }

  // Sleep: how long you sleep before days you rate your energy 4 or 5 (12+ such days), else 8 hours.
  const energyBy = new Map<string, number>();
  for (const c of d.checkIns.filter((x) => live(x) && typeof x.energy === 'number')) {
    const t = new Date(c.at); const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    energyBy.set(key, Math.max(energyBy.get(key) ?? 0, c.energy!));
  }
  const good = d.daily.filter((x) => live(x) && x.sleepMin && dayMs(x.date) > d.now - 60 * DAY && (energyBy.get(x.date) ?? 0) >= 4).map((x) => x.sleepMin! / 60);
  if (good.length >= 12) {
    const h = Math.round(clamp(median(good), 7, 9) * 2) / 2;
    out.sleep = make('sleep', h, [`What you sleep before your best-energy days (${good.length} days)`]);
  } else out.sleep = make('sleep', 8, ['Most adults do best on 7 to 9 hours']);

  // Caffeine: where your own data shows it starts to cost you, else 400 mg; lower with a stimulant (the effects add up)
  // or a medicine that slows how fast caffeine is cleared.
  {
    const lim = d.caffeineDays ? findLimit(d.caffeineDays) : undefined;
    const parts: string[] = [];
    let mg: number;
    if (lim?.status === 'found' && lim.value !== undefined && lim.value > 0) { mg = Math.min(400, lim.value); parts.push(`Above ${lim.value} mg your sleep or nerves are worse (${lim.nights} days)`); }
    else { mg = 400; parts.push('The usual safe daily limit is 400 mg'); }
    if (k.stim.length && mg > 300) { mg = 300; parts.push(`300 mg with ${k.named(k.stim)}: the effects add up`); }
    if (k.slowCaffeine.length && mg > 200) { mg = 200; parts.push(`200 mg with ${k.named(k.slowCaffeine)}: it slows how fast caffeine is cleared`); }
    out.caffeine = make('caffeine', mg, parts, [...(mg <= 300 && k.stim.length ? k.stim : []), ...(mg <= 200 && k.slowCaffeine.length ? k.slowCaffeine : [])]);
  }

  if (d.calorieKcal) out.calories = make('calories', d.calorieKcal, ['From what you eat and how your weight changes']);
  return out;
}

/** The settings the targets read. */
export type TargetSettings = Pick<AppSettings, 'energyAuto' | 'energyTargetKcal' | 'stepsTargetOwn' | 'targetAuto' | 'waterTargetMl' | 'proteinTargetG' | 'fibreTargetG' | 'sleepTargetH' | 'caffeineLimitMg'>;

/** Where each target lives in settings. */
export const FIELD: Record<Exclude<TargetKey, 'calories'>, keyof TargetSettings & keyof AppSettings> = {
  water: 'waterTargetMl', protein: 'proteinTargetG', fibre: 'fibreTargetG', steps: 'stepsTargetOwn', sleep: 'sleepTargetH', caffeine: 'caffeineLimitMg',
};
/** The value a target had before it could be worked out (so a target never changed by the person counts as automatic). */
const FACTORY: Record<Exclude<TargetKey, 'calories'>, unknown> = { water: null, protein: null, fibre: 25, steps: null, sleep: 8, caffeine: 400 };

/** Is this target set by the app? The person's choice once made; before that, yes unless they changed the number. */
export function isAuto(st: TargetSettings, key: TargetKey): boolean {
  if (key === 'calories') return st.energyAuto;
  if (key === 'steps') return st.stepsTargetOwn === null;
  const chosen = st.targetAuto?.[key];
  if (chosen !== undefined) return chosen;
  const v = st[FIELD[key]];
  return v === FACTORY[key] || v === null;
}

/** The target in use now. */
export function currentTarget(st: TargetSettings, key: TargetKey, s: Partial<Record<TargetKey, Suggestion>>): number | null {
  if (key === 'calories') return st.energyTargetKcal;
  if (key === 'steps') return st.stepsTargetOwn ?? s.steps?.value ?? null;
  return (st[FIELD[key]] as number | null) ?? null;
}

/** Worth changing to: off by more than this much (so the target doesn't wobble). */
export function differs(key: TargetKey, a: number | null, b: number): boolean {
  if (a === null) return true;
  const step: Record<TargetKey, number> = { water: 150, protein: 10, fibre: 3, steps: 500, sleep: 0.5, caffeine: 50, calories: 100 };
  return Math.abs(a - b) >= step[key];
}

export const LABEL: Record<TargetKey, string> = { water: 'Water', protein: 'Protein', fibre: 'Fibre', steps: 'Steps', sleep: 'Sleep', caffeine: 'Caffeine limit', calories: 'Calories' };

/** "2.9 L", "150 g", "8,500", "7.5 h", "300 mg", "1,850 Cal". */
export function fmtTarget(key: TargetKey, v: number | null): string {
  if (v === null) return '—';
  switch (key) {
    case 'water': return `${Number((v / 1000).toFixed(2))} L`;
    case 'protein': case 'fibre': return `${Math.round(v)} g`;
    case 'steps': return n0(v);
    case 'sleep': { const h = Math.floor(v), m = Math.round((v - h) * 60); return m ? `${h} h ${m} min` : `${h} h`; }
    case 'caffeine': return `${Math.round(v)} mg`;
    case 'calories': return `${n0(v)} Cal`;
  }
}
