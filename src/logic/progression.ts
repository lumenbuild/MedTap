// Smart progression (MedTap): what to aim for so each session pushes a little, without guessing. Builds on the simple
// rule (up when every set hits its reps) with the person's own evidence: how hard sets felt (RPE: reps in reserve),
// the trend in their estimated max, today's readiness and, with peptide tools, their usual weaker days after a shot.
// Also adjusts the rest of a session after each set, plans the next few sessions, and checks for room to push.
// From the person's own logs; about training load only, never medicine. Pure; `now` is passed in.
import type { RoutineItem, Workout, WorkoutSet } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ExerciseDef } from './exercises';
import { e1rm, nextTarget, sessionsOf, type Session, type Target } from './training';
import { fromLoad, roundLoad, showLoad, stepIn } from './load';
import { lighten } from './trainingExtras';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : undefined; };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Reps in reserve aimed for on working sets: RPE 8, two good reps left. Hard enough to progress, easy to recover. */
export const TARGET_RIR = 2;

/** The heaviest load for `reps` with `rir` in reserve, from an estimated max (Epley, inverted). */
export const loadFor = (max: number, reps: number, rir = TARGET_RIR) => max / (1 + Math.min(reps + rir, 15) / 30);

/** A set's estimated max, using how hard it felt when logged (RPE 8 at 5 reps ≈ 7 reps to failure). */
export const e1rmWithRpe = (s: Pick<WorkoutSet, 'weightKg' | 'reps' | 'rpe'>) =>
  s.rpe !== undefined ? s.weightKg * (1 + Math.min(s.reps + Math.max(0, 10 - s.rpe), 15) / 30) : e1rm(s.weightKg, s.reps);

/** Down to a loadable weight (so the target stays at or under the two-reps-in-reserve load). Returns kg. */
const floorLoad = (kg: number, def: ExerciseDef, u: Units) => {
  const step = stepIn(def, u) || (u === 'imperial' ? 1 : 0.5);
  const v = Math.floor(showLoad(kg, u) / step + 1e-6) * step;
  return fromLoad(v, u);
};

/** Each session's best estimated max (RPE-aware), and its robust trend: level now and change per week. */
export function capacity(sessions: Session[], now: number): { level: number; perWeek: number; points: number } | null {
  const pts = sessions.filter((s) => s.t > now - 10 * WEEK).map((s) => ({ t: s.t, v: Math.max(...s.sets.map(e1rmWithRpe)) })).filter((p) => p.v > 0);
  if (!pts.length) return null;
  if (pts.length < 3) return { level: pts[pts.length - 1].v, perWeek: 0, points: pts.length };
  // Theil–Sen: the median of every pairwise slope, so one great or awful day barely moves it.
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j].t - pts[i].t > DAY / 2) slopes.push((pts[j].v - pts[i].v) / (pts[j].t - pts[i].t));
  const raw = median(slopes) ?? 0;
  const mid = median(pts.map((p) => p.v))!;
  // A realistic pace for planning: up to +1.5% a week (you may beat it; it only limits how far targets jump).
  const slope = Math.max(-0.03 * mid / WEEK, Math.min(0.015 * mid / WEEK, raw));
  // Never below what the last two sessions showed: a lifter moving faster than the planning pace isn't held back.
  const recent = median(pts.slice(-2).map((p) => p.v))!;
  const level = Math.max(median(pts.map((p) => p.v + slope * (now - p.t)))!, recent);
  return { level, perWeek: slope * WEEK, points: pts.length };
}

export interface SmartTarget extends Omit<Target, 'why'> {
  why: Target['why'] | 'push' | 'hold';
  /** Plain words: why this weight, today. */
  reason: string;
  /** No effort logged lately: do the last set for as many good reps as possible (1 in reserve) to recalibrate. */
  lastSetMax?: boolean;
  /** The simple rule's suggestion, when the smart one differs. */
  plain?: Pick<Target, 'weightKg' | 'reps'>;
}

export interface Context { units?: Units; item?: RoutineItem; readiness?: number | null; weakDay?: boolean; now: number; lighter?: boolean }

/** Today's target for an exercise. Starts from the simple rule; pushes when sets have felt easy or the trend says
 *  there's room; holds on a low-readiness or usual weaker day; asks for a calibrating last set when no effort's logged. */
