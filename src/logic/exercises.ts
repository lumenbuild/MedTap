// Built-in exercises (the person can add their own). Muscles are the main ones worked (the first is the main one), for
// weekly sets per muscle and for suggesting a swap. Cues are short reminders of form, not coaching or medical advice.
import type { Exercise, MuscleGroup } from '../db/schema';

/** 'bodyweight' needs something to hang from or push off (a bar, dip station); 'none' needs nothing more than the floor,
 *  a wall, a chair or stairs, so it can be done anywhere. */
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'none';

export interface ExerciseDef {
  id: string; name: string; muscles: MuscleGroup[]; pattern: 'push' | 'pull' | 'legs' | 'core';
  /** Reps (and any added weight) rather than a load. */
  bodyweight?: boolean;
  /** How much to add when it's time to go up (kg; converted for lb). 0 = add reps instead. */
  increment: number;
  equipment?: Equipment;
  /** The weight is for each hand (dumbbells): volume counts both. */
  perHand?: boolean;
  /** Held for time: "reps" are seconds. */
  timed?: boolean;
  /** Works several joints (squat, press, row): heavier sets get longer rest. */
  compound?: boolean;
  cues?: string[];
}

const B = (id: string, name: string, muscles: MuscleGroup[], pattern: ExerciseDef['pattern'], equipment: Equipment, increment: number, cues: string[], o: Partial<ExerciseDef> = {}): ExerciseDef =>
  ({ id, name, muscles, pattern, equipment, increment, cues, ...(equipment === 'dumbbell' ? { perHand: true } : {}), ...(equipment === 'bodyweight' || equipment === 'none' ? { bodyweight: true } : {}), ...o });

