// Training (MedTap): personal bests, what to aim for next session, plateaus, strength forecasts, weekly sets per
// muscle, the training calendar, readiness, lean mass while losing weight, strength against the peptide, plates and
// cardio. Pure; `now` is passed in. From the person's own logs; suggestions are about training load, never medicine.
import type { BodyEntry, CardioActivity, CheckIn, DailyHealth, Dose, FitnessGoal, Medication, MuscleGroup, RoutineItem, Workout, WorkoutSet } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { getDayBounds, weekdayOf } from './schedule';
import { forecast, seriesOf, type Forecast, type Pt } from './forecast';
import { dayKey, ymdToMs } from './stats';
import { MUSCLES, type ExerciseDef } from './exercises';
import { stepReport, dayStartOffset } from './protocol';
import type { Units } from '../db/repos/settings';
import { fmtLoad, fromLoad, loadUnit, PLATES_KG, PLATES_LB, roundLoad, showLoad, stepIn } from './load';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const r = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : undefined; };
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const t0 = (w: Workout) => Date.parse(w.startedAt);
export const working = (sets: WorkoutSet[]) => sets.filter((s) => s.done && !s.warmup && s.reps > 0);

/** Estimated one-rep max (Epley). Above 12 reps it's rough, so it's capped there. */
export const e1rm = (kg: number, reps: number) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + Math.min(reps, 12) / 30));

/** Round to a multiple of `step` (kg). */
export const roundTo = (kg: number, step: number) => (step > 0 ? Math.round(kg / step) * step : kg);

export interface Session { workoutId: string; t: number; sets: WorkoutSet[] }

/** Each session's working sets of one exercise, oldest first. */
export function sessionsOf(exerciseId: string, workouts: Workout[]): Session[] {
  return workouts.filter(live).map((w) => ({ workoutId: w.id, t: t0(w), sets: working(w.sets.filter((s) => s.exerciseId === exerciseId)) }))
    .filter((x) => x.sets.length).sort((a, b) => a.t - b.t);
}

// ── Personal bests ──────────────────────────────────────────────────────────────────────────────────

export interface PBs {
  heaviest?: { kg: number; reps: number; t: number };
  e1rm?: { v: number; kg: number; reps: number; t: number };
  mostReps?: { reps: number; kg: number; t: number };
  volume?: { kg: number; t: number };
  /** Best reps at each weight lifted. */
  repsAt: { kg: number; reps: number; t: number }[];
}

export function personalBests(exerciseId: string, workouts: Workout[], before = Infinity): PBs {
  const out: PBs = { repsAt: [] };
  const byKg = new Map<number, { reps: number; t: number }>();
  for (const s of sessionsOf(exerciseId, workouts).filter((x) => x.t < before)) {
    const vol = s.sets.reduce((n, x) => n + x.weightKg * x.reps, 0);
    if (vol > 0 && (!out.volume || vol > out.volume.kg)) out.volume = { kg: r(vol, 0), t: s.t };
    for (const x of s.sets) {
      if (!out.heaviest || x.weightKg > out.heaviest.kg || (x.weightKg === out.heaviest.kg && x.reps > out.heaviest.reps)) out.heaviest = { kg: x.weightKg, reps: x.reps, t: s.t };
      const e = e1rm(x.weightKg, x.reps);
      if (x.weightKg > 0 && (!out.e1rm || e > out.e1rm.v)) out.e1rm = { v: r(e), kg: x.weightKg, reps: x.reps, t: s.t };
      if (!out.mostReps || x.reps > out.mostReps.reps) out.mostReps = { reps: x.reps, kg: x.weightKg, t: s.t };
      const b = byKg.get(x.weightKg);
      if (!b || x.reps > b.reps) byKg.set(x.weightKg, { reps: x.reps, t: s.t });
    }
  }
  out.repsAt = [...byKg].map(([kg, v]) => ({ kg, ...v })).sort((a, b) => b.kg - a.kg);
  return out;
}

export interface NewPB { exerciseId: string; kind: 'e1rm' | 'heaviest' | 'reps' | 'volume'; text: string }