export function smartTarget(def: ExerciseDef, workouts: Workout[], ctx: Context): SmartTarget {
  if (ctx.lighter) {
    const t = smartTarget(def, workouts, { ...ctx, lighter: false });
    if (t.why === 'start') return t;
    return { ...t, ...lighten(t, def, ctx.units ?? 'metric'), why: 'hold', plain: { weightKg: t.weightKg, reps: t.reps }, lastSetMax: false, reason: 'Lighter week: about 10% less and a set fewer, so you come back stronger.' };
  }
  const u = ctx.units ?? 'metric';
  const base = nextTarget(def, workouts, ctx.item, u);
  const out: SmartTarget = { ...base, reason: '' };
  const ss = sessionsOf(def.id, workouts);
  const last = ss[ss.length - 1];
  if (!last || base.why === 'start') return { ...out, reason: 'First time: pick a weight you could do for a couple more reps than the target.' };
  const top = Math.max(...last.sets.map((s) => s.weightKg));
  const atTop = last.sets.filter((s) => s.weightKg === top);
  const rpes = atTop.map((s) => s.rpe).filter((x): x is number => x !== undefined);
  const lastRpe = avg(rpes);
  const recentRpe = ss.slice(-2).some((x) => x.sets.some((s) => s.rpe !== undefined));
  const beat = atTop.every((s) => s.reps >= base.reps + 2);

  // A low-readiness day: hold rather than add (if the rule says up).
  if (ctx.readiness != null && ctx.readiness < 55 && (base.why === 'up' || base.why === 'reps')) {
    return { ...out, weightKg: roundLoad(top, def, u), reps: atTop.length ? Math.max(...atTop.map((s) => s.reps)) : base.reps, why: 'hold', plain: { weightKg: base.weightKg, reps: base.reps },
      reason: `Readiness is low today (${ctx.readiness}), so match last time; push next session.` };
  }
  if (ctx.weakDay && base.why === 'up') {
    return { ...out, weightKg: roundLoad(top, def, u), why: 'hold', plain: { weightKg: base.weightKg, reps: base.reps }, reason: 'This is usually one of your weaker days after your shot: match last time and push on a stronger day.' };
  }

  // Timed or unloaded: push reps (or seconds) when it felt easy or the target was beaten comfortably.
  if (def.timed || (top === 0 && def.bodyweight)) {
    if ((lastRpe !== undefined && lastRpe <= 7) || beat) {
      return { ...out, reps: base.reps + (def.timed ? 5 : 1), why: 'push', plain: { weightKg: 0, reps: base.reps }, reason: beat ? 'You beat the target comfortably last time, so a bigger jump.' : 'Last time felt easy, so a bigger jump.' };
    }
    return { ...out, reason: base.why === 'same' ? 'Same as last time: build up to every set getting there.' : def.timed ? '5 seconds more than last time: every set held.' : 'A rep more than last time: every set got there.' };
  }

  // Loaded: what the evidence says is about two reps in reserve at the target reps.
  const cap = capacity(ss, ctx.now);
  const step = fromLoad(stepIn(def, u), u);
  if (cap && step > 0 && base.why !== 'deload') {
    // Nearest loadable weight: reps in reserve are an estimate, so rounding down every time would never push.
    const pushLoad = roundLoad(loadFor(cap.level, base.reps), def, u);
    // Never more than two steps or 5% above the simple rule in one go.
    const ceiling = Math.max(base.weightKg + step, Math.min(base.weightKg + 2 * step, base.weightKg * 1.05));
    const easy = (lastRpe !== undefined && lastRpe <= 7) || beat;
    if (pushLoad >= base.weightKg + step - 1e-6 && (easy || (ctx.readiness != null && ctx.readiness >= 80) || cap.points >= 3)) {
      const w = Math.min(pushLoad, floorLoad(ceiling, def, u));
      if (w > base.weightKg + 1e-6) {
        const why = lastRpe !== undefined && lastRpe <= 7 ? `last time felt easy (RPE ${Math.round(lastRpe * 2) / 2})` : beat ? 'you beat the target reps by 2 or more' : 'your recent sessions say you have more in you';
        return { ...out, weightKg: w, why: 'push', plain: { weightKg: base.weightKg, reps: base.reps }, reason: `More than the usual step: ${why}. About 2 reps in reserve by your trend.` };
      }
    }
  }
  const words: Record<Target['why'], string> = {
    up: 'Up a step: every set hit its reps last time.', reps: 'A rep more than last time.', same: atTop.some((x) => (x.rpe ?? 0) >= 9) && atTop.every((x) => x.reps >= base.reps) ? 'Same as last time: every set got there, but close to your limit (RPE 9+). Once it feels easier, go up.' : 'Same as last time: build up to every set hitting its reps.',
    deload: 'About 10% lighter: two sessions in a row fell well short. Build back up from here.', start: '',
  };
  return { ...out, reason: words[base.why] + (!recentRpe ? ' Last set: as many good reps as you can, stopping 1 short. It tunes the next targets.' : ''), lastSetMax: !recentRpe };
}

/** After a set is ticked: change the weight of this exercise's remaining sets if it was clearly too easy or too hard.
 *  Returns the new weight (kg) and why, or null to leave it. */
export function adjustAfterSet(def: ExerciseDef, set: WorkoutSet, targetReps: number, units: Units = 'metric'): { weightKg: number; text: string } | null {
  if (def.timed || set.warmup || set.weightKg <= 0) return null;
  const step = fromLoad(stepIn(def, units), units);
  if (step <= 0) return null;
  if (set.rpe !== undefined && set.rpe <= 7 && set.reps >= targetReps) return { weightKg: set.weightKg + step, text: 'Felt easy' };
  if ((set.rpe !== undefined && set.rpe >= 9.5 && set.reps <= targetReps) || set.reps <= targetReps - 2) return { weightKg: Math.max(0, set.weightKg - step), text: set.reps <= targetReps - 2 ? 'Well short of the reps' : 'Close to your limit' };
  return null;
}

