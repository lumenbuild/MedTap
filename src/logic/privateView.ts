// The private view: opening the app with the second (privacy) PIN shows the same app, with the medicines the person
// chose either under a cover name or left out entirely (with their doses, tags and history), and the peptide tools
// left out. Nothing on screen says it's a different view. It's a privacy screen for a glance over the shoulder or a
// phone that has to be handed over, not encryption: the data is still on the phone. Pure.
import type { Medication } from '../db/schema';

export type ViewMode = 'full' | 'private';
export type PrivateRule = 'show' | 'cover' | 'hide';

/** How a medicine appears in the private view. Peptides are left out with the peptide tools unless set otherwise. */
export function privateRule(m: Pick<Medication, 'privateView' | 'peptide'>, hidePeptides: boolean): PrivateRule {
  if (m.privateView) return m.privateView;
  return hidePeptides && m.peptide ? 'hide' : 'show';
}

/** A medicine under its cover name: nothing that would give the real one away (ingredients, instructions, notes,
 *  peptide setup, vials, batches). It keeps its colour, schedule, doses and stock, so it reads as an ordinary
 *  medicine. */
export function disguise(m: Medication): Medication {
  return {
    ...m, name: m.coverName?.trim() || 'Medication', nickname: undefined, ingredients: undefined, instructions: undefined,
    instructionsBy: undefined, instructionsUpdatedAt: undefined, scriptNotes: undefined, peptide: undefined, vials: undefined,
    lotFlags: undefined, stepUp: undefined, form: m.form === 'injection' ? 'other' : m.form,
  };
}

/** The medicines as the private view shows them. */
export function viewMeds(meds: Medication[], hidePeptides: boolean): Medication[] {
  return meds.flatMap((m) => {
    const r = privateRule(m, hidePeptides);
    return r === 'hide' ? [] : r === 'cover' ? [disguise(m)] : [m];
  });
}

/** Ids of the medicines the private view leaves out (to drop their doses, tags and history too). */
export const hiddenMedIds = (meds: Medication[], hidePeptides: boolean) =>
  new Set(meds.filter((m) => privateRule(m, hidePeptides) === 'hide').map((m) => m.id));

/** Drop records that belong to a left-out medicine. */
export const withoutHidden = <T extends { medicationId?: string }>(rows: T[], hidden: Set<string>) =>
  hidden.size ? rows.filter((r) => !r.medicationId || !hidden.has(r.medicationId)) : rows;

/** Where anyone can see without unlocking (reminders, widgets, the watch, shortcuts) while a privacy PIN is set:
 *  covered medicines use their cover name and left-out ones a plain "Reminder"; null means leave it out where it can
 *  be (widgets, shortcuts). */
export function discreetName(m: Medication, hidePeptides: boolean, shown: (m: Medication) => string): string | null {
  const r = privateRule(m, hidePeptides);
  return r === 'hide' ? null : r === 'cover' ? disguise(m).name : shown(m);
}