/** Personal bests set in one workout, against everything before it. */
export function newPBs(w: Workout, workouts: Workout[], defs: ExerciseDef[], units: Units = 'metric'): NewPB[] {
  const f = (kg: number) => fmtLoad(kg, units);
  const out: NewPB[] = [];
  const ids = [...new Set(working(w.sets).map((s) => s.exerciseId))];
  for (const id of ids) {
    const before = personalBests(id, workouts, t0(w));
    if (!before.heaviest) continue; // the first time isn't a "best"
    const sets = working(w.sets.filter((s) => s.exerciseId === id));
    const def = defs.find((d) => d.id === id);
    const top = sets.reduce((a, b) => (e1rm(b.weightKg, b.reps) > e1rm(a.weightKg, a.reps) ? b : a));
    const heavy = sets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a));
    if (heavy.weightKg > before.heaviest.kg) out.push({ exerciseId: id, kind: 'heaviest', text: `Heaviest: ${f(heavy.weightKg)} × ${heavy.reps}` });
    else if (before.e1rm && top.weightKg > 0 && e1rm(top.weightKg, top.reps) > before.e1rm.v + 0.05) out.push({ exerciseId: id, kind: 'e1rm', text: `Best estimated max: ${f(e1rm(top.weightKg, top.reps))} (${showLoad(top.weightKg, units)} × ${top.reps})` });
    for (const x of sets) {
      const prev = before.repsAt.filter((p) => p.kg >= x.weightKg).reduce((m, p) => Math.max(m, p.reps), 0);
      if (prev > 0 && x.reps > prev && !out.some((o) => o.exerciseId === id && o.kind === 'reps')) {
        out.push({ exerciseId: id, kind: 'reps', text: def?.timed ? `Longest: ${x.reps} s${x.weightKg ? ` at ${f(x.weightKg)}` : ''}` : `Most reps at ${!x.weightKg ? 'bodyweight' : f(x.weightKg)}: ${x.reps}` });
      }
    }
    const vol = sets.reduce((n, x) => n + x.weightKg * x.reps, 0);
    if (!def?.timed && before.volume && vol > before.volume.kg) out.push({ exerciseId: id, kind: 'volume', text: `Most volume: ${showLoad(vol * (def?.perHand ? 2 : 1), units).toLocaleString('en-AU', { maximumFractionDigits: 0 })} ${loadUnit(units)}` });
  }
  return out;
}

// ── Next session ────────────────────────────────────────────────────────────────────────────────────

export interface Target { sets: number; reps: number; weightKg: number; why: 'up' | 'reps' | 'same' | 'deload' | 'start' }

/** What to aim for next time: the routine's sets and reps; go up when every working set hit the reps and none was
 *  very hard (RPE 9+); a rep more when the weight can't go up; ease off 10% after two sessions in a row well short. */
