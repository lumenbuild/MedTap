// Step-up checklist: the criteria the person (or their prescriber) set for being ready for the next dose step,
// each ticked from their own records. Facts against their own criteria, no recommendation. Pure.
import type { BodyEntry, CheckIn, Dose, Medication, StepUpCriteria } from '../db/schema';
import { robustFit } from './forecast';
import { EFFECT_CHIPS } from './predict';
import { nextPlannedChange } from './plans';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** A starting point to edit: the GLP-1 labels' "at least 4 weeks on a dose", and settled side effects. */
export const DEFAULT_STEP_UP: StepUpCriteria = { minWeeks: 4, maxEffectPct: 30, maxLossKgWeek: 0.5, noMissedWeeks: 4 };

/** The lowest dose that works: at least 4 weeks on a dose, and loss slowed under 0.25 kg a week over 3 weeks, with side
 *  effects settled. While loss is faster than that, the dose stays. */
export const LOWEST_STEP_UP: StepUpCriteria = { minWeeks: 4, maxLossKgWeek: 0.25, maxEffectPct: 30 };

export interface StepCheck { key: keyof StepUpCriteria; label: string; ok: boolean | null; value: string }
export interface StepUpView { amount: number; since: number; checks: StepCheck[]; met: number; known: number; next?: { from: string; amount: number } }

export function stepUpChecklist(med: Medication, doses: Dose[], checkIns: CheckIn[], body: BodyEntry[], now: number, s: ScheduleSettings): StepUpView | null {
  const c = med.stepUp ?? DEFAULT_STEP_UP;
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const taken = mine.filter((d) => !d.skipped);
  if (!taken.length) return null;
  const amount = taken[taken.length - 1].amount;
  // Start of the current step: the first dose of this amount since the last different one.
  let i = taken.length - 1;
  while (i > 0 && taken[i - 1].amount === amount) i--;
  const since = Date.parse(taken[i].takenAt);
  const checks: StepCheck[] = [];

  if (c.minWeeks) {
    const w = (now - since) / WEEK;
    checks.push({ key: 'minWeeks', label: `${c.minWeeks}+ weeks on this dose`, ok: w >= c.minWeeks, value: `${Math.floor(w)} wk ${Math.floor((w % 1) * 7)} d` });
  }
  if (c.maxEffectPct !== undefined) {
    const cis = checkIns.filter((x) => !x.deletedAt && Date.parse(x.at) > now - 14 * DAY);
    const pct = cis.length >= 3 ? Math.round((cis.filter((x) => x.chips.some((ch) => EFFECT_CHIPS.includes(ch))).length / cis.length) * 100) : undefined;
    checks.push({ key: 'maxEffectPct', label: `Side effects in ≤${c.maxEffectPct}% of check-ins`, ok: pct === undefined ? null : pct <= c.maxEffectPct, value: pct === undefined ? 'Too few check-ins' : `${pct}% (2 wk)` });
  }
  if (c.maxLossKgWeek !== undefined) {
    const pts = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T08:00`).getTime(), v: b.weightKg! }))
      .filter((p) => p.t > now - 21 * DAY).sort((a, b) => a.t - b.t);
    const f = pts.length >= 4 ? robustFit(pts, now) : undefined;
    const loss = f ? -f.slope * 7 : undefined;
    checks.push({ key: 'maxLossKgWeek', label: `Losing ≤${c.maxLossKgWeek} kg a week`, ok: loss === undefined ? null : loss <= c.maxLossKgWeek,
      value: loss === undefined ? 'Too few weigh-ins' : `${loss >= 0 ? '−' : '+'}${Math.abs(Math.round(loss * 100) / 100)} kg/wk` });
  }
  if (c.minAppetite !== undefined) {
    const xs = checkIns.filter((x) => !x.deletedAt && typeof x.appetite === 'number' && Date.parse(x.at) > now - 14 * DAY).map((x) => x.appetite!);
    const a = xs.length >= 3 ? Math.round((xs.reduce((p, q) => p + q, 0) / xs.length) * 10) / 10 : undefined;
    checks.push({ key: 'minAppetite', label: `Appetite ≥${c.minAppetite} of 5`, ok: a === undefined ? null : a >= c.minAppetite, value: a === undefined ? 'Too few check-ins' : `${a} (2 wk)` });
  }
  if (c.noMissedWeeks) {
    const from = now - c.noMissedWeeks * WEEK;
    const skipped = mine.filter((d) => d.skipped && Date.parse(d.takenAt) > from).length;
    // A gap well over the usual interval counts as missed too.
    const t = taken.filter((d) => Date.parse(d.takenAt) > from - 14 * DAY).map((d) => Date.parse(d.takenAt));
    const gaps = t.slice(1).map((x, k) => x - t[k]);
    const usual = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : undefined;
    const long = usual ? gaps.filter((g, k) => t[k + 1] > from && g > usual * 1.6).length : 0;
    const missed = skipped + long;
    checks.push({ key: 'noMissedWeeks', label: `No missed shots in ${c.noMissedWeeks} weeks`, ok: missed === 0, value: missed ? `${missed} missed` : 'None' });
  }
  const next = nextPlannedChange(med, dayKey(now, s));
  const known = checks.filter((x) => x.ok !== null).length;
  return { amount, since, checks, met: checks.filter((x) => x.ok).length, known, next: next ? { from: next.from, amount: next.defaultAmount } : undefined };
}
