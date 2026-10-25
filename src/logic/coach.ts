// The training coach: where the person is (five levels, Beginner to Expert, from their own logs), a programme that suits
// that level, their goal, days and equipment (picked for them, or chosen from the library), each next session written
// out (with the week of the wave or block it's in), and when they're ready to move on to the next programme.
//
// Levels come from three things, the lowest of which sets the level:
//  - weeks of regular training (plus what they had before, as they said at set-up);
//  - strength for body weight on the main lifts, against rough standards (if they chose to compare);
//  - for bodyweight training, how far along each progression ladder they are.
// The standards are rough guides from widely shared tables, not targets or advice. Pure.
import type { BodyEntry, CoachPlan, Workout } from '../db/schema';
import { BUILT_IN, type ExerciseDef, type Equipment } from './exercises';
import { e1rmSeries, plateau, sessionsOf, strengthForecast, working } from './training';
import { ymdToMs } from './stats';

const DAY = 86_400_000, WEEK = 7 * DAY;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Expert'] as const;
export const levelName = (l: Level) => LEVEL_NAMES[l - 1];
export type Goal = CoachPlan['goal'];
export type Kit = CoachPlan['kit'];
export const GOALS: { id: Goal; name: string; what: string }[] = [
  { id: 'strength', name: 'Strength', what: 'Bigger numbers on squat, bench, deadlift and overhead press' },
  { id: 'muscle', name: 'Muscle', what: 'Size and shape: enough sets for every muscle, in the right rep ranges' },
  { id: 'fitness', name: 'General fitness', what: 'Strength with cardio and conditioning' },
  { id: 'bodyweight', name: 'Bodyweight', what: 'No gym: from easier versions to one-arm push-ups, pull-ups and pistols' },
];
export const KITS: { id: Kit; name: string; what: string }[] = [
  { id: 'gym', name: 'A gym', what: 'Barbells, racks, dumbbells, machines and cables' },
  { id: 'home', name: 'Home with dumbbells', what: 'Dumbbells (and a bench, a pull-up bar if you have one)' },
  { id: 'none', name: 'No equipment', what: 'The floor, a wall, a chair or a sturdy table' },
];
const KIT_GEAR: Record<Kit, Equipment[]> = {
  gym: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'none'],
  home: ['dumbbell', 'kettlebell', 'bodyweight', 'none'],
  none: ['none'],
};

// ── Strength for body weight ─────────────────────────────────────────────────────────────────────────

/** Estimated max for body weight where each level starts (Novice, Intermediate, Advanced, Expert): rough guides. */
const STANDARDS: Record<'f' | 'm', Record<string, [number, number, number, number]>> = {
  m: { squat: [1.25, 1.5, 2.0, 2.5], bench: [0.75, 1.0, 1.5, 1.75], deadlift: [1.5, 2.0, 2.5, 3.0], ohp: [0.55, 0.75, 0.95, 1.1] },
  f: { squat: [0.75, 1.0, 1.5, 1.9], bench: [0.5, 0.65, 1.0, 1.25], deadlift: [1.0, 1.25, 1.75, 2.25], ohp: [0.35, 0.5, 0.65, 0.8] },
};
export const MAIN_LIFTS = [{ id: 'squat', name: 'Squat' }, { id: 'bench', name: 'Bench press' }, { id: 'deadlift', name: 'Deadlift' }, { id: 'ohp', name: 'Overhead press' }];

const levelFrom = (ratio: number, t: [number, number, number, number]): Level => (1 + t.filter((x) => ratio >= x).length) as Level;

// ── Bodyweight ladders ───────────────────────────────────────────────────────────────────────────────

export interface Ladder { id: string; name: string; steps: string[]; /** Level each step stands for. */ levels: Level[]; target: { sets: number; reps: number }; timed?: boolean; needsBar?: number }
export const LADDERS: Ladder[] = [
  { id: 'push', name: 'Push', steps: ['incline-push-up', 'knee-push-up', 'push-up', 'decline-push-up', 'diamond-push-up', 'archer-push-up', 'one-arm-push-up'], levels: [1, 1, 2, 2, 3, 4, 5], target: { sets: 3, reps: 12 } },
  { id: 'vpush', name: 'Overhead push', steps: ['pike-push-up', 'elevated-pike', 'wall-hspu'], levels: [2, 3, 5], target: { sets: 3, reps: 10 } },
  { id: 'pull', name: 'Pull', steps: ['table-row', 'negative-pull-up', 'chin-up', 'pull-up', 'archer-pull-up'], levels: [1, 2, 3, 4, 5], target: { sets: 3, reps: 8 }, needsBar: 1 },
  { id: 'legs', name: 'Legs', steps: ['air-squat', 'reverse-lunge', 'bw-split-squat', 'shrimp-squat', 'pistol-squat'], levels: [1, 2, 3, 4, 5], target: { sets: 3, reps: 12 } },
  { id: 'hinge', name: 'Hips and hamstrings', steps: ['glute-bridge', 'sl-glute-bridge', 'sl-rdl', 'nordic-curl'], levels: [1, 2, 3, 5], target: { sets: 3, reps: 12 } },
  { id: 'core', name: 'Core', steps: ['plank', 'hollow-hold', 'l-sit'], levels: [1, 3, 5], target: { sets: 3, reps: 40 }, timed: true },
];

/** Where the person is on each ladder: the hardest step they've done, one further once they've hit its target (all
 *  sets at the target reps) in two sessions; never below where their experience starts them (the steps for a
 *  Beginner, or a Novice with a lot of experience). */
