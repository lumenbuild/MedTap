// What a Wear OS watch shows during a workout: the next set (exercise, set number, load) with a Done button, and the
// rest countdown. Pure: the workout screen sends this to the watch whenever it changes.
import type { Workout } from '../db/schema';
import type { Units } from '../db/repos/settings';
import type { ExerciseDef } from './exercises';
import { fmtLoad } from './load';

export interface WatchWorkout {
  active: boolean;
  title: string;
  /** The set the Done button ticks, or none when every set is done. */
  next?: { setId: string; exercise: string; label: string; load: string };
  done: number; total: number;
  /** Rest ends at (ms); 0 when not resting. */
  restUntil: number;
  /** When this was made, so the watch can drop a workout the phone never closed. */
  t: number;
}

export function watchWorkout(w: Workout | null, defOf: (id: string) => ExerciseDef, units: Units, restUntil: number, now: number): WatchWorkout {
  if (!w || w.endedAt || w.deletedAt) return { active: false, title: '', done: 0, total: 0, restUntil: 0, t: now };
  const s = w.sets.find((x) => !x.done);
  const def = s ? defOf(s.exerciseId) : undefined;
  const same = s ? w.sets.filter((x) => x.exerciseId === s.exerciseId && !x.warmup) : [];
  const label = !s ? '' : s.warmup ? 'Warm-up' : `Set ${same.indexOf(s) + 1} of ${same.length}`;
  const amount = s && def ? `${s.reps}${def.timed ? ' s' : ''}` : '';
  const load = !s || !def ? '' : s.weightKg ? `${fmtLoad(s.weightKg, units)}${def.perHand ? ' each' : ''} × ${amount}` : def.bodyweight ? `Bodyweight × ${amount}` : `× ${amount}`;
  return {
    active: true,
    title: w.name ?? 'Workout',
    next: s && def ? { setId: s.id, exercise: def.name, label, load } : undefined,
    done: w.sets.filter((x) => x.done).length, total: w.sets.length,
    restUntil: restUntil > now ? restUntil : 0,
    t: now,
  };
}
