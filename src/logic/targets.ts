// Daily targets the app works out and keeps up to date from the person's own data: water, protein, fibre, steps,
// sleep, caffeine and calories. Each comes with a short reason. A target is automatic until the person sets their
// own number, and can go back to automatic at any time. Pure.
import type { AppSettings } from '../db/repos/settings';
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import { latestWeight, proteinTarget } from './energy';
import { stepsTarget } from './movement';
import { isStimulant } from './stimulant';
import { inGroup } from './interactions';
import { findLimit, type CaffeineDay } from './caffeine';

export type TargetKey = 'water' | 'protein' | 'fibre' | 'steps' | 'sleep' | 'caffeine' | 'calories';
export const TARGET_KEYS: TargetKey[] = ['water', 'protein', 'calories', 'fibre', 'steps', 'sleep', 'caffeine'];

export interface Suggestion { key: TargetKey; value: number; why: string }

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
  const onGlp = d.meds.some((m) => !m.archived && inGroup(m, 'glp1'));
  const onStim = d.meds.some((m) => !m.archived && isStimulant(m));

  // Water: about 35 mL for each kg, a little more for a very active month. (Shot days, training days and stimulant
  // days add their own on the day.)
  if (kg) {
    const active = recentDaily.filter((x) => typeof x.kcalActive === 'number').map((x) => x.kcalActive!);
    const busy = active.length >= 10 && mean(active) >= 600;
    const ml = Math.round(clamp(kg * 35 + (busy ? 250 : 0), 1800, 4000) / 50) * 50;
    out.water = { key: 'water', value: ml, why: `35 mL per kg of your ${Math.round(kg)} kg${busy ? ', plus a little for how active you are' : ''}` };
  } else out.water = { key: 'water', value: 2500, why: 'A usual amount; add your weight to tailor it' };

  // Protein: 1.6 g per kg of the goal weight (when lower than now), to keep muscle while losing.
  const p = proteinTarget(kg, d.goalKg);
  if (p) out.protein = { key: 'protein', value: p, why: `1.6 g per kg of ${d.goalKg && kg && d.goalKg < kg ? 'your goal weight' : 'your weight'}, to keep muscle${onGlp ? ' while appetite is low' : ''}` };

  // Fibre: 14 g per 1,000 Cal eaten, between 25 and 35 g.
  if (d.calorieKcal) out.fibre = { key: 'fibre', value: Math.round(clamp((d.calorieKcal / 1000) * 14, 25, 35)), why: `14 g per 1,000 Cal of your ${n0(d.calorieKcal)} Cal${onGlp ? '; it helps with constipation too' : ''}` };
  else out.fibre = { key: 'fibre', value: 30, why: 'The usual aim for adults' };

  // Steps: a little above the person's usual.
  const st = stepsTarget(d.daily, d.now);
  if (st) {
    const usual = median(recentDaily.filter((x) => x.steps).map((x) => x.steps!));
    out.steps = { key: 'steps', value: st, why: `10% above your usual ${n0(usual)} a day` };
  }

  // Sleep: how long you sleep before days you rate your energy 4 or 5 (12+ such days), else 8 hours.
  const energyBy = new Map<string, number>();
  for (const c of d.checkIns.filter((x) => live(x) && typeof x.energy === 'number')) {
    const k = new Date(c.at); const key = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
    energyBy.set(key, Math.max(energyBy.get(key) ?? 0, c.energy!));
  }
  const good = d.daily.filter((x) => live(x) && x.sleepMin && dayMs(x.date) > d.now - 60 * DAY && (energyBy.get(x.date) ?? 0) >= 4).map((x) => x.sleepMin! / 60);
  if (good.length >= 12) {
    const h = Math.round(clamp(median(good), 7, 9) * 2) / 2;
    out.sleep = { key: 'sleep', value: h, why: `What you sleep before your best-energy days (${good.length} days)` };
  } else out.sleep = { key: 'sleep', value: 8, why: 'Most adults do best on 7 to 9 hours' };

  // Caffeine: where your own data shows it starts to cost you, else 400 mg (300 with a stimulant: the effects add up).
  const lim = d.caffeineDays ? findLimit(d.caffeineDays) : undefined;
  if (lim?.status === 'found' && lim.value !== undefined && lim.value > 0) out.caffeine = { key: 'caffeine', value: Math.min(400, lim.value), why: `Above ${lim.value} mg your sleep or nerves are worse (${lim.nights} days)` };
  else out.caffeine = onStim ? { key: 'caffeine', value: 300, why: 'With a stimulant the effects add up' } : { key: 'caffeine', value: 400, why: 'The usual safe daily limit' };

  if (d.calorieKcal) out.calories = { key: 'calories', value: d.calorieKcal, why: 'From what you eat and how your weight changes' };
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
