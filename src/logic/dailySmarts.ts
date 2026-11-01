// Daily predictions: the one change that would move things most this week, tonight's sleep (and so tomorrow's
// readiness) from today so far, foods that close the protein gap, and signs of running dry. From the person's own
// records; population figures only where there isn't enough of theirs. Never about medicine timing or doses. Pure.
import type { CheckIn, DailyHealth, Dose, Food, FoodLog, Medication } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { getDayBounds } from './schedule';
import { dayKey } from './stats';
import { bedtimeOf, intakesOf, level, LOW_MG } from './caffeine';
import { isStimulant } from './stimulant';
import { inGroup } from './interactions';
import { COMMON_FOODS } from './commonFoods';
import type { LeanForecast, WeightTrend } from './bodyModel';

const DAY = 86_400_000, HOUR = 3_600_000;
const live = (x: { deletedAt?: string }) => !x.deletedAt;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const ms = (ymd: string) => new Date(`${ymd}T12:00`).getTime();
const ymdOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hm = (min: number) => { const h = Math.floor(Math.abs(min) / 60), m = Math.round(Math.abs(min) % 60); return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`; };

// ── Tonight's sleep ─────────────────────────────────────────────────────────────────────────────────

export interface SleepForecast { minutes: number; usual: number; reasons: { text: string; min: number }[]; tip?: string; lowTomorrow: boolean }

interface SleepIn { daily: DailyHealth[]; checkIns: CheckIn[]; foodLogs: FoodLog[]; doses: Dose[]; meds: Medication[]; bedtime: string; halfLifeH: number }

/** Tonight's sleep: the usual night, moved by what today holds that has gone with shorter nights before (caffeine still
 *  in you at bedtime, alcohol, a stimulant taken late), each by the person's own difference where there are 5+ nights
 *  each way, else a typical one. Shown from midday. */
export function sleepForecast(d: SleepIn, now: number, s: ScheduleSettings): SleepForecast | null {
  const nights = d.daily.filter((x) => live(x) && x.sleepMin && ms(x.date) > now - 60 * DAY && ms(x.date) < now - DAY / 2);
  if (nights.length < 7) return null;
  const usual = median(nights.slice(-28).map((x) => x.sleepMin!));
  const intakes = intakesOf(d.checkIns, d.foodLogs);
  const stim = new Set(d.meds.filter((m) => !m.archived && isStimulant(m)).map((m) => m.id));
  // For a day: did it hold each factor? (Sleep that night is recorded on the next day.)
  const factors = (day: string) => {
    const start = getDayBounds(ms(day), s.dayStartsAt, s.tz).start;
    const bed = bedtimeOf(start + 12 * HOUR, d.bedtime, s);
    return {
      caffeine: level(intakes.filter((x) => x.t < bed), bed, d.halfLifeH) >= LOW_MG,
      alcohol: d.checkIns.some((c) => live(c) && Date.parse(c.at) >= start && Date.parse(c.at) < start + DAY && c.chips.some((x) => /alcohol|drink/i.test(x))),
      lateStim: d.doses.some((x) => live(x) && !x.skipped && stim.has(x.medicationId) && Date.parse(x.takenAt) >= start + 10 * HOUR && Date.parse(x.takenAt) < start + DAY),
    };
  };
  const byNight = new Map(nights.map((x) => [x.date, x.sleepMin!]));
  const history = [...byNight].map(([date, min]) => ({ min, f: factors(ymdOf(ms(date) - DAY)) }));
  const PRIOR = { caffeine: -20, alcohol: -15, lateStim: -25 };
  const TEXT = { caffeine: 'caffeine still in you at bedtime', alcohol: 'alcohol today', lateStim: 'a stimulant taken after 2 pm' };
  const effect = (k: keyof typeof PRIOR) => {
    const w = history.filter((h) => h.f[k]).map((h) => h.min), wo = history.filter((h) => !h.f[k]).map((h) => h.min);
    return w.length >= 5 && wo.length >= 5 ? Math.min(0, mean(w) - mean(wo)) : PRIOR[k];
  };
  const today = factors(dayKey(now, s));
  const reasons = (Object.keys(PRIOR) as (keyof typeof PRIOR)[]).filter((k) => today[k]).map((k) => ({ text: TEXT[k], min: Math.round(effect(k)) })).filter((r) => r.min <= -5);
  const minutes = Math.round(usual + reasons.reduce((a, r) => a + r.min, 0));
  const bed = bedtimeOf(now, d.bedtime, s);
  const tip = !today.caffeine && level(intakes, bed, d.halfLifeH) < LOW_MG && bed - now > 6 * HOUR ? 'Keep it that way: no caffeine from here keeps tonight on track.'
    : today.caffeine ? 'No more caffeine today; a wind-down at bedtime helps.' : undefined;
  return { minutes, usual: Math.round(usual), reasons, tip, lowTomorrow: usual - minutes >= 40 };
}

export const fmtSleep = hm;

// ── Close the protein gap ───────────────────────────────────────────────────────────────────────────

export interface ProteinGap { gap: number; kcalLeft?: number; picks: { name: string; protein: number; kcal: number; serving?: string }[]; /** The picks go a little over today's calories (protein matters more on a cut). */ over: boolean }

/** From midday, 20 g or more short: foods that close most of the gap in the calories left, best protein per calorie
 *  first, the person's own foods ahead of others. One food, or two together. */
export function proteinGap(proteinSoFar: number, target: number | null, kcalSoFar: number, kcalTarget: number | null, foods: Food[], now: number, s: ScheduleSettings): ProteinGap | null {
  if (!target) return null;
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  if (now - start < 8 * HOUR) return null;
  const gap = Math.round(target - proteinSoFar);
  if (gap < 20) return null;
  const kcalLeft = kcalTarget ? Math.max(0, kcalTarget - kcalSoFar) : undefined;
  // Protein matters more than the last few calories on a cut: up to 300 Cal over today's target.
  const room = kcalLeft !== undefined ? kcalLeft + 300 : undefined;
  type C = { name: string; protein: number; kcal: number; serving?: string; mine: boolean };
  const own: C[] = foods.filter((f) => live(f) && (f.nutrients.protein ?? 0) >= 10 && (f.nutrients.kcal ?? 0) > 0)
    .map((f) => ({ name: f.name, protein: f.nutrients.protein!, kcal: f.nutrients.kcal!, serving: f.serving, mine: true }));
  const common: C[] = COMMON_FOODS.filter((c) => ['whey', 'greek-yoghurt', 'tuna-can', 'chicken-breast', 'cottage', 'protein-bar', 'egg', 'white-fish', 'prawns'].includes(c.id))
    .map((c) => ({ name: c.name, protein: c.n.protein!, kcal: c.n.kcal!, serving: c.serving, mine: false }));
  const cands = [...own, ...common.filter((c) => !own.some((o) => o.name.toLowerCase() === c.name.toLowerCase()))]
    .filter((c) => c.protein / c.kcal >= 0.07 && (room === undefined || c.kcal <= room));
  if (!cands.length) return { gap, kcalLeft, picks: [], over: false };
  const score = (cs: C[]) => { const p = cs.reduce((a, c) => a + c.protein, 0), k = cs.reduce((a, c) => a + c.kcal, 0);
    return Math.min(p, gap) / gap * 10 + (p / k) * 20 + cs.filter((c) => c.mine).length - (room !== undefined && k > room ? 100 : 0) - (kcalLeft !== undefined && k > kcalLeft ? 2 : 0); };
  let best: C[] = [];
  const scoreOf = (cs: C[]) => (cs.length ? score(cs) : -Infinity);
  for (const a of cands) {
    if (score([a]) > scoreOf(best)) best = [a];
    if (a.protein < gap * 0.8) for (const b of cands) if (b !== a && score([a, b]) > scoreOf(best) + 1) best = [a, b];
  }
  const k = best.reduce((a, c) => a + c.kcal, 0);
  return { gap, kcalLeft, picks: best.map(({ mine: _m, ...c }) => ({ ...c, protein: Math.round(c.protein), kcal: Math.round(c.kcal) })), over: kcalLeft !== undefined && k > kcalLeft };
}

// ── Running dry ─────────────────────────────────────────────────────────────────────────────────────

export interface Hydration { signs: string[]; urgent: boolean }

/** Body signs (resting heart rate up 5+, weight down 1%+ overnight, vomiting or diarrhoea) with what raises the risk
 *  (a GLP-1 shot in the last 2 days, little water logged by the afternoon): at least one sign and two in all. */
export function hydrationWatch(d: { daily: DailyHealth[]; body: { date: string; weightKg?: number; deletedAt?: string }[]; checkIns: CheckIn[]; doses: Dose[]; meds: Medication[] }, waterTarget: number | null, now: number, s: ScheduleSettings): Hydration | null {
  const today = dayKey(now, s), yest = ymdOf(ms(today) - DAY);
  const row = d.daily.find((x) => live(x) && x.date === today);
  const usualRhr = d.daily.filter((x) => live(x) && x.restingHr && x.date < today && ms(x.date) > now - 21 * DAY).map((x) => x.restingHr!);
  const body: string[] = [], risk: string[] = [];
  if (row?.restingHr && usualRhr.length >= 7 && row.restingHr - median(usualRhr) >= 5) body.push(`resting heart rate ${row.restingHr} bpm (usually ${Math.round(median(usualRhr))})`);
  const w = (k: string) => d.body.find((b) => live(b) && b.date === k && typeof b.weightKg === 'number')?.weightKg;
  const wt = w(today), wy = w(yest);
  if (wt && wy && (wy - wt) / wy >= 0.01) body.push(`${Math.round((wy - wt) * 10) / 10} kg lighter than yesterday`);
  const gi = d.checkIns.some((c) => live(c) && Date.parse(c.at) > now - DAY && c.chips.some((x) => /vomit|diarrh/i.test(x)));
  if (gi) body.push('vomiting or diarrhoea');
  const glp = new Set(d.meds.filter((m) => !m.archived && inGroup(m, 'glp1')).map((m) => m.id));
  if (d.doses.some((x) => live(x) && !x.skipped && glp.has(x.medicationId) && Date.parse(x.takenAt) > now - 2 * DAY && Date.parse(x.takenAt) <= now)) risk.push('a shot in the last 2 days');
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const drunk = (row?.waterMl ?? 0) + (row?.waterOtherMl ?? 0);
  if (waterTarget && now - start >= 10 * HOUR && drunk < waterTarget * 0.4) risk.push(`${(drunk / 1000).toFixed(1)} L of water so far`);
  if (!body.length || body.length + risk.length < 2) return null;
  return { signs: [...body, ...risk], urgent: gi && body.length >= 2 };
}

// ── The biggest lever ───────────────────────────────────────────────────────────────────────────────

export interface Lever { title: string; detail: string }

/** The one change most likely to move things this week, then up to two more: keeping muscle when much of the loss is
 *  likely to be lean, more steps when the pace is slow, an earlier caffeine cut-off when late caffeine costs sleep,
 *  more sleep when it's short. */
export function levers(x: { trend: WeightTrend | null; lean: LeanForecast | null; daily: DailyHealth[]; sleepTargetH: number; lateCaffeineDays?: number; caffeineCostMin?: number; cutoff?: string }, now: number): Lever[] {
  const out: (Lever & { rank: number })[] = [];
  const W = x.trend?.trend;
  if (x.lean && x.lean.levers.length && x.lean.share >= 0.2 && x.lean.better !== undefined) {
    const kept = Math.round((x.lean.share - x.lean.better) * 10 * 10) / 10;
    out.push({ rank: x.lean.share >= 0.3 ? 100 : 70, title: `Keep the muscle: ${x.lean.levers[0]}`,
      detail: `About ${Math.round(x.lean.share * 100)}% of your next 10 kg is likely to be muscle${x.lean.raising.length ? ` (${x.lean.raising.join(', ')})` : ''}. With ${x.lean.levers.join(' and ')}, about ${Math.round(x.lean.better * 100)}%: roughly ${kept} kg more muscle kept.` });
  }
  const steps = x.daily.filter((d) => live(d) && d.steps && ms(d.date) > now - 14 * DAY && ms(d.date) < now - DAY / 2).map((d) => d.steps!);
  if (W && steps.length >= 7 && mean(steps) < 9000) {
    const kcal = Math.round(0.0005 * W * 2000);
    const perWeek = Math.round(((kcal * 7) / 7700) * 100) / 100;
    out.push({ rank: x.trend && x.trend.perWeek > -0.4 ? 80 : 50, title: '2,000 more steps a day',
      detail: `You average ${Math.round(mean(steps)).toLocaleString('en-AU')}. 2,000 more burns about ${kcal} Cal a day at your weight: about ${perWeek} kg a week more, ${Math.round(perWeek * 52)} kg over a year.` });
  }
  if (x.lateCaffeineDays && x.lateCaffeineDays >= 2 && x.caffeineCostMin && x.caffeineCostMin >= 15 && x.cutoff)
    out.push({ rank: 60, title: `Caffeine before ${x.cutoff}`, detail: `On ${x.lateCaffeineDays} of the last 7 days you had some after ${x.cutoff}; those nights run about ${x.caffeineCostMin} min shorter for you.` });
  const sleep = x.daily.filter((d) => live(d) && d.sleepMin && ms(d.date) > now - 14 * DAY).map((d) => d.sleepMin!);
  if (sleep.length >= 7 && mean(sleep) < x.sleepTargetH * 60 - 30)
    out.push({ rank: 55, title: `${hm(Math.max(15, Math.round((x.sleepTargetH * 60 - mean(sleep)) / 15) * 15))} more sleep a night`, detail: `You average ${hm(mean(sleep))} against ${hm(x.sleepTargetH * 60)}. Short nights raise hunger the next day and slow recovery from training.` });
  return out.sort((a, b) => b.rank - a.rank).slice(0, 3).map(({ rank: _r, ...l }) => l);
}