export function ladderSteps(workouts: Workout[], experience: CoachPlan['experience'], kit: Kit): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of LADDERS) {
    const max = kit === 'none' && l.needsBar !== undefined ? l.needsBar - 1 : l.steps.length - 1;
    // Experience starts each ladder at the steps for a level (Beginner, or Novice with a lot of it), not a number of
    // steps in: short ladders jump levels quickly.
    const startLevel = ([1, 1, 2] as const)[experience];
    let step = Math.max(0, Math.min(max, l.levels.findIndex((v) => v >= startLevel)));
    l.steps.forEach((id, i) => {
      const ss = sessionsOf(id, workouts);
      if (!ss.length) return;
      const target = l.id === 'core' && i === l.steps.length - 1 ? 20 : l.target.reps;
      const hit = (s: (typeof ss)[number]) => s.sets.filter((x) => x.reps >= target).length >= l.target.sets;
      const passed = ss.length >= 2 && hit(ss[ss.length - 1]) && hit(ss[ss.length - 2]);
      step = Math.max(step, Math.min(passed ? i + 1 : i, max));
    });
    out[l.id] = step;
  }
  return out;
}

// ── The level ────────────────────────────────────────────────────────────────────────────────────────

export interface LiftLevel { id: string; name: string; e1rm: number; ratio: number; level: Level; nextRatio?: number; nextKg?: number; eta?: number | null }
export interface Need { text: string; progress: number }
export interface LevelInfo {
  level: Level;
  /** Weeks with training in the last two years (plus experience before), and the level that alone allows. */
  weeks: number; weeksLevel: Level;
  lifts: LiftLevel[]; strengthLevel?: Level;
  ladders?: { ladder: Ladder; step: number; level: Level }[]; ladderLevel?: Level;
  bodyKg?: number;
  /** What's still needed for the next level (none at Expert). */
  next?: { level: Level; needs: Need[] };
}

const WEEKS_FOR: Record<Level, number> = { 1: 0, 2: 8, 3: 26, 4: 52, 5: 104 };
const strengthWorkout = (w: Workout) => live(w) && !w.cardio && working(w.sets).length > 0;

export function assessLevel(plan: Pick<CoachPlan, 'goal' | 'experience' | 'standards' | 'kit'>, workouts: Workout[], body: BodyEntry[], now: number): LevelInfo {
  const ws = workouts.filter(strengthWorkout);
  const weeksSet = new Set(ws.filter((w) => Date.parse(w.startedAt) > now - 104 * WEEK).map((w) => Math.floor(Date.parse(w.startedAt) / WEEK)));
  const weeks = weeksSet.size + [0, 12, 52][plan.experience];
  const weeksLevel = ([5, 4, 3, 2, 1] as Level[]).find((l) => weeks >= WEEKS_FOR[l])!;
  const bw = body.filter((b) => live(b) && typeof b.weightKg === 'number').sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weightKg;
  const lifts: LiftLevel[] = [];
  if (plan.standards && bw) {
    const table = STANDARDS[plan.standards];
    for (const l of MAIN_LIFTS) {
      const pts = e1rmSeries(l.id, ws).filter((p) => p.t > now - 26 * WEEK);
      if (!pts.length) continue;
      const best = Math.max(...pts.slice(-6).map((p) => p.v));
      const ratio = best / bw;
      const level = levelFrom(ratio, table[l.id]);
      const nextRatio = level < 5 ? table[l.id][level - 1] : undefined;
      const nextKg = nextRatio ? Math.round(nextRatio * bw * 2) / 2 : undefined;
      const f = nextKg ? strengthForecast(l.id, ws, nextKg, now) : null;
      lifts.push({ id: l.id, name: l.name, e1rm: Math.round(best * 10) / 10, ratio: Math.round(ratio * 100) / 100, level, nextRatio, nextKg, eta: f?.eta ?? null });
    }
  }
  const sorted = lifts.map((x) => x.level).sort((a, b) => a - b);
  const strengthLevel = sorted.length >= 2 ? sorted[(sorted.length - 1) >> 1] : sorted[0];
  let ladders: LevelInfo['ladders'];
  let ladderLevel: Level | undefined;
  if (plan.goal === 'bodyweight' || plan.kit === 'none') {
    const steps = ladderSteps(ws, plan.experience, plan.kit);
    ladders = LADDERS.map((l) => ({ ladder: l, step: steps[l.id], level: l.levels[steps[l.id]] }));
    const ls = ladders.filter((x) => x.ladder.id !== 'vpush' || x.step > 0).map((x) => x.level).sort((a, b) => a - b);
    ladderLevel = ls[(ls.length - 1) >> 1];
  }
  const parts = [weeksLevel, ...(strengthLevel ? [strengthLevel] : []), ...(ladderLevel && plan.goal === 'bodyweight' ? [ladderLevel] : [])];
  const level = Math.min(...parts) as Level;
  const info: LevelInfo = { level, weeks, weeksLevel, lifts, strengthLevel, ladders, ladderLevel, bodyKg: bw };
  if (level < 5) {
    const nl = (level + 1) as Level;
    const needs: Need[] = [];
    if (weeksLevel < nl) needs.push({ text: `${WEEKS_FOR[nl] - weeks} more week${WEEKS_FOR[nl] - weeks === 1 ? '' : 's'} of regular training (${weeks} of ${WEEKS_FOR[nl]})`, progress: weeks / WEEKS_FOR[nl] });
    for (const x of lifts.filter((x) => x.level < nl && x.nextRatio)) {
      const need = plan.standards ? STANDARDS[plan.standards][x.id][nl - 2] : x.nextRatio!;
      const kg = Math.round(need * (bw ?? 0) * 2) / 2;
      needs.push({ text: `${x.name}: about ${kg} kg estimated max, ${need}× body weight (now ${x.ratio}×)`, progress: Math.min(1, x.ratio / need) });
    }
    for (const l of (plan.goal === 'bodyweight' ? ladders ?? [] : []).filter((x) => x.level < nl && x.ladder.id !== 'vpush')) {
      const step = l.ladder.levels.findIndex((v) => v >= nl);
      if (step > l.step) needs.push({ text: `${l.ladder.name}: up to ${STEP_NAME(l.ladder.steps[step])}`, progress: (l.step + 1) / (step + 1) });
    }
    info.next = { level: nl, needs };
  }
  return info;
}
const STEP_NAME = (id: string) => (BUILT_IN.find((d) => d.id === id)?.name ?? id).replace(/^./, (c) => c.toLowerCase());

