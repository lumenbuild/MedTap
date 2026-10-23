// "Get set up" on Today: the first things worth doing, each ticked from what's actually been done (not from tapping
// it). The card stays until the essentials are done (a medicine, a tag, a dose, a check-in) or it's hidden; the rest
// (reminders, a PIN, a backup) are listed as good next steps but don't keep it there. Pure.
import type { CheckIn, Dose, Medication, Tag } from '../db/schema';

export type SetupId = 'med' | 'tag' | 'dose' | 'checkin' | 'reminders' | 'lock' | 'backup';
export interface SetupItem { id: SetupId; label: string; hint: string; done: boolean; essential: boolean }

export function gettingStarted(d: {
  meds: Medication[]; tags: Tag[]; doses: Dose[]; checkIns: CheckIn[];
  remindersEnabled: boolean; lockEnabled: boolean; lastBackupAt: string | null; native: boolean;
}): SetupItem[] {
  const meds = d.meds.filter((m) => !m.archived);
  const items: SetupItem[] = [
    { id: 'med', label: 'Add a medicine', hint: 'What, how much and when', done: meds.length > 0, essential: true },
    { id: 'tag', label: 'Link a tag', hint: 'On the medicine’s page', done: d.tags.some((t) => t.medicationId && meds.some((m) => m.id === t.medicationId)), essential: true },
    { id: 'dose', label: 'Log a dose', hint: 'Tap the tag, or Log on Today', done: d.doses.some((x) => !x.deletedAt), essential: true },
    { id: 'checkin', label: 'Do a check-in', hint: 'How you feel, in a few taps', done: d.checkIns.some((c) => !c.deletedAt), essential: true },
    ...(d.native ? [{ id: 'reminders' as const, label: 'Turn on reminders', hint: 'When doses are due', done: d.remindersEnabled, essential: false }] : []),
    { id: 'lock', label: 'Set a PIN', hint: 'Optional, so only you can open it', done: d.lockEnabled, essential: false },
    { id: 'backup', label: 'Make a backup', hint: 'Your records live only on this phone', done: !!d.lastBackupAt, essential: false },
  ];
  return items;
}

/** Whether the card shows: not hidden, and an essential step still to do. */
export const showGettingStarted = (items: SetupItem[], dismissed: boolean) => !dismissed && items.some((i) => i.essential && !i.done);
