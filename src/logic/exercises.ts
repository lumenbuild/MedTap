// Built-in exercises (the person can add their own). Muscles are the main ones worked, for weekly sets per muscle.
import type { Exercise, MuscleGroup } from '../db/schema';

export interface ExerciseDef { id: string; name: string; muscles: MuscleGroup[]; pattern: 'push' | 'pull' | 'legs' | 'core'; bodyweight?: boolean; increment: number }

export const BUILT_IN: ExerciseDef[] = [
  { id: 'squat', name: 'Back squat', muscles: ['quads', 'glutes'], pattern: 'legs', increment: 2.5 },
  { id: 'front-squat', name: 'Front squat', muscles: ['quads', 'glutes'], pattern: 'legs', increment: 2.5 },
  { id: 'deadlift', name: 'Deadlift', muscles: ['hamstrings', 'glutes', 'back'], pattern: 'pull', increment: 5 },
  { id: 'rdl', name: 'Romanian deadlift', muscles: ['hamstrings', 'glutes'], pattern: 'legs', increment: 2.5 },
  { id: 'leg-press', name: 'Leg press', muscles: ['quads', 'glutes'], pattern: 'legs', increment: 5 },
  { id: 'lunge', name: 'Lunge', muscles: ['quads', 'glutes'], pattern: 'legs', increment: 2 },
  { id: 'leg-curl', name: 'Leg curl', muscles: ['hamstrings'], pattern: 'legs', increment: 2.5 },
  { id: 'leg-ext', name: 'Leg extension', muscles: ['quads'], pattern: 'legs', increment: 2.5 },
  { id: 'hip-thrust', name: 'Hip thrust', muscles: ['glutes', 'hamstrings'], pattern: 'legs', increment: 5 },
  { id: 'calf-raise', name: 'Calf raise', muscles: ['calves'], pattern: 'legs', increment: 2.5 },
  { id: 'bench', name: 'Bench press', muscles: ['chest', 'triceps', 'shoulders'], pattern: 'push', increment: 2.5 },
  { id: 'incline-db', name: 'Incline dumbbell press', muscles: ['chest', 'shoulders', 'triceps'], pattern: 'push', increment: 2 },
  { id: 'ohp', name: 'Overhead press', muscles: ['shoulders', 'triceps'], pattern: 'push', increment: 2.5 },
  { id: 'lateral-raise', name: 'Lateral raise', muscles: ['shoulders'], pattern: 'push', increment: 1 },
  { id: 'dip', name: 'Dip', muscles: ['chest', 'triceps'], pattern: 'push', bodyweight: true, increment: 2.5 },
  { id: 'push-up', name: 'Push-up', muscles: ['chest', 'triceps'], pattern: 'push', bodyweight: true, increment: 0 },
  { id: 'triceps-ext', name: 'Triceps extension', muscles: ['triceps'], pattern: 'push', increment: 1 },
  { id: 'row', name: 'Barbell row', muscles: ['back', 'biceps'], pattern: 'pull', increment: 2.5 },
  { id: 'db-row', name: 'Dumbbell row', muscles: ['back', 'biceps'], pattern: 'pull', increment: 2 },
  { id: 'pull-up', name: 'Pull-up', muscles: ['back', 'biceps'], pattern: 'pull', bodyweight: true, increment: 2.5 },
  { id: 'lat-pulldown', name: 'Lat pulldown', muscles: ['back', 'biceps'], pattern: 'pull', increment: 2.5 },
  { id: 'cable-row', name: 'Seated cable row', muscles: ['back', 'biceps'], pattern: 'pull', increment: 2.5 },
  { id: 'face-pull', name: 'Face pull', muscles: ['shoulders', 'back'], pattern: 'pull', increment: 1 },
  { id: 'curl', name: 'Biceps curl', muscles: ['biceps'], pattern: 'pull', increment: 1 },
  { id: 'plank', name: 'Plank (seconds as reps)', muscles: ['core'], pattern: 'core', bodyweight: true, increment: 0 },
  { id: 'crunch', name: 'Cable crunch', muscles: ['core'], pattern: 'core', increment: 2.5 },
];

export const MUSCLES: { id: MuscleGroup; name: string; upper: boolean }[] = [
  { id: 'chest', name: 'Chest', upper: true }, { id: 'back', name: 'Back', upper: true }, { id: 'shoulders', name: 'Shoulders', upper: true },
  { id: 'biceps', name: 'Biceps', upper: true }, { id: 'triceps', name: 'Triceps', upper: true }, { id: 'core', name: 'Core', upper: true },
  { id: 'quads', name: 'Quads', upper: false }, { id: 'hamstrings', name: 'Hamstrings', upper: false }, { id: 'glutes', name: 'Glutes', upper: false },
  { id: 'calves', name: 'Calves', upper: false },
];

/** Built-in and the person's own exercises, as one list. */
export function allExercises(own: Exercise[] = []): ExerciseDef[] {
  return [
    ...BUILT_IN,
    ...own.filter((e) => !e.deletedAt).map((e) => ({ id: e.id, name: e.name, muscles: e.muscles, pattern: e.pattern ?? 'push', bodyweight: e.bodyweight, increment: e.increment ?? 2.5 })),
  ];
}

export const exerciseName = (id: string, own: Exercise[] = []) => allExercises(own).find((e) => e.id === id)?.name ?? 'Exercise';