// ── Programmes ───────────────────────────────────────────────────────────────────────────────────────

type Role = 'squat' | 'deadlift' | 'hinge' | 'hpush' | 'vpush' | 'hpull' | 'vpull' | 'lunge' | 'hamstring' | 'quad' | 'calves' | 'sidedelt' | 'reardelt' | 'biceps' | 'triceps' | 'chest' | 'core' | 'glutes' | 'conditioning';
/** One exercise in a day: by role (picked for the equipment) or a named exercise. `main` lifts follow the programme's
 *  scheme (waves, blocks); the rest progress by the usual rule (reps up to the top of the range, then weight). */
export interface Slot { role: Role; sets: number; reps: number; repsMax?: number; main?: boolean; light?: number }
export interface Day { name: string; slots: Slot[]; cardio?: { kind: 'easy' | 'intervals'; minutes: number; text: string } }
export interface Program {
  id: string; name: string; short: string; goal: Goal; levels: [Level, Level]; kits: Kit[]; days: number[];
  summary: string; how: string[];
  /** Days in rotation for the chosen days a week. */
  rotation: (days: number) => Day[];
  scheme: 'linear' | 'double' | 'heavy-light' | 'wave' | 'block' | 'volume' | 'ladder';
  /** Weeks in a wave or block (the last may be a lighter week). */
  weeks?: number;
  minWeeks: number;
  next?: string;
}

const S = (role: Role, sets: number, reps: number, o: Partial<Slot> = {}): Slot => ({ role, sets, reps, ...o });
const M = (role: Role, sets: number, reps: number, o: Partial<Slot> = {}): Slot => ({ role, sets, reps, main: true, ...o });
const R = (role: Role, sets: number, lo: number, hi: number): Slot => ({ role, sets, reps: lo, repsMax: hi });
const rep = (days: Day[], n: number) => days.slice(0, Math.max(1, Math.min(n, days.length)));