export function nextTarget(def: ExerciseDef, workouts: Workout[], item?: RoutineItem, units: Units = 'metric'): Target {
  const ss = sessionsOf(def.id, workouts);
  const last = ss[ss.length - 1];
  if (!last) return { sets: item?.sets ?? 3, reps: item?.reps ?? (def.timed ? 30 : 8), weightKg: item?.weightKg ?? 0, why: 'start' };
  const top = Math.max(...last.sets.map((s) => s.weightKg));
  const atTop = last.sets.filter((s) => s.weightKg === top);
  const reps = item?.reps ?? Math.max(...atTop.map((s) => s.reps));
  const sets = item?.sets ?? atTop.length;
  const short = (x: Session) => { const t = Math.max(...x.sets.map((s) => s.weightKg)); return x.sets.filter((s) => s.weightKg === t).some((s) => s.reps <= reps - (def.timed ? 10 : 2)); };
  const prev = ss[ss.length - 2];
  if (short(last) && prev && short(prev) && Math.max(...prev.sets.map((s) => s.weightKg)) === top) {
    if (top > 0) return { sets, reps, weightKg: roundLoad(top * 0.9, def, units), why: 'deload' };
    return { sets, reps: Math.max(1, Math.round(reps * 0.8)), weightKg: 0, why: 'deload' };
  }
  const hit = atTop.length >= sets && atTop.every((s) => s.reps >= reps);
  const hard = atTop.some((s) => (s.rpe ?? 0) >= 9);
  // A rep range (double progression): a rep more each time every set gets there, up to the top of the range; then a
  // step up in weight, back to the bottom of the range.
  if (item?.repsMax && item.repsMax > item.reps && !def.timed && top > 0 && stepIn(def, units) > 0) {
    const low = Math.min(...atTop.map((s) => s.reps));
    const full = atTop.length >= sets && !hard;
    if (full && low >= item.repsMax) return { sets, reps: item.reps, weightKg: roundLoad(fromLoad(showLoad(top, units) + stepIn(def, units), units), def, units), why: 'up' };
    if (full && low >= item.reps) return { sets, reps: Math.min(item.repsMax, low + 1), weightKg: top, why: 'reps' };
    return { sets, reps: Math.max(item.reps, low), weightKg: top, why: 'same' };
  }
  if (hit && !hard) {
    // Held for time: 5 seconds more. Weighted: one step up, in the unit the person loads, onto a loadable weight (so
    // history logged in kg still lands on whole lb steps after switching). Otherwise a rep more.
    if (def.timed) return { sets, reps: reps + 5, weightKg: top, why: 'reps' };
    if (stepIn(def, units) > 0 && (top > 0 || !def.bodyweight)) return { sets, reps, weightKg: roundLoad(fromLoad(showLoad(top, units) + stepIn(def, units), units), def, units), why: 'up' };
    return { sets, reps: reps + 1, weightKg: top, why: 'reps' };
  }
  return { sets, reps, weightKg: top, why: 'same' };
}

/** How long to rest after a set, starting from the person's own setting: longer after heavy sets of big lifts and
 *  very hard sets, shorter for small muscles, and almost none between the two halves of a superset. */
export function restFor(def: Pick<ExerciseDef, 'compound' | 'timed'>, set: Pick<WorkoutSet, 'reps' | 'rpe' | 'weightKg'>, base: number, supersetNext = false): { seconds: number; why: string } {
  if (base <= 0) return { seconds: 0, why: '' };
  if (supersetNext) return { seconds: 15, why: 'superset: straight to the next one' };
  let s = base, why = '';
  if (def.compound && !def.timed && set.weightKg > 0 && set.reps <= 5) { s = Math.max(base, 180); why = 'heavy set'; }
  else if (!def.compound) { s = Math.min(base, 90); why = 'smaller muscle'; }
  if ((set.rpe ?? 0) >= 9) { s += 30; why = why ? `${why}, very hard` : 'very hard set'; }
  else if (set.rpe !== undefined && set.rpe <= 7) { s = Math.max(45, s - 15); why = why || 'felt easy'; }
  return { seconds: s, why };
}

// ── Plateaus and forecasts ──────────────────────────────────────────────────────────────────────────

/** Best estimated max each session. */
export const e1rmSeries = (exerciseId: string, workouts: Workout[]): Pt[] =>
  sessionsOf(exerciseId, workouts).map((s) => {
    // With no weight (push-ups, a plank) the best reps or seconds stand in for strength.
    const e = Math.max(...s.sets.map((x) => e1rm(x.weightKg, x.reps)));
    return { t: s.t, v: r(e > 0 ? e : Math.max(...s.sets.map((x) => x.reps))) };
  }).filter((p) => p.v > 0);

export interface Plateau { exerciseId: string; weeks: number; best: number; harder: boolean }

/** A lift that hasn't improved for 3+ weeks (best estimated max within 1% of the 3 weeks before), or feels harder at the
 *  same weight (RPE up by 1+). 4+ sessions needed. */
