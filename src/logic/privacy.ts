// Nicknames: a medication can be shown under a different name, with a plain grey badge, so a glance at the
// screen (or a calendar reminder on the lock screen) doesn't reveal what it is. Tracking is unchanged.
import type { Medication } from '../db/schema';
import { fmtMedName } from './format';

export const PRIVATE_COLOUR = 'private';

export const isPrivate = (m: Pick<Medication, 'nickname'>) => !!m.nickname?.trim();

/** The name to show on screen: the nickname if there is one. */
export const shownName = (m: Pick<Medication, 'name' | 'nickname'>) => m.nickname?.trim() || m.name;

/** "Ritalin 10 mg", or just the nickname (strength would be a hint). */
export const shownMedName = (m: Pick<Medication, 'name' | 'nickname' | 'strength' | 'unit'>) => (isPrivate(m) ? shownName(m) : fmtMedName(m));

/** Colour to draw the badge and ring with: plain grey for nicknamed medications. */
export const shownColour = (m: Pick<Medication, 'color' | 'nickname'>) => (isPrivate(m) ? PRIVATE_COLOUR : m.color);
