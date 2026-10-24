// "Get set up" on Today: the first things worth doing, each ticked from what's actually been done (not from tapping
// it). The card stays until the essentials are done (a medicine, a tag, a dose, a check-in; in TapWeigh a scales tag
// and a weigh-in; in TapLift a gym tag and a workout) or it's hidden; the rest (reminders, a PIN, a backup) are listed
// as good next steps but don't keep it there. Pure.
import type { CheckIn, Dose, Medication, Tag } from '../db/schema';

export type SetupId = 'med' | 'tag' | 'dose' | 'checkin' | 'reminders' | 'lock' | 'backup' | 'weigh' | 'goal' | 'workout';
export interface SetupItem { id: SetupId; label: string; hint: string; done: boolean; essential: boolean }

export function gettingStarted(d: {
  meds: Medication[]; tags: Tag[]; doses: Dose[]; checkIns: CheckIn[];
  remindersEnabled: boolean; lockEnabled: boolean; lastBackupAt: string | null; native: boolean;
  /** TapWeigh ('weight') and TapLift ('training') have their own first steps, each starting with a tag. */
  focus?: 'meds' | 'weight' | 'training'; weighIns?: number; hasGoal?: boolean; workouts?: number;
}): SetupItem[] {
  const meds = d.meds.filter((m) => !m.archived);
  const done = d.checkIns.some((c) => !c.deletedAt);
  const after: SetupItem[] = [
    { id: 'lock', label: 'Set a PIN', hint: 'Optional, so only you can open it', done: d.lockEnabled, essential: false },
    { id: 'backup', label: 'Make a backup', hint: 'Your records live only on this phone', done: !!d.lastBackupAt, essential: false },
  ];
  if (d.focus === 'weight') return [
    { id: 'tag', label: 'Put a tag on your scales', hint: 'Then one tap logs a weigh-in', done: d.tags.some((t) => t.action?.kind === 'weight'), essential: true },
    { id: 'weigh', label: 'Log a weigh-in', hint: 'Tap the tag, or Weight on Today', done: (d.weighIns ?? 0) > 0, essential: true },
    { id: 'goal', label: 'Set a goal', hint: 'And see when you’ll likely reach it', done: !!d.hasGoal, essential: false },
    { id: 'checkin', label: 'Do a check-in', hint: 'Energy, hunger, sleep, in a few taps', done, essential: false },
    ...after,
  ];
  if (d.focus === 'training') return [
    { id: 'tag', label: 'Put a tag on your gym bag or a machine', hint: 'One tap starts the workout or adds that exercise', done: d.tags.some((t) => !!t.action && ['exercise', 'routine', 'cardio'].includes(t.action.kind)), essential: true },
    { id: 'workout', label: 'Log a workout', hint: 'Tap the tag, or Start a workout', done: (d.workouts ?? 0) > 0, essential: true },
    { id: 'checkin', label: 'Do a check-in', hint: 'Soreness, sleep and energy feed your readiness', done, essential: false },
    ...after,
  ];
  const items: SetupItem[] = [
    { id: 'med', label: 'Add a medicine', hint: 'What, how much and when', done: meds.length > 0, essential: true },
    { id: 'tag', label: 'Link a tag', hint: 'On the medicine’s page', done: d.tags.some((t) => t.medicationId && meds.some((m) => m.id === t.medicationId)), essential: true },
    { id: 'dose', label: 'Log a dose', hint: 'Tap the tag, or Log on Today', done: d.doses.some((x) => !x.deletedAt), essential: true },
    { id: 'checkin', label: 'Do a check-in', hint: 'How you feel, in a few taps', done, essential: true },
    ...(d.native ? [{ id: 'reminders' as const, label: 'Turn on reminders', hint: 'When doses are due', done: d.remindersEnabled, essential: false }] : []),
    ...after,
  ];
  return items;
}

/** Whether the card shows: not hidden, and an essential step still to do. */
export const showGettingStarted = (items: SetupItem[], dismissed: boolean) => !dismissed && items.some((i) => i.essential && !i.done);