export function plateau(exerciseId: string, workouts: Workout[], now: number): Plateau | null {
  const pts = e1rmSeries(exerciseId, workouts).filter((p) => p.t > now - 8 * WEEK);
  if (pts.length < 4) return null;
  const recent = pts.filter((p) => p.t > now - 3 * WEEK), before = pts.filter((p) => p.t <= now - 3 * WEEK && p.t > now - 6 * WEEK);
  const ss = sessionsOf(exerciseId, workouts).filter((s) => s.t > now - 6 * WEEK);
  const rpeAt = (xs: Session[]) => avg(xs.flatMap((s) => s.sets.filter((x) => x.rpe !== undefined).map((x) => x.rpe!)));
  const top = Math.max(...ss.map((s) => Math.max(...s.sets.map((x) => x.weightKg))));
  const atTop = ss.filter((s) => s.sets.some((x) => x.weightKg === top));
  const half = Math.floor(atTop.length / 2);
  const ra = rpeAt(atTop.slice(0, half)), rb = rpeAt(atTop.slice(half));
  const harder = ra !== undefined && rb !== undefined && half >= 2 && rb - ra >= 1;
  const flat = recent.length >= 2 && before.length >= 2 && Math.max(...recent.map((p) => p.v)) <= Math.max(...before.map((p) => p.v)) * 1.01;
  if (!flat && !harder) return null;
  return { exerciseId, weeks: flat ? 3 : 0, best: Math.max(...pts.map((p) => p.v)), harder };
}

/** When the estimated max is likely to reach `targetKg`, from the last 10 weeks (same method as the weight goal). */
export function strengthForecast(exerciseId: string, workouts: Workout[], targetKg: number, now: number): Forecast {
  const pts = e1rmSeries(exerciseId, workouts).filter((p) => p.t > now - 10 * WEEK);
  const first = pts[0];
  return forecast(pts, { metric: 'weightKg', target: targetKg, start: first?.v ?? 0, startDate: first ? new Date(first.t).toISOString().slice(0, 10) : '2000-01-01' }, now);
}

// ── Weekly sets, balance and the calendar ───────────────────────────────────────────────────────────

export interface Balance { byMuscle: { id: MuscleGroup; name: string; sets: number }[]; push: number; pull: number; upper: number; lower: number; sessions: number }

/** Working sets in the last 7 days per muscle (1 for the main muscle, ½ for the others), and push/pull, upper/lower. */
export function weeklyBalance(workouts: Workout[], defs: ExerciseDef[], now: number): Balance {
  const ws = workouts.filter((w) => live(w) && t0(w) > now - WEEK && t0(w) <= now);
  const by = new Map<MuscleGroup, number>();
  let push = 0, pull = 0, upper = 0, lower = 0;
  for (const s of ws.flatMap((w) => working(w.sets))) {
    const d = defs.find((x) => x.id === s.exerciseId);
    if (!d) continue;
    d.muscles.forEach((m, i) => by.set(m, (by.get(m) ?? 0) + (i === 0 ? 1 : 0.5)));
    if (d.pattern === 'push') push++; else if (d.pattern === 'pull') pull++;
    if (MUSCLES.find((m) => m.id === d.muscles[0])?.upper) upper++; else lower++;
  }
  return { byMuscle: MUSCLES.map((m) => ({ id: m.id, name: m.name, sets: r(by.get(m.id) ?? 0) })), push, pull, upper, lower, sessions: ws.length };
}

export interface Calendar { weeks: { start: number; sessions: number }[]; streak: number; thisWeek: number }

/** Sessions each week (Monday start) for `weeks` weeks, and how many weeks in a row met the target. */
export function trainingCalendar(workouts: Workout[], now: number, s: ScheduleSettings, perWeek: number, weeks = 12): Calendar {
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const back = (weekdayOf(today, s) + 6) % 7;
  const out: Calendar['weeks'] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = dayStartOffset(now, -back - 7 * w, s), end = dayStartOffset(now, -back - 7 * (w - 1), s);
    out.push({ start, sessions: workouts.filter((x) => live(x) && t0(x) >= start && t0(x) < end).length });
  }
  let streak = 0;
  for (let i = out.length - 2; i >= 0 && perWeek > 0 && out[i].sessions >= perWeek; i--) streak++;
  const thisWeek = out[out.length - 1].sessions;
  if (perWeek > 0 && thisWeek >= perWeek) streak++;
  return { weeks: out, streak, thisWeek };
}