export const BUILT_IN: ExerciseDef[] = [
  // Legs
  B('squat', 'Back squat', ['quads', 'glutes'], 'legs', 'barbell', 2.5, ['Brace before each rep', 'Knees track over toes', 'Depth you can hold with a neutral back'], { compound: true }),
  B('front-squat', 'Front squat', ['quads', 'glutes'], 'legs', 'barbell', 2.5, ['Elbows high', 'Stay upright'], { compound: true }),
  B('goblet-squat', 'Goblet squat', ['quads', 'glutes'], 'legs', 'dumbbell', 2, ['Hold the weight at your chest', 'Sit between your heels'], { compound: true, perHand: false }),
  B('deadlift', 'Deadlift', ['hamstrings', 'glutes', 'back'], 'pull', 'barbell', 5, ['Bar over mid-foot', 'Push the floor away', 'Bar close to your legs'], { compound: true }),
  B('rdl', 'Romanian deadlift', ['hamstrings', 'glutes'], 'legs', 'barbell', 2.5, ['Hips back, slight knee bend', 'Stop when your back would round'], { compound: true }),
  B('db-rdl', 'Dumbbell Romanian deadlift', ['hamstrings', 'glutes'], 'legs', 'dumbbell', 2, ['Hips back', 'Weights close to your legs'], { compound: true }),
  B('leg-press', 'Leg press', ['quads', 'glutes'], 'legs', 'machine', 5, ['Lower back stays on the pad', 'Don’t lock your knees at the top'], { compound: true }),
  B('hack-squat', 'Hack squat', ['quads', 'glutes'], 'legs', 'machine', 5, ['Feet shoulder-width', 'Control the way down'], { compound: true }),
  B('lunge', 'Lunge', ['quads', 'glutes'], 'legs', 'dumbbell', 2, ['Long enough step that your front knee stays over your foot'], { compound: true }),
  B('split-squat', 'Bulgarian split squat', ['quads', 'glutes'], 'legs', 'dumbbell', 2, ['Back foot on a bench', 'Most weight on the front leg'], { compound: true }),
  B('step-up', 'Step-up', ['quads', 'glutes'], 'legs', 'dumbbell', 2, ['Drive through the top foot', 'Step down slowly']),
  B('leg-curl', 'Leg curl', ['hamstrings'], 'legs', 'machine', 2.5, ['Hips stay down', 'Slow on the way back']),
  B('leg-ext', 'Leg extension', ['quads'], 'legs', 'machine', 2.5, ['Pause at the top', 'Slow on the way down']),
  B('hip-thrust', 'Hip thrust', ['glutes', 'hamstrings'], 'legs', 'barbell', 5, ['Chin tucked', 'Squeeze at the top'], { compound: true }),
  B('glute-bridge', 'Glute bridge', ['glutes', 'hamstrings'], 'legs', 'none', 0, ['Squeeze at the top', 'Ribs down']),
  B('calf-raise', 'Calf raise', ['calves'], 'legs', 'machine', 2.5, ['Full stretch at the bottom', 'Pause at the top']),
  B('kb-swing', 'Kettlebell swing', ['glutes', 'hamstrings'], 'legs', 'kettlebell', 4, ['Hinge, don’t squat', 'Snap the hips'], { compound: true }),
  // Push
  B('bench', 'Bench press', ['chest', 'triceps', 'shoulders'], 'push', 'barbell', 2.5, ['Shoulder blades back and down', 'Feet planted', 'Touch the lower chest'], { compound: true }),
  B('db-bench', 'Dumbbell bench press', ['chest', 'triceps', 'shoulders'], 'push', 'dumbbell', 2, ['Elbows about 45° from your body', 'Control the stretch'], { compound: true }),
  B('incline-bench', 'Incline bench press', ['chest', 'shoulders', 'triceps'], 'push', 'barbell', 2.5, ['Bench about 30°', 'Touch the upper chest'], { compound: true }),
  B('incline-db', 'Incline dumbbell press', ['chest', 'shoulders', 'triceps'], 'push', 'dumbbell', 2, ['Bench about 30°', 'Press up and slightly in'], { compound: true }),
  B('chest-press', 'Chest press machine', ['chest', 'triceps', 'shoulders'], 'push', 'machine', 5, ['Handles at mid-chest', 'Don’t lock out hard'], { compound: true }),
  B('cable-fly', 'Cable fly', ['chest'], 'push', 'cable', 2.5, ['Soft elbows', 'Hug a big tree']),
  B('ohp', 'Overhead press', ['shoulders', 'triceps'], 'push', 'barbell', 2.5, ['Squeeze glutes', 'Head through once the bar passes'], { compound: true }),
  B('db-shoulder-press', 'Dumbbell shoulder press', ['shoulders', 'triceps'], 'push', 'dumbbell', 2, ['Ribs down', 'Press without arching'], { compound: true }),
  B('lateral-raise', 'Lateral raise', ['shoulders'], 'push', 'dumbbell', 1, ['Lead with the elbows', 'Stop at shoulder height']),
  B('dip', 'Dip', ['chest', 'triceps'], 'push', 'bodyweight', 2.5, ['Shoulders down', 'Lower to a comfortable depth'], { compound: true }),
  B('push-up', 'Push-up', ['chest', 'triceps'], 'push', 'none', 0, ['Body in one line', 'Chest to just above the floor'], { compound: true }),
  B('triceps-ext', 'Triceps extension', ['triceps'], 'push', 'cable', 1, ['Elbows still', 'Full lockout']),
  B('skull-crusher', 'Skull crusher', ['triceps'], 'push', 'barbell', 1, ['Elbows point up', 'Lower behind your forehead']),
  // Pull
  B('row', 'Barbell row', ['back', 'biceps'], 'pull', 'barbell', 2.5, ['Flat back, hinge forward', 'Pull to your lower ribs'], { compound: true }),
  B('db-row', 'Dumbbell row', ['back', 'biceps'], 'pull', 'dumbbell', 2, ['Hand and knee on a bench', 'Elbow to your hip'], { compound: true }),
  B('pull-up', 'Pull-up', ['back', 'biceps'], 'pull', 'bodyweight', 2.5, ['Start from a dead hang', 'Chest to the bar'], { compound: true }),
  B('chin-up', 'Chin-up', ['back', 'biceps'], 'pull', 'bodyweight', 2.5, ['Palms facing you', 'Control the way down'], { compound: true }),
  B('assisted-pull-up', 'Assisted pull-up', ['back', 'biceps'], 'pull', 'machine', 5, ['Less assistance as you get stronger'], { compound: true }),
  B('lat-pulldown', 'Lat pulldown', ['back', 'biceps'], 'pull', 'cable', 2.5, ['Pull to your upper chest', 'Don’t lean far back'], { compound: true }),
  B('cable-row', 'Seated cable row', ['back', 'biceps'], 'pull', 'cable', 2.5, ['Sit tall', 'Squeeze the shoulder blades'], { compound: true }),
  B('machine-row', 'Chest-supported row', ['back', 'biceps'], 'pull', 'machine', 5, ['Chest stays on the pad', 'Elbows back'], { compound: true }),
  B('face-pull', 'Face pull', ['shoulders', 'back'], 'pull', 'cable', 1, ['Pull to your forehead', 'Thumbs back']),
  B('rear-delt', 'Rear delt fly', ['shoulders', 'back'], 'pull', 'dumbbell', 1, ['Hinge forward', 'Arms out wide, slight bend']),
  B('shrug', 'Shrug', ['back'], 'pull', 'dumbbell', 2, ['Straight up, no rolling', 'Pause at the top']),
  B('curl', 'Biceps curl', ['biceps'], 'pull', 'dumbbell', 1, ['Elbows by your sides', 'No swinging']),
  B('hammer-curl', 'Hammer curl', ['biceps'], 'pull', 'dumbbell', 1, ['Thumbs up', 'Elbows still']),
  B('cable-curl', 'Cable curl', ['biceps'], 'pull', 'cable', 1, ['Elbows still', 'Squeeze at the top']),
  B('dead-hang', 'Dead hang', ['back'], 'pull', 'bodyweight', 0, ['Shoulders slightly engaged', 'Breathe'], { timed: true }),
  // Core
  B('plank', 'Plank', ['core'], 'core', 'none', 0, ['Body in one line', 'Squeeze glutes', 'Breathe'], { timed: true }),
  B('side-plank', 'Side plank', ['core'], 'core', 'none', 0, ['Hips high', 'Elbow under your shoulder'], { timed: true }),
  B('crunch', 'Cable crunch', ['core'], 'core', 'cable', 2.5, ['Curl your ribs to your hips', 'Hips stay still']),
  B('hanging-raise', 'Hanging leg raise', ['core'], 'core', 'bodyweight', 0, ['No swinging', 'Curl the pelvis up']),
  B('dead-bug', 'Dead bug', ['core'], 'core', 'none', 0, ['Lower back stays down', 'Slow']),
  B('farmer-carry', 'Farmer’s carry', ['core', 'back'], 'core', 'dumbbell', 2, ['Tall posture', 'Short quick steps'], { timed: true }),

  // No equipment: the floor, a wall, a chair or stairs at most. They go up by reps (or seconds), then by the harder
  // version listed in the cues.
  B('air-squat', 'Bodyweight squat', ['quads', 'glutes'], 'legs', 'none', 0, ['Sit between your heels', 'Chest up', 'Harder: pause at the bottom'], { compound: true }),
  B('jump-squat', 'Jump squat', ['quads', 'glutes', 'calves'], 'legs', 'none', 0, ['Land softly, knees over toes', 'Reset between reps'], { compound: true }),
  B('reverse-lunge', 'Reverse lunge', ['quads', 'glutes'], 'legs', 'none', 0, ['Step back, drop the back knee', 'Push through the front heel'], { compound: true }),
  B('walking-lunge', 'Walking lunge', ['quads', 'glutes'], 'legs', 'none', 0, ['Long steps', 'Stay tall'], { compound: true }),
  B('bw-split-squat', 'Split squat (chair)', ['quads', 'glutes'], 'legs', 'none', 0, ['Back foot on a chair', 'Most weight on the front leg'], { compound: true }),
  B('cossack-squat', 'Cossack squat', ['quads', 'glutes'], 'legs', 'none', 0, ['Wide stance, sit to one side', 'Other leg straight, toes up']),
  B('wall-sit', 'Wall sit', ['quads'], 'legs', 'none', 0, ['Thighs level with the floor', 'Back flat on the wall'], { timed: true }),
  B('bw-step-up', 'Step-up (stairs or chair)', ['quads', 'glutes'], 'legs', 'none', 0, ['Whole foot on the step', 'Drive through the top foot']),
  B('sl-glute-bridge', 'Single-leg glute bridge', ['glutes', 'hamstrings'], 'legs', 'none', 0, ['Hips level', 'Squeeze at the top']),
  B('sl-rdl', 'Single-leg Romanian deadlift', ['hamstrings', 'glutes'], 'legs', 'none', 0, ['Hips square', 'Reach back with the free leg']),
  B('bw-calf-raise', 'Calf raise (step)', ['calves'], 'legs', 'none', 0, ['Heels off a step', 'Full stretch, pause at the top', 'Harder: one leg']),
  B('incline-push-up', 'Incline push-up', ['chest', 'triceps'], 'push', 'none', 0, ['Hands on a bench, bed or wall', 'Body in one line', 'Lower the hands as it gets easy'], { compound: true }),
  B('knee-push-up', 'Knee push-up', ['chest', 'triceps'], 'push', 'none', 0, ['Line from knees to head', 'Chest to just above the floor'], { compound: true }),
  B('decline-push-up', 'Decline push-up', ['chest', 'shoulders', 'triceps'], 'push', 'none', 0, ['Feet on a chair or step', 'Body in one line'], { compound: true }),
  B('diamond-push-up', 'Close-grip push-up', ['triceps', 'chest'], 'push', 'none', 0, ['Hands under your chest', 'Elbows close to your body'], { compound: true }),
  B('pike-push-up', 'Pike push-up', ['shoulders', 'triceps'], 'push', 'none', 0, ['Hips high', 'Head moves forward of your hands'], { compound: true }),
  B('chair-dip', 'Chair dip', ['triceps', 'chest'], 'push', 'none', 0, ['Hands on a sturdy chair behind you', 'Shoulders down', 'Harder: legs straight']),
  B('table-row', 'Table row', ['back', 'biceps'], 'pull', 'none', 0, ['Under a sturdy table, hands on the edge', 'Body in one line', 'Chest to the table'], { compound: true }),
  B('superman', 'Superman', ['back', 'glutes'], 'pull', 'none', 0, ['Lift arms and legs together', 'Pause, then lower slowly']),
  B('prone-ytw', 'Y-T-W raise (lying)', ['shoulders', 'back'], 'pull', 'none', 0, ['Face down, thumbs up', 'Make a Y, a T and a W']),
  B('snow-angel', 'Reverse snow angel', ['back', 'shoulders'], 'pull', 'none', 0, ['Face down, arms just off the floor', 'Sweep from hips to overhead']),
  B('crunch-floor', 'Crunch', ['core'], 'core', 'none', 0, ['Ribs to hips', 'Chin off your chest']),
  B('reverse-crunch', 'Reverse crunch', ['core'], 'core', 'none', 0, ['Curl your hips off the floor', 'Lower slowly']),
  B('lying-leg-raise', 'Lying leg raise', ['core'], 'core', 'none', 0, ['Lower back stays down', 'Stop before it arches']),
  B('bicycle-crunch', 'Bicycle crunch', ['core'], 'core', 'none', 0, ['Elbow towards the opposite knee', 'Slow and controlled']),
  B('bird-dog', 'Bird dog', ['core', 'back'], 'core', 'none', 0, ['Opposite arm and leg', 'Hips level']),
  B('hollow-hold', 'Hollow hold', ['core'], 'core', 'none', 0, ['Lower back pressed down', 'Easier: knees bent'], { timed: true }),
  B('mountain-climber', 'Mountain climber', ['core', 'shoulders'], 'core', 'none', 0, ['Hands under shoulders', 'Knees drive in quickly'], { timed: true }),
  B('bear-plank', 'Bear plank', ['core', 'shoulders'], 'core', 'none', 0, ['Knees just off the floor', 'Back flat'], { timed: true }),
  B('burpee', 'Burpee', ['quads', 'chest', 'core'], 'legs', 'none', 0, ['Chest to the floor, jump at the top', 'Easier: step back instead of jumping'], { compound: true }),
];