export interface PlanStep { n: number; at?: number; weightKg: number; reps: number; sets: number }

/** The next few sessions, starting from `first` (today's target), if each one goes to plan (every set hits its reps), dated by how often the person does the
 *  exercise. With the trend, when the estimated max should reach `goal`. */
export function progressionPlan(def: ExerciseDef, workouts: Workout[], now: number, units: Units = 'metric', n = 4, first?: Pick<Target, 'weightKg' | 'reps' | 'sets'>): { steps: PlanStep[]; everyDays?: number; perWeekPct?: number } {
  const ss = sessionsOf(def.id, workouts);
  const gaps = ss.slice(-6).map((s, i, a) => (i ? (s.t - a[i - 1].t) / DAY : 0)).slice(1);
  const every = gaps.length >= 2 ? Math.max(1, Math.round(median(gaps)!)) : undefined;
  const sim = workouts.filter((w) => !w.deletedAt);
  const steps: PlanStep[] = [];
  let t = ss.length ? ss[ss.length - 1].t : now;
  for (let i = 1; i <= n; i++) {
    // The first is today's target (smart, when given); after that, the plain rule if each goes to plan.
    const tg = i === 1 && first ? first : nextTarget(def, sim, undefined, units);
    t = every ? Math.max(t + every * DAY, now) : t;
    steps.push({ n: i, at: every ? t : undefined, weightKg: tg.weightKg, reps: tg.reps, sets: tg.sets });
    // Pretend it went to plan, then plan the one after.
    sim.push({ id: `plan${i}`, startedAt: new Date(Math.max(t, (ss[ss.length - 1]?.t ?? now) + i)).toISOString(), sets: Array.from({ length: tg.sets }, (_, k) => ({ id: `p${i}-${k}`, exerciseId: def.id, weightKg: tg.weightKg, reps: tg.reps, done: true, rpe: 8 })), source: 'manual', createdAt: '', updatedAt: '' });
  }
  const cap = capacity(ss, now);
  return { steps, everyDays: every, perWeekPct: cap && cap.points >= 3 && cap.level ? Math.round((cap.perWeek / cap.level) * 1000) / 10 : undefined };
}

export interface Effort { exerciseId: string; status: 'room' | 'stalled' | 'progressing' | 'unknown'; text: string; easyShare?: number; ratePct?: number; wasPct?: number }

/** Whether today is usually a weaker training day after the shot (4%+ below the person's own level), from
 *  `trainingVsPeptide`'s days-after-shot figures. */
export function weakDayToday(byDay: { day: number; pct?: number }[] | undefined, lastShot: number | undefined, now: number): boolean {
  if (!byDay || lastShot === undefined) return false;
  const d = Math.floor((now - lastShot) / DAY);
  const x = byDay.find((b) => b.day === d);
  return x?.pct !== undefined && x.pct <= -4;
}

/** Is each lift being pushed? Over the last 3 weeks: the share of working sets logged at RPE 7 or easier, target reps
 *  beaten by 2+, and the trend now against the 6 weeks before. */
export function effortCheck(exerciseId: string, workouts: Workout[], now: number): Effort {
  const ss = sessionsOf(exerciseId, workouts);
  const recent = ss.filter((s) => s.t > now - 3 * WEEK);
  if (recent.length < 2) return { exerciseId, status: 'unknown', text: '' };
  const sets = recent.flatMap((s) => s.sets);
  const rated = sets.filter((s) => s.rpe !== undefined);
  const easyShare = rated.length >= 4 ? rated.filter((s) => s.rpe! <= 7).length / rated.length : undefined;
  const now4 = capacity(ss.filter((s) => s.t > now - 4 * WEEK), now);
  const before = capacity(ss.filter((s) => s.t <= now - 4 * WEEK && s.t > now - 10 * WEEK), now - 4 * WEEK);
  const pct = (c: typeof now4) => (c && c.points >= 3 && c.level ? Math.round((c.perWeek / c.level) * 1000) / 10 : undefined);
  const ratePct = pct(now4), wasPct = pct(before);
  if (easyShare !== undefined && easyShare >= 0.6) return { exerciseId, status: 'room', easyShare, ratePct, wasPct, text: `${Math.round(easyShare * 100)}% of your sets in the last 3 weeks were RPE 7 or easier: room to push.` };
  if (ratePct !== undefined && ratePct <= 0.2 && (wasPct === undefined || wasPct > 0.5)) return { exerciseId, status: 'stalled', easyShare, ratePct, wasPct, text: wasPct !== undefined ? `Progress has slowed from about ${wasPct}% to ${ratePct}% a week.` : 'Not much change in 4 weeks.' };
  if (ratePct !== undefined && ratePct > 0.2) return { exerciseId, status: 'progressing', easyShare, ratePct, wasPct, text: `Going up about ${ratePct}% a week.` };
  return { exerciseId, status: 'unknown', easyShare, ratePct, wasPct, text: rated.length < 4 ? 'Log how hard sets feel (RPE) to see if there’s room to push.' : '' };
}