// ── Readiness ───────────────────────────────────────────────────────────────────────────────────────

export interface Readiness { score: number; label: 'Ready' | 'OK' | 'Take it easy'; parts: { what: string; text: string; good: boolean }[] }

/** Today against the person's own last 4 weeks: last night's sleep, resting heart rate and heart rate variability
 *  (from Health Connect / Apple Health), and soreness from a check-in today. Needs at least one of them. */
export function readiness(daily: DailyHealth[], checkIns: CheckIn[], now: number, s: ScheduleSettings): Readiness | null {
  const todayK = dayKey(now, s);
  const rows = daily.filter(live).sort((a, b) => a.date.localeCompare(b.date));
  const today = rows.find((d) => d.date === todayK);
  const base = rows.filter((d) => d.date < todayK && ymdToMs(d.date) > now - 29 * DAY);
  const b = (k: 'sleepMin' | 'restingHr' | 'hrvMs') => median(base.map((d) => d[k]).filter((x): x is number => typeof x === 'number'));
  const parts: Readiness['parts'] = [];
  let score = 70;
  const sl = today?.sleepMin, bs = b('sleepMin');
  if (sl !== undefined && bs) { const d = (sl - bs) / bs; score += 60 * Math.max(-0.4, Math.min(0.3, d)); parts.push({ what: 'Sleep', text: `${r(sl / 60)} h (usually ${r(bs / 60)})`, good: d >= -0.1 }); }
  const hr = today?.restingHr, bh = b('restingHr');
  if (hr !== undefined && bh) { const d = (bh - hr) / bh; score += 150 * Math.max(-0.15, Math.min(0.1, d)); parts.push({ what: 'Resting heart rate', text: `${hr} bpm (usually ${Math.round(bh)})`, good: d >= -0.05 }); }
  const hv = today?.hrvMs, bv = b('hrvMs');
  if (hv !== undefined && bv) { const d = (hv - bv) / bv; score += 40 * Math.max(-0.4, Math.min(0.3, d)); parts.push({ what: 'Heart rate variability', text: `${Math.round(hv)} ms (usually ${Math.round(bv)})`, good: d >= -0.1 }); }
  const sore = checkIns.filter((c) => live(c) && typeof c.soreness === 'number' && dayKey(Date.parse(c.at), s) === todayK).pop()?.soreness;
  if (sore !== undefined) { score -= (sore - 1) * 7; parts.push({ what: 'Soreness', text: `${sore} of 5`, good: sore <= 2 }); }
  if (!parts.length) return null;
  const v = Math.round(Math.max(0, Math.min(100, score)));
  return { score: v, label: v >= 75 ? 'Ready' : v >= 55 ? 'OK' : 'Take it easy', parts };
}

// ── Lean mass while losing weight ───────────────────────────────────────────────────────────────────

export interface LeanShare { from: number; to: number; weightLost: number; leanLost: number; share: number; label: string }
export interface MuscleWatch { overall?: LeanShare; steps: (LeanShare & { dose: number })[]; points: number }

/** Lean mass at each entry: logged, or weight × (1 − body fat %) on the same day. */
export function leanPoints(body: BodyEntry[]): { t: number; kg: number; lean: number }[] {
  return body.filter((b) => live(b) && typeof b.weightKg === 'number' && (typeof b.leanKg === 'number' || typeof b.bodyFatPct === 'number'))
    .map((b) => ({ t: ymdToMs(b.date), kg: b.weightKg!, lean: b.leanKg ?? b.weightKg! * (1 - b.bodyFatPct! / 100) })).sort((a, b) => a.t - b.t);
}