/** Ready-made sessions that need no equipment (shown under Start a workout). Sets and reps are a starting point; the
 *  usual progression adds reps from there. */
export const NO_KIT_SESSIONS: { name: string; items: { exerciseId: string; sets: number; reps: number }[] }[] = [
  { name: 'Full body, no equipment', items: [
    { exerciseId: 'air-squat', sets: 3, reps: 15 }, { exerciseId: 'incline-push-up', sets: 3, reps: 10 }, { exerciseId: 'table-row', sets: 3, reps: 8 },
    { exerciseId: 'reverse-lunge', sets: 2, reps: 10 }, { exerciseId: 'glute-bridge', sets: 2, reps: 15 }, { exerciseId: 'plank', sets: 2, reps: 30 },
  ] },
  { name: 'Upper body and core, no equipment', items: [
    { exerciseId: 'push-up', sets: 3, reps: 10 }, { exerciseId: 'table-row', sets: 3, reps: 10 }, { exerciseId: 'pike-push-up', sets: 2, reps: 8 },
    { exerciseId: 'chair-dip', sets: 2, reps: 10 }, { exerciseId: 'snow-angel', sets: 2, reps: 10 }, { exerciseId: 'hollow-hold', sets: 2, reps: 20 },
  ] },
  { name: 'Legs and core, no equipment', items: [
    { exerciseId: 'bw-split-squat', sets: 3, reps: 10 }, { exerciseId: 'sl-rdl', sets: 3, reps: 10 }, { exerciseId: 'wall-sit', sets: 2, reps: 45 },
    { exerciseId: 'sl-glute-bridge', sets: 2, reps: 12 }, { exerciseId: 'bw-calf-raise', sets: 3, reps: 15 }, { exerciseId: 'bird-dog', sets: 2, reps: 10 },
  ] },
];