export const PROGRAMS: Program[] = [
  // Strength
  { id: 'str-1', name: 'Beginner strength (A/B)', short: 'Strength A/B', goal: 'strength', levels: [1, 1], kits: ['gym'], days: [2, 3, 4], scheme: 'linear', minWeeks: 8, next: 'str-2',
    summary: 'Three main lifts a session, 3 sets of 5, a little more weight every time.',
    how: ['Two sessions that alternate: A and B.', 'Add weight every session while all your reps go up. Two missed sessions in a row at the same weight: take 10% off and build back.', 'This is the fastest strength gain you will ever get: ride it until it stalls.'],
    rotation: () => [
      { name: 'A', slots: [M('squat', 3, 5), M('hpush', 3, 5), M('hpull', 3, 5), S('core', 2, 10)] },
      { name: 'B', slots: [M('squat', 3, 5), M('vpush', 3, 5), M('deadlift', 1, 5), S('vpull', 3, 6)] },
    ] },
  { id: 'str-2', name: 'Heavy, light and medium days (Novice)', short: 'Strength H/L/M', goal: 'strength', levels: [2, 2], kits: ['gym'], days: [3], scheme: 'heavy-light', minWeeks: 8, next: 'str-3',
    summary: 'A heavy, a light and a medium day each week: the heavy day goes up weekly.',
    how: ['Heavy day sets the pace: add a little each week.', 'Light day is about 80% of the heavy weight, medium about 90%: practice and recovery, not testing.', 'Progress now comes week to week rather than session to session.'],
    rotation: () => [
      { name: 'Heavy', slots: [M('squat', 4, 5), M('hpush', 4, 5), M('hpull', 4, 6), S('core', 3, 10)] },
      { name: 'Light', slots: [M('squat', 2, 5, { light: 0.8 }), M('vpush', 3, 6), M('deadlift', 2, 5), S('vpull', 3, 8)] },
      { name: 'Medium', slots: [M('squat', 3, 5, { light: 0.9 }), M('hpush', 3, 5, { light: 0.9 }), S('hinge', 3, 8), S('hpull', 3, 8)] },
    ] },
  { id: 'str-3', name: 'Upper/lower strength (Intermediate)', short: 'Strength U/L', goal: 'strength', levels: [3, 3], kits: ['gym'], days: [4], scheme: 'double', minWeeks: 10, next: 'str-4',
    summary: 'Four days: two lower, two upper; a heavy main lift each day plus the work that builds it.',
    how: ['Main lifts in the 3–5 rep range, aiming for about 2 reps left in the tank.', 'Accessory lifts in 6–12: add reps, then weight.', 'Expect your best lifts to go up every few weeks, not every session.'],
    rotation: () => [
      { name: 'Lower A', slots: [M('squat', 4, 4, { repsMax: 6 }), R('hinge', 3, 6, 10), R('lunge', 2, 8, 12), R('core', 3, 10, 15)] },
      { name: 'Upper A', slots: [M('hpush', 4, 4, { repsMax: 6 }), R('hpull', 4, 6, 10), R('vpush', 3, 6, 10), R('vpull', 3, 6, 10)] },
      { name: 'Lower B', slots: [M('deadlift', 3, 3, { repsMax: 5 }), R('squat', 3, 6, 10), R('hamstring', 3, 8, 12), R('calves', 3, 10, 15)] },
      { name: 'Upper B', slots: [M('vpush', 4, 4, { repsMax: 6 }), R('vpull', 4, 5, 8), R('hpush', 3, 6, 10), R('triceps', 2, 8, 12), R('biceps', 2, 8, 12)] },
    ] },
  { id: 'str-4', name: 'Monthly waves (Advanced)', short: 'Strength waves', goal: 'strength', levels: [4, 4], kits: ['gym'], days: [3, 4], scheme: 'wave', weeks: 4, minWeeks: 16, next: 'str-5',
    summary: 'Four-week waves from a training max: 5s, 3s, 5/3/1, then a lighter week. The max goes up each wave.',
    how: ['Your training max is 90% of your estimated max: every percentage is from it.', 'Week 1: 65/75/85% for 5; week 2: 70/80/90% for 3; week 3: 75/85/95% for 5, 3 and 1; week 4: lighter (40–60%).', 'The last set of weeks 1–3 is “as many as you can” with good form: that set shows your progress.', 'After each wave the max goes up 2.5 kg (upper body) or 5 kg (lower body).'],
    rotation: (d) => rep([
      { name: 'Squat day', slots: [M('squat', 3, 5), R('hinge', 3, 8, 10), R('core', 3, 10, 15)] },
      { name: 'Bench day', slots: [M('hpush', 3, 5), R('hpull', 4, 8, 12), R('triceps', 3, 10, 12)] },
      { name: 'Deadlift day', slots: [M('deadlift', 3, 5), R('lunge', 3, 8, 12), R('hamstring', 3, 10, 12)] },
      { name: 'Press day', slots: [M('vpush', 3, 5), R('vpull', 4, 6, 10), R('sidedelt', 3, 12, 15)] },
    ], d === 3 ? 4 : 4) },
  { id: 'str-5', name: 'Strength blocks (Expert)', short: 'Strength blocks', goal: 'strength', levels: [5, 5], kits: ['gym'], days: [4], scheme: 'block', weeks: 12, minWeeks: 12,
    summary: 'Twelve-week blocks: build volume, then strength, then peak, then test your new maxes.',
    how: ['Weeks 1–4, build: 4 × 8 from about 65% of your max, a little heavier each week.', 'Weeks 5–8, strength: 4 × 4 from about 78%.', 'Weeks 9–11, peak: 3 × 2 from about 88%.', 'Week 12: work up to a heavy single on each lift, only as far as it moves well. The next block starts from those.'],
    rotation: () => [
      { name: 'Squat day', slots: [M('squat', 4, 8), R('hinge', 3, 6, 10), R('core', 3, 10, 15)] },
      { name: 'Bench day', slots: [M('hpush', 4, 8), R('hpull', 4, 6, 10), R('triceps', 3, 8, 12)] },
      { name: 'Deadlift day', slots: [M('deadlift', 4, 8), R('lunge', 3, 8, 12), R('hamstring', 3, 8, 12)] },
      { name: 'Press day', slots: [M('vpush', 4, 8), R('vpull', 4, 6, 10), R('sidedelt', 3, 12, 15)] },
    ] },

  // Muscle
  { id: 'mus-1', name: 'Full body for muscle (Beginner)', short: 'Muscle full body', goal: 'muscle', levels: [1, 1], kits: ['gym', 'home'], days: [2, 3], scheme: 'double', minWeeks: 8, next: 'mus-2',
    summary: 'Every muscle two or three times a week, 8–12 reps, adding reps then weight.',
    how: ['Each exercise has a range (8–12). When every set reaches the top, the weight goes up and the reps start again at the bottom.', 'Stop each set with about 2 reps left in the tank: hard, not failure.', 'Same exercises each time, so you can see them go up.'],
    rotation: () => [
      { name: 'A', slots: [R('squat', 3, 8, 12), R('hpush', 3, 8, 12), R('hpull', 3, 8, 12), R('hinge', 2, 8, 12), R('sidedelt', 2, 12, 15), R('core', 2, 10, 15)] },
      { name: 'B', slots: [R('hinge', 3, 8, 12), R('vpush', 3, 8, 12), R('vpull', 3, 8, 12), R('lunge', 2, 8, 12), R('biceps', 2, 10, 12), R('triceps', 2, 10, 12)] },
    ] },
  { id: 'mus-2', name: 'Upper/lower for muscle (Novice)', short: 'Muscle U/L', goal: 'muscle', levels: [2, 2], kits: ['gym', 'home'], days: [4], scheme: 'double', minWeeks: 8, next: 'mus-3',
    summary: 'Four days, each muscle twice a week, about 10–14 hard sets per muscle.',
    how: ['Heavier compound lifts first (6–10 reps), then lighter work for each muscle (10–15).', 'Add reps across the range, then weight.', 'Sets per muscle on Training show whether each body part gets enough.'],
    rotation: () => [
      { name: 'Upper A', slots: [R('hpush', 3, 6, 10), R('hpull', 3, 6, 10), R('vpush', 3, 8, 12), R('vpull', 3, 8, 12), R('sidedelt', 3, 12, 15), R('triceps', 2, 10, 15)] },
      { name: 'Lower A', slots: [R('squat', 3, 6, 10), R('hinge', 3, 8, 12), R('lunge', 2, 10, 12), R('quad', 2, 12, 15), R('calves', 3, 10, 15)] },
      { name: 'Upper B', slots: [R('vpull', 3, 6, 10), R('hpush', 3, 8, 12), R('hpull', 3, 8, 12), R('chest', 2, 12, 15), R('reardelt', 2, 12, 15), R('biceps', 3, 10, 15)] },
      { name: 'Lower B', slots: [R('hinge', 3, 6, 10), R('squat', 3, 8, 12), R('hamstring', 3, 10, 12), R('glutes', 2, 10, 12), R('core', 3, 10, 15)] },
    ] },
  { id: 'mus-3', name: 'Push, pull, legs (Intermediate)', short: 'PPL', goal: 'muscle', levels: [3, 3], kits: ['gym', 'home'], days: [3, 5, 6], scheme: 'double', minWeeks: 10, next: 'mus-4',
    summary: 'Push, pull and legs days: more exercises per muscle, more sets each week.',
    how: ['Three days a week runs each day once; six runs it twice (best for muscle).', 'Main lifts 6–10, the rest 10–15, stopping 1–2 reps short of failure.', 'A lighter week when Training suggests one.'],
    rotation: () => [
      { name: 'Push', slots: [R('hpush', 4, 6, 10), R('vpush', 3, 8, 12), R('chest', 3, 10, 15), R('sidedelt', 4, 12, 20), R('triceps', 3, 10, 15)] },
      { name: 'Pull', slots: [R('vpull', 4, 6, 10), R('hpull', 3, 8, 12), R('reardelt', 3, 12, 20), R('biceps', 3, 10, 15), R('core', 3, 10, 15)] },
      { name: 'Legs', slots: [R('squat', 4, 6, 10), R('hinge', 3, 8, 12), R('quad', 3, 10, 15), R('hamstring', 3, 10, 15), R('calves', 4, 10, 15)] },
    ] },
  { id: 'mus-4', name: 'Volume blocks (Advanced)', short: 'Volume blocks', goal: 'muscle', levels: [4, 4], kits: ['gym', 'home'], days: [4, 5, 6], scheme: 'volume', weeks: 5, minWeeks: 15, next: 'mus-5',
    summary: 'Five-week blocks: a set more each week and closer to failure, then a lighter week to recover and grow.',
    how: ['Week 1 starts with about 3 reps in reserve; each week adds a set per exercise and takes you a rep closer to failure.', 'Week 5 is lighter: half the sets, same weights.', 'Each block starts a little heavier than the last.'],
    rotation: (d) => (d === 4 ? PROGRAMS.find((p) => p.id === 'mus-2')!.rotation(4) : PROGRAMS.find((p) => p.id === 'mus-3')!.rotation(3)) },
  { id: 'mus-5', name: 'Specialisation (Expert)', short: 'Specialisation', goal: 'muscle', levels: [5, 5], kits: ['gym', 'home'], days: [4, 5, 6], scheme: 'volume', weeks: 6, minWeeks: 12,
    summary: 'Blocks that push your two smallest-responding muscles while the rest hold steady.',
    how: ['The two muscles with the fewest sets (or slowest progress) lately get extra sets; the others keep their volume.', 'Six-week blocks, the last lighter. Then the focus moves on.', 'This is how experienced lifters keep growing: not everything at once.'],
    rotation: (d) => (d === 4 ? PROGRAMS.find((p) => p.id === 'mus-2')!.rotation(4) : PROGRAMS.find((p) => p.id === 'mus-3')!.rotation(3)) },

  // General fitness
  { id: 'fit-1', name: 'Move more (Beginner)', short: 'Fitness start', goal: 'fitness', levels: [1, 1], kits: ['gym', 'home', 'none'], days: [2, 3], scheme: 'double', minWeeks: 6, next: 'fit-2',
    summary: 'Short full-body sessions and easy cardio you can talk through.',
    how: ['Strength: 2 sets of 10–15 of each move, adding reps then weight.', 'Cardio: 20–30 minutes at an easy, conversational pace (a brisk walk counts).', 'Consistency beats intensity at this stage.'],
    rotation: () => [
      { name: 'Full body', slots: [R('squat', 2, 10, 15), R('hpush', 2, 10, 15), R('hpull', 2, 10, 15), R('glutes', 2, 10, 15), R('core', 2, 20, 40)], cardio: { kind: 'easy', minutes: 20, text: '20 minutes easy, able to talk' } },
    ] },
  { id: 'fit-2', name: 'Strength and intervals (Novice)', short: 'Fitness + intervals', goal: 'fitness', levels: [2, 2], kits: ['gym', 'home', 'none'], days: [3, 4], scheme: 'double', minWeeks: 8, next: 'fit-3',
    summary: 'Full-body strength twice, one interval session and one easy cardio session.',
    how: ['Strength 8–12 reps, 3 sets.', 'Intervals: 6 × 1 minute hard, 2 minutes easy, after a 5-minute warm-up.', 'Easy cardio stays easy: it builds the base the intervals sit on.'],
    rotation: (d) => rep([
      { name: 'Strength A', slots: [R('squat', 3, 8, 12), R('hpush', 3, 8, 12), R('hpull', 3, 8, 12), R('core', 2, 10, 15)] },
      { name: 'Intervals', slots: [R('conditioning', 2, 10, 15)], cardio: { kind: 'intervals', minutes: 25, text: '5 min warm-up, 6 × (1 min hard, 2 min easy), 2 min easy' } },
      { name: 'Strength B', slots: [R('hinge', 3, 8, 12), R('vpush', 3, 8, 12), R('vpull', 3, 8, 12), R('lunge', 2, 10, 12)] },
      { name: 'Easy cardio', slots: [], cardio: { kind: 'easy', minutes: 35, text: '30–40 minutes easy, able to talk' } },
    ], d) },
  { id: 'fit-3', name: 'Hybrid upper/lower (Intermediate)', short: 'Hybrid U/L', goal: 'fitness', levels: [3, 4], kits: ['gym', 'home'], days: [4, 5], scheme: 'double', minWeeks: 10, next: 'fit-4',
    summary: 'Upper/lower strength with intervals and longer easy cardio through the week.',
    how: ['Lift first, cardio after (or on its own day).', 'One hard cardio day and one or two easy ones: most cardio should be easy.', 'If lifts stall, take the hard cardio out for a week before anything else.'],
    rotation: (d) => rep([
      { name: 'Lower', slots: [R('squat', 4, 5, 8), R('hinge', 3, 6, 10), R('lunge', 2, 8, 12), R('core', 3, 10, 15)] },
      { name: 'Upper', slots: [R('hpush', 4, 5, 8), R('hpull', 4, 6, 10), R('vpush', 3, 8, 12), R('vpull', 3, 6, 10)] },
      { name: 'Intervals', slots: [R('conditioning', 3, 10, 15)], cardio: { kind: 'intervals', minutes: 30, text: '5 min warm-up, 5 × (3 min hard, 2 min easy)' } },
      { name: 'Lower and upper', slots: [R('deadlift', 3, 4, 6), R('vpush', 3, 6, 10), R('hpull', 3, 8, 12), R('calves', 3, 10, 15)] },
      { name: 'Long easy', slots: [], cardio: { kind: 'easy', minutes: 50, text: '45–60 minutes easy' } },
    ], d) },
  { id: 'fit-4', name: 'Hybrid waves (Advanced to Expert)', short: 'Hybrid waves', goal: 'fitness', levels: [4, 5], kits: ['gym'], days: [4, 5], scheme: 'wave', weeks: 4, minWeeks: 16,
    summary: 'Wave-loaded main lifts with a full cardio week: tempo, intervals and a long easy session.',
    how: ['Main lifts follow four-week waves from a training max (as in Monthly waves).', 'Cardio: one interval day, one tempo (comfortably hard, 20 minutes), one long easy.', 'The lighter week lightens both.'],
    rotation: (d) => rep([
      { name: 'Squat and press', slots: [M('squat', 3, 5), M('vpush', 3, 5), R('vpull', 3, 6, 10)] },
      { name: 'Intervals', slots: [R('core', 3, 10, 15)], cardio: { kind: 'intervals', minutes: 35, text: '6 × (3 min hard, 90 s easy)' } },
      { name: 'Deadlift and bench', slots: [M('deadlift', 3, 5), M('hpush', 3, 5), R('hpull', 3, 8, 12)] },
      { name: 'Tempo', slots: [], cardio: { kind: 'easy', minutes: 35, text: '10 min easy, 20 min comfortably hard, 5 min easy' } },
      { name: 'Long easy', slots: [], cardio: { kind: 'easy', minutes: 60, text: '60 minutes easy' } },
    ], d) },

  // Bodyweight
  { id: 'bw-1', name: 'Bodyweight foundations', short: 'Bodyweight', goal: 'bodyweight', levels: [1, 2], kits: ['none', 'home', 'gym'], days: [2, 3], scheme: 'ladder', minWeeks: 8, next: 'bw-2',
    summary: 'Each move at the version that suits you now; reach 3 × 12 and the next harder version takes over.',
    how: ['Every move has a ladder of versions, easiest first.', 'When you hit the target (3 sets of 12, or 8 for pulling) in two sessions, the next version comes in.', 'Slow on the way down, full range: that is where bodyweight strength comes from.'],
    rotation: () => [
      { name: 'Full body', slots: [S('squat', 3, 12), S('hpush', 3, 12), S('hpull', 3, 8), S('hinge', 3, 12), S('core', 3, 40)] },
    ] },
  { id: 'bw-2', name: 'Bodyweight upper/lower', short: 'Bodyweight U/L', goal: 'bodyweight', levels: [3, 3], kits: ['none', 'home', 'gym'], days: [3, 4], scheme: 'ladder', minWeeks: 10, next: 'bw-3',
    summary: 'Upper and lower days with overhead pushing added: more sets on each ladder.',
    how: ['Four sets per move now.', 'Pike push-ups start the overhead ladder.', 'A doorway pull-up bar opens the pull ladder beyond table rows.'],
    rotation: (d) => rep([
      { name: 'Upper', slots: [S('hpush', 4, 12), S('hpull', 4, 8), S('vpush', 3, 10), S('core', 3, 40)] },
      { name: 'Lower', slots: [S('squat', 4, 12), S('hinge', 4, 12), S('lunge', 3, 12), S('calves', 3, 15)] },
    ], d) },
  { id: 'bw-3', name: 'Calisthenics skills (Advanced to Expert)', short: 'Calisthenics', goal: 'bodyweight', levels: [4, 5], kits: ['none', 'home', 'gym'], days: [3, 4], scheme: 'ladder', minWeeks: 12,
    summary: 'The hard end of each ladder: archer and one-arm push-ups, archer pull-ups, pistols, Nordics, L-sits and handstand push-ups.',
    how: ['Fewer, harder reps: 5 sets of the hardest version you can do well.', 'Practise skills fresh, at the start of a session.', 'Keep one easier version as a finisher for volume.'],
    rotation: (d) => rep([
      { name: 'Push and core', slots: [S('hpush', 5, 6), S('vpush', 4, 6), S('core', 4, 20)] },
      { name: 'Pull and legs', slots: [S('hpull', 5, 5), S('squat', 5, 6), S('hinge', 3, 6)] },
      { name: 'Full body', slots: [S('hpush', 3, 10), S('hpull', 3, 8), S('lunge', 3, 10), S('core', 3, 30)] },
    ], d) },
];
export const programById = (id: string) => PROGRAMS.find((p) => p.id === id);