/** How much of the weight lost was lean mass, overall and on each dose step (2+ kg lost, 2+ entries). */
export function muscleWatch(body: BodyEntry[], med?: Medication, doses: Dose[] = [], now = Date.now()): MuscleWatch {
  const pts = leanPoints(body);
  const share = (a: typeof pts[0], b: typeof pts[0], label: string): LeanShare | undefined => {
    const wl = a.kg - b.kg, ll = a.lean - b.lean;
    return wl >= 2 ? { from: a.t, to: b.t, weightLost: r(wl), leanLost: r(ll), share: r(ll / wl, 2), label } : undefined;
  };
  const overall = pts.length >= 2 ? share(pts[0], pts[pts.length - 1], 'Overall') : undefined;
  const steps: MuscleWatch['steps'] = [];
  if (med) for (const st of stepReport(med, doses, [], [], now)) {
    const inStep = pts.filter((p) => p.t >= st.from - DAY && p.t <= st.to + DAY);
    if (inStep.length < 2) continue;
    const x = share(inStep[0], inStep[inStep.length - 1], `${st.dose} ${med.unit}`);
    if (x) steps.push({ ...x, dose: st.dose });
  }
  return { overall, steps, points: pts.length };
}

// ── Strength against the peptide ────────────────────────────────────────────────────────────────────

export interface PeptideTraining { byDay: { day: number; pct?: number; sessions: number }[]; byDose: { dose: number; pct?: number; sessions: number }[]; sessions: number; bestDays: number[] }

/** Each session's lifts against that lift's own recent level (median of the 4 sessions before), then grouped by days
 *  since the shot and by dose. "−8%" = about 8% weaker than usual. Needs 6+ comparable sessions. */
export function trainingVsPeptide(med: Medication, doses: Dose[], workouts: Workout[]): PeptideTraining | null {
  const shots = doses.filter((d) => d.medicationId === med.id && live(d) && !d.skipped).map((d) => ({ t: Date.parse(d.takenAt), amount: d.amount })).sort((a, b) => a.t - b.t);
  if (shots.length < 2) return null;
  const idx: { t: number; ratio: number }[] = [];
  const ws = workouts.filter(live).sort((a, b) => t0(a) - t0(b));
  for (const w of ws) {
    const ratios: number[] = [];
    for (const id of new Set(working(w.sets).map((s) => s.exerciseId))) {
      const hist = e1rmSeries(id, ws).filter((p) => p.t < t0(w)).slice(-4).map((p) => p.v);
      const now = e1rmSeries(id, [w])[0]?.v;
      const m = median(hist);
      if (hist.length >= 2 && now && m) ratios.push(now / m);
    }
    if (ratios.length) idx.push({ t: t0(w), ratio: avg(ratios)! });
  }
  if (idx.length < 6) return null;
  const overall = avg(idx.map((x) => x.ratio))!;
  const byDay = Array.from({ length: 7 }, (_, day) => {
    const xs = idx.filter((x) => { const s = shots.filter((sh) => sh.t <= x.t).pop(); return s && Math.floor((x.t - s.t) / DAY) === day; }).map((x) => x.ratio);
    return { day, sessions: xs.length, pct: xs.length >= 2 ? Math.round(((avg(xs)! - overall) / overall) * 100) : undefined };
  });
  const doseSet = [...new Set(shots.map((s) => s.amount))];
  const byDose = doseSet.map((dose) => {
    const xs = idx.filter((x) => shots.filter((sh) => sh.t <= x.t).pop()?.amount === dose).map((x) => x.ratio);
    return { dose, sessions: xs.length, pct: xs.length >= 2 ? Math.round(((avg(xs)! - overall) / overall) * 100) : undefined };
  });
  const known = byDay.filter((d) => d.pct !== undefined);
  const best = known.length ? Math.max(...known.map((d) => d.pct!)) : undefined;
  return { byDay, byDose, sessions: idx.length, bestDays: best === undefined ? [] : known.filter((d) => d.pct! >= best - 1).map((d) => d.day) };
}

// ── Plates ──────────────────────────────────────────────────────────────────────────────────────────

export const PLATES = PLATES_KG;