export const MUSCLES: { id: MuscleGroup; name: string; upper: boolean }[] = [
  { id: 'chest', name: 'Chest', upper: true }, { id: 'back', name: 'Back', upper: true }, { id: 'shoulders', name: 'Shoulders', upper: true },
  { id: 'biceps', name: 'Biceps', upper: true }, { id: 'triceps', name: 'Triceps', upper: true }, { id: 'core', name: 'Core', upper: true },
  { id: 'quads', name: 'Quads', upper: false }, { id: 'hamstrings', name: 'Hamstrings', upper: false }, { id: 'glutes', name: 'Glutes', upper: false },
  { id: 'calves', name: 'Calves', upper: false },
];

export const EQUIPMENT: { id: Equipment; name: string }[] = [
  { id: 'barbell', name: 'Barbell' }, { id: 'dumbbell', name: 'Dumbbells' }, { id: 'machine', name: 'Machine' },
  { id: 'cable', name: 'Cable' }, { id: 'bodyweight', name: 'Bodyweight (bar or dip station)' }, { id: 'kettlebell', name: 'Kettlebell' },
  { id: 'none', name: 'No equipment' },
];

/** Built-in and the person's own exercises, as one list. */
export function allExercises(own: Exercise[] = []): ExerciseDef[] {
  return [
    ...BUILT_IN,
    ...own.filter((e) => !e.deletedAt).map((e) => ({
      id: e.id, name: e.name, muscles: e.muscles, pattern: e.pattern ?? 'push', bodyweight: e.bodyweight, increment: e.increment ?? 2.5,
      equipment: e.equipment, perHand: e.perHand, timed: e.timed,
    })),
  ];
}

export const exerciseName = (id: string, own: Exercise[] = []) => allExercises(own).find((e) => e.id === id)?.name ?? 'Exercise';

/** Exercises that work the same main muscle in the same way, for when a machine is busy or something doesn't suit:
 *  ones you've done before first (most recent first), then those sharing the most muscles. */
export function swapsFor(def: ExerciseDef, defs: ExerciseDef[], lastDone: Map<string, number> = new Map(), n = 5): ExerciseDef[] {
  const main = def.muscles[0];
  const shared = (d: ExerciseDef) => d.muscles.filter((m) => def.muscles.includes(m)).length;
  return defs
    .filter((d) => d.id !== def.id && d.muscles[0] === main && !!d.timed === !!def.timed)
    .sort((a, b) => (lastDone.get(b.id) ?? 0) - (lastDone.get(a.id) ?? 0) || shared(b) - shared(a) || (a.equipment === def.equipment ? 1 : 0) - (b.equipment === def.equipment ? 1 : 0))
    .slice(0, n);
}