/** The programme that suits: the goal, the level (within its range), the equipment and the days, closest first. */
export function recommend(goal: Goal, level: Level, kit: Kit, days: number): Program {
  const fits = PROGRAMS.filter((p) => p.goal === goal && p.kits.includes(kit));
  const pool = fits.length ? fits : PROGRAMS.filter((p) => p.kits.includes(kit));
  const score = (p: Program) => (level < p.levels[0] ? p.levels[0] - level : level > p.levels[1] ? level - p.levels[1] : 0) * 10
    + Math.min(...p.days.map((d) => Math.abs(d - days)));
  return [...pool].sort((a, b) => score(a) - score(b))[0];
}

// ── Exercises for each role ──────────────────────────────────────────────────────────────────────────

const PICKS: Record<Role, string[]> = {
  squat: ['squat', 'goblet-squat', 'leg-press'], deadlift: ['deadlift', 'db-rdl'], hinge: ['rdl', 'db-rdl', 'hip-thrust', 'kb-swing'],
  hpush: ['bench', 'db-bench', 'chest-press', 'push-up'], vpush: ['ohp', 'db-shoulder-press', 'pike-push-up'],
  hpull: ['row', 'db-row', 'cable-row', 'machine-row', 'table-row'], vpull: ['pull-up', 'lat-pulldown', 'chin-up', 'assisted-pull-up', 'db-row'],
  lunge: ['split-squat', 'lunge', 'reverse-lunge', 'bw-split-squat'], hamstring: ['leg-curl', 'db-rdl', 'nordic-curl', 'sl-rdl'],
  quad: ['leg-ext', 'goblet-squat', 'bw-split-squat'], calves: ['calf-raise', 'bw-calf-raise'], sidedelt: ['lateral-raise'],
  reardelt: ['face-pull', 'rear-delt', 'prone-ytw'], biceps: ['curl', 'cable-curl', 'hammer-curl'], triceps: ['triceps-ext', 'skull-crusher', 'dip', 'chair-dip'],
  chest: ['cable-fly', 'incline-db', 'decline-push-up'], core: ['hanging-raise', 'crunch', 'plank', 'dead-bug'], glutes: ['hip-thrust', 'glute-bridge'],
  conditioning: ['kb-swing', 'burpee', 'mountain-climber'],
};
const LADDER_FOR: Partial<Record<Role, string>> = { hpush: 'push', vpush: 'vpush', hpull: 'pull', vpull: 'pull', squat: 'legs', lunge: 'legs', hinge: 'hinge', hamstring: 'hinge', glutes: 'hinge', core: 'core' };
/** Beginners in a gym start some lifts on the easier version. */
const BEGINNER_GYM: Partial<Record<Role, string>> = { vpull: 'lat-pulldown', deadlift: 'deadlift' };