/** Plates for each side to make `target` on a `bar`, and anything that can't be made. In the person's unit. */
export function platesFor(target: number, bar = 20, plates: number[] = PLATES_KG): { perSide: number[]; leftover: number } {
  let side = Math.max(0, (target - bar) / 2);
  const perSide: number[] = [];
  for (const p of [...plates].sort((a, b) => b - a)) while (side + 1e-9 >= p) { perSide.push(p); side -= p; }
  return { perSide, leftover: r(side * 2, 2) };
}
export const platesForUnits = (u: Units) => (u === 'imperial' ? PLATES_LB : PLATES_KG);

// ── Cardio ──────────────────────────────────────────────────────────────────────────────────────────

export const DISTANCES = [{ km: 1, name: '1 km' }, { km: 5, name: '5 km' }, { km: 10, name: '10 km' }, { km: 21.1, name: 'Half marathon' }];

export const paceText = (minPerKm: number) => `${Math.floor(minPerKm)}:${String(Math.round((minPerKm % 1) * 60)).padStart(2, '0')} /km`;
export const timeText = (min: number) => { const h = Math.floor(min / 60), m = Math.floor(min % 60), sec = Math.round((min % 1) * 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

/** Fastest time at each distance (from sessions at least that long, at their average pace). */
export function cardioBests(workouts: Workout[], activity: CardioActivity) {
  const xs = workouts.filter((w) => live(w) && w.cardio?.activity === activity && (w.cardio.distanceKm ?? 0) > 0).map((w) => ({ t: t0(w), km: w.cardio!.distanceKm!, min: w.cardio!.durationMin }));
  return DISTANCES.map((d) => {
    const ok = xs.filter((x) => x.km >= d.km * 0.98);
    const best = ok.reduce<{ t: number; min: number } | undefined>((b, x) => { const m = (x.min / x.km) * d.km; return !b || m < b.min ? { t: x.t, min: m } : b; }, undefined);
    return { ...d, best };
  });
}

// ── Goals ───────────────────────────────────────────────────────────────────────────────────────────

export interface GoalStatus { goal: FitnessGoal; now?: number; text: string; forecast?: Forecast; done: boolean }

export function fitnessGoalStatus(g: FitnessGoal, workouts: Workout[], now: number, s: ScheduleSettings, defs: ExerciseDef[], units: Units = 'metric'): GoalStatus {
  if (g.kind === 'sessions') {
    const c = trainingCalendar(workouts, now, s, g.perWeek ?? 3, 12);
    return { goal: g, now: c.thisWeek, text: `${c.thisWeek} of ${g.perWeek} this week${c.streak ? ` · ${c.streak} week${c.streak === 1 ? '' : 's'} in a row` : ''}`, done: c.thisWeek >= (g.perWeek ?? 3) };
  }
  if (g.kind === 'lift' && g.exerciseId && g.targetKg) {
    const name = defs.find((d) => d.id === g.exerciseId)?.name ?? 'Lift';
    const reps = g.reps ?? 1;
    // A weight for reps: compare like with like (as an estimated max).
    const target = e1rm(g.targetKg, reps);
    const pts = e1rmSeries(g.exerciseId, workouts);
    const best = pts.length ? Math.max(...pts.map((p) => p.v)) : undefined;
    const f = strengthForecast(g.exerciseId, workouts, target, now);
    const done = best !== undefined && best >= target - 0.05;
    return { goal: g, now: best, forecast: f, done, text: `${name} ${fmtLoad(g.targetKg, units)}${reps > 1 ? ` × ${reps}` : ''}: ${done ? 'reached' : best !== undefined ? `best estimated max ${fmtLoad(best, units)} (need ${fmtLoad(target, units)})` : 'no sessions yet'}` };
  }
  if (g.kind === 'cardio' && g.distanceKm && g.targetMin) {
    const b = cardioBests(workouts, g.activity ?? 'run').find((x) => Math.abs(x.km - g.distanceKm!) < 0.01)
      ?? { best: workouts.filter((w) => live(w) && w.cardio?.activity === (g.activity ?? 'run') && (w.cardio?.distanceKm ?? 0) >= g.distanceKm! * 0.98)
        .map((w) => ({ t: t0(w), min: (w.cardio!.durationMin / w.cardio!.distanceKm!) * g.distanceKm! })).sort((a, c) => a.min - c.min)[0] };
    const done = !!b.best && b.best.min <= g.targetMin;
    return { goal: g, now: b.best?.min, done, text: `${g.distanceKm} km in ${timeText(g.targetMin)}: ${done ? 'reached' : b.best ? `best ${timeText(b.best.min)}` : 'no runs that long yet'}` };
  }
  return { goal: g, text: '', done: false };
}

/** Lean mass and body fat as goal series (for the body goal forecasts). */
export const compSeries = (body: BodyEntry[], metric: 'leanKg' | 'bodyFatPct'): Pt[] => {
  if (metric === 'bodyFatPct') return seriesOf(body, 'bodyFatPct');
  return leanPoints(body).map((p) => ({ t: p.t, v: r(p.lean, 2) }));
};

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────

export interface TrainingSummary {
  sessions: number; perWeek: number; cardio: number; km: number;
  lifts: { id: string; name: string; from: number; to: number; pct: number; sessions: number; noLoad: boolean }[];
  protein?: number; water?: number; proteinDays: number;
  bodyFat?: { from: number; to: number }; lean?: { from: number; to: number };
}

/** A range's training for the doctor report: sessions a week, how the main lifts changed (first to last session in the
 *  range), cardio, protein and water averages, and body fat / lean mass at each end. */
export function trainingSummary(workouts: Workout[], defs: ExerciseDef[], start: number, end: number, daily: DailyHealth[], body: BodyEntry[]): TrainingSummary | null {
  const ws = workouts.filter((w) => live(w) && t0(w) >= start && t0(w) <= end);
  const strength = ws.filter((w) => !w.cardio && working(w.sets).length);
  const cardio = ws.filter((w) => w.cardio && w.endedAt);
  const ymdIn = (d: string) => { const t = ymdToMs(d); return t >= start - DAY / 2 && t <= end + DAY / 2; };
  const days = daily.filter((d) => live(d) && ymdIn(d.date));
  const prot = days.map((d) => d.proteinG).filter((x): x is number => !!x);
  const water = days.map((d) => d.waterMl).filter((x): x is number => !!x);
  const comp = leanPoints(body.filter((b) => live(b) && ymdIn(b.date)));
  const bf = body.filter((b) => live(b) && ymdIn(b.date) && typeof b.bodyFatPct === 'number').sort((a, b) => a.date.localeCompare(b.date));
  if (!strength.length && !cardio.length && !prot.length && comp.length < 2 && bf.length < 2) return null;
  const ids = [...new Set(strength.flatMap((w) => working(w.sets).map((s) => s.exerciseId)))];
  const lifts = ids.map((id) => {
    const pts = e1rmSeries(id, strength);
    const d = defs.find((x) => x.id === id);
    const noLoad = !!d?.timed || !strength.some((w) => w.sets.some((s) => s.exerciseId === id && s.weightKg > 0));
    return { id, name: d?.name ?? 'Exercise', from: pts[0]?.v ?? 0, to: pts[pts.length - 1]?.v ?? 0, pct: pts.length >= 2 && pts[0].v ? Math.round(((pts[pts.length - 1].v - pts[0].v) / pts[0].v) * 100) : 0, sessions: pts.length, noLoad };
  }).filter((l) => l.sessions >= 2).sort((a, b) => b.sessions - a.sessions).slice(0, 6);
  return {
    sessions: strength.length, perWeek: r((strength.length + cardio.length) / Math.max(1, (end - start) / WEEK)), cardio: cardio.length,
    km: r(cardio.reduce((n, w) => n + (w.cardio!.distanceKm ?? 0), 0)), lifts,
    protein: avg(prot) !== undefined ? Math.round(avg(prot)!) : undefined, water: avg(water) !== undefined ? Math.round(avg(water)!) : undefined, proteinDays: prot.length,
    bodyFat: bf.length >= 2 ? { from: bf[0].bodyFatPct!, to: bf[bf.length - 1].bodyFatPct! } : undefined,
    lean: comp.length >= 2 ? { from: r(comp[0].lean), to: r(comp[comp.length - 1].lean) } : undefined,
  };
}