/** The exercise for a role: on a ladder (bodyweight) at the person's step; otherwise the first the equipment allows. */
export function pickExercise(role: Role, kit: Kit, defs: ExerciseDef[], o: { ladders?: Record<string, number>; level: Level; bodyweight: boolean }): ExerciseDef | undefined {
  const gear = KIT_GEAR[kit];
  const ok = (id: string) => { const d = defs.find((x) => x.id === id); return d && gear.includes(d.equipment ?? 'none') ? d : undefined; };
  const ladder = LADDER_FOR[role];
  if (ladder && (o.bodyweight || kit === 'none') && o.ladders) {
    const l = LADDERS.find((x) => x.id === ladder)!;
    // Lunges sit one step back on the legs ladder; hamstrings one step on from glute work.
    const step = Math.max(0, Math.min(l.steps.length - 1, o.ladders[ladder] + (role === 'lunge' ? -1 : role === 'hamstring' ? 1 : 0)));
    for (let i = step; i >= 0; i--) { const d = ok(l.steps[i]); if (d) return d; }
  }
  if (kit === 'gym' && o.level <= 1 && BEGINNER_GYM[role]) { const d = ok(BEGINNER_GYM[role]!); if (d) return d; }
  for (const id of PICKS[role]) { const d = ok(id); if (d) return d; }
  return undefined;
}

// ── The next session ─────────────────────────────────────────────────────────────────────────────────

export interface PlannedItem { exerciseId: string; name: string; sets: number; reps: number; repsMax?: number; /** Prescribed weights per set (waves, blocks, light days). */ weights?: number[]; repsBySet?: number[]; note?: string; main?: boolean }
export interface PlannedSession { program: Program; day: Day; title: string; n: number; week: number; phase?: string; items: PlannedItem[]; cardio?: Day['cardio'] }

const WAVE = [[0.65, 0.75, 0.85], [0.7, 0.8, 0.9], [0.75, 0.85, 0.95], [0.4, 0.5, 0.6]];
const WAVE_REPS = [[5, 5, 5], [3, 3, 3], [5, 3, 1], [5, 5, 5]];
const roundKg = (kg: number, step: number) => Math.max(step, Math.round(kg / step) * step);

/** Sessions of this programme done since it started (they're named after it). */
export function programSessions(plan: CoachPlan, workouts: Workout[]): Workout[] {
  const p = programById(plan.programId);
  if (!p) return [];
  return workouts.filter((w) => live(w) && w.startedAt >= plan.startedAt && (w.name ?? '').startsWith(`${p.short} · `)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Training max for a main lift: as set when the programme started (else 90% of the recent estimated max), plus one
 *  step for each wave done since. */
export function trainingMax(plan: CoachPlan, exerciseId: string, workouts: Workout[], wavesDone: number, lower: boolean): number | undefined {
  const base = plan.maxes?.[exerciseId] ?? (() => { const pts = e1rmSeries(exerciseId, workouts); return pts.length ? Math.max(...pts.slice(-4).map((p) => p.v)) * 0.9 : undefined; })();
  return base === undefined ? undefined : base + wavesDone * (lower ? 5 : 2.5);
}

export function nextSession(plan: CoachPlan, workouts: Workout[], body: BodyEntry[], defs: ExerciseDef[], now: number): PlannedSession | null {
  const prog = programById(plan.programId);
  if (!prog) return null;
  const rot = prog.rotation(plan.days);
  const done = programSessions(plan, workouts);
  const n = done.length;
  const day = rot[n % rot.length];
  const perWeek = Math.max(1, plan.days);
  const week = Math.floor(n / perWeek);
  const info = assessLevel(plan, workouts, body, now);
  const ladders = prog.scheme === 'ladder' || plan.kit === 'none' ? ladderSteps(workouts.filter(strengthWorkout), plan.experience, plan.kit) : undefined;
  let phase: string | undefined;
  const items: PlannedItem[] = [];
  // Specialisation: the two muscles with the fewest working sets over the last four weeks.
  const focus = prog.id === 'mus-5' ? weakMuscles(workouts, defs, now) : [];
  for (const slot of day.slots) {
    const def = pickExercise(slot.role, plan.kit, defs, { ladders, level: info.level, bodyweight: prog.goal === 'bodyweight' });
    if (!def) continue;
    const item: PlannedItem = { exerciseId: def.id, name: def.name, sets: slot.sets, reps: slot.reps, repsMax: slot.repsMax, main: slot.main };
    const lower = def.pattern === 'legs' || def.id === 'deadlift';
    if (slot.main && (prog.scheme === 'wave' || prog.scheme === 'block') && !def.bodyweight) {
      const len = prog.weeks!;
      const wk = week % len;
      const tm = trainingMax(plan, def.id, workouts, Math.floor(week / len), lower);
      if (prog.scheme === 'wave') {
        phase = ['Week 1: fives', 'Week 2: threes', 'Week 3: 5/3/1', 'Week 4: lighter'][wk];
        item.sets = 3; item.repsBySet = WAVE_REPS[wk]; item.reps = WAVE_REPS[wk][0];
        if (tm) item.weights = WAVE[wk].map((p) => roundKg(tm * p, def.increment || 2.5));
        item.note = wk < 3 ? 'Last set: as many as you can with good form' : 'Lighter week: easy, crisp reps';
      } else {
        const max = tm ? tm / 0.9 : undefined;
        const ph = wk < 4 ? { name: 'Build', sets: 4, reps: 8, pct: 0.65 + 0.025 * wk } : wk < 8 ? { name: 'Strength', sets: 4, reps: 4, pct: 0.78 + 0.025 * (wk - 4) }
          : wk < 11 ? { name: 'Peak', sets: 3, reps: 2, pct: 0.88 + 0.03 * (wk - 8) } : { name: 'Test', sets: 1, reps: 1, pct: 1 };
        phase = `Week ${wk + 1} of ${len}: ${ph.name.toLowerCase()}`;
        item.sets = ph.sets; item.reps = ph.reps;
        if (max) item.weights = Array(ph.sets).fill(roundKg(max * ph.pct, def.increment || 2.5));
        if (ph.name === 'Test') item.note = 'Work up to a heavy single, only as far as it moves well';
      }
    } else if (slot.light && !def.bodyweight) {
      // A light or medium day: a share of the last heavy day's weight on this lift.
      const heavy = done.filter((w) => w.name?.endsWith('· Heavy')).at(-1);
      const top = heavy ? Math.max(0, ...working(heavy.sets).filter((x) => x.exerciseId === def.id).map((x) => x.weightKg)) : 0;
      if (top) { item.weights = Array(slot.sets).fill(roundKg(top * slot.light, def.increment || 2.5)); item.note = `${Math.round(slot.light * 100)}% of your heavy day`; }
    } else if (prog.scheme === 'volume') {
      const len = prog.weeks!;
      const wk = week % len;
      const last = wk === len - 1;
      phase = last ? `Week ${len}: lighter` : `Week ${wk + 1} of ${len}: about ${Math.max(0, 3 - wk)} rep${3 - wk === 1 ? '' : 's'} in reserve`;
      const extra = focus.includes(def.muscles[0]) ? 2 : 0;
      item.sets = last ? Math.max(1, Math.ceil(slot.sets / 2)) : Math.min(slot.sets + Math.min(wk, 3) + extra, 8);
      if (extra) item.note = `Focus: extra sets for ${def.muscles[0]}`;
    } else if (prog.scheme === 'ladder' && LADDER_FOR[slot.role]) {
      const l = LADDERS.find((x) => x.id === LADDER_FOR[slot.role])!;
      const i = l.steps.indexOf(def.id);
      const nextStep = l.steps[i + 1];
      item.note = nextStep && defs.find((d) => d.id === nextStep) ? `Hit ${l.target.sets} × ${l.timed ? `${l.target.reps} s` : l.target.reps} twice and ${defs.find((d) => d.id === nextStep)!.name.toLowerCase()} comes in` : 'Top of this ladder: add reps, slow the lowering, or add weight';
    }
    items.push(item);
  }
  return { program: prog, day, title: `${prog.short} · ${day.name}`, n, week, phase, items, cardio: day.cardio };
}

/** The two muscles with the fewest working sets over the last four weeks (of those trained at all). */
export function weakMuscles(workouts: Workout[], defs: ExerciseDef[], now: number): string[] {
  const count = new Map<string, number>();
  for (const w of workouts.filter((x) => strengthWorkout(x) && Date.parse(x.startedAt) > now - 28 * DAY)) {
    for (const s of working(w.sets)) { const m = defs.find((d) => d.id === s.exerciseId)?.muscles[0]; if (m) count.set(m, (count.get(m) ?? 0) + 1); }
  }
  return [...count.entries()].filter(([m]) => m !== 'core').sort((a, b) => a[1] - b[1]).slice(0, 2).map(([m]) => m);
}

// ── Moving on ────────────────────────────────────────────────────────────────────────────────────────

export interface MoveOn { to: Program; reasons: string[] }

/** Ready for the next programme: the level has passed this one, or (after its minimum weeks) most main lifts have
 *  stopped going up, or on bodyweight, most ladders are past its range. */
export function readyToMoveOn(plan: CoachPlan, info: LevelInfo, workouts: Workout[], defs: ExerciseDef[], now: number): MoveOn | null {
  const prog = programById(plan.programId);
  if (!prog?.next) return null;
  const to = programById(prog.next)!;
  const weeksIn = (now - Date.parse(plan.startedAt)) / WEEK;
  const reasons: string[] = [];
  if (info.level > prog.levels[1]) reasons.push(`You're at ${levelName(info.level)} level now; this programme is for ${levelName(prog.levels[1])}.`);
  if (weeksIn >= prog.minWeeks) {
    const done = programSessions(plan, workouts);
    const mains = [...new Set(done.flatMap((w) => working(w.sets).map((s) => s.exerciseId)))]
      .filter((id) => prog.rotation(plan.days).some((d) => d.slots.some((sl) => sl.main && pickExercise(sl.role, plan.kit, defs, { level: info.level, bodyweight: false })?.id === id)));
    const stuck = mains.filter((id) => plateau(id, workouts, now));
    if (mains.length && stuck.length >= Math.ceil(mains.length / 2)) reasons.push(`${stuck.length} of your ${mains.length} main lifts have stopped going up after ${Math.floor(weeksIn)} weeks: the sign this programme has done its job.`);
    if (prog.scheme === 'ladder' && info.ladderLevel && info.ladderLevel > prog.levels[1]) reasons.push('Most of your ladders are past this programme’s versions.');
  }
  return reasons.length ? { to, reasons } : null;
}

/** Body weight on a date (the nearest weigh-in before it), for strength ratios. */
export const weightOn = (body: BodyEntry[], t: number) => body.filter((b) => live(b) && b.weightKg !== undefined && ymdToMs(b.date) <= t).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weightKg;
