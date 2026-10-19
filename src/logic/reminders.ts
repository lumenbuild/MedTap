// When Today should show its gentle prompts. Pure; `now` is always passed in.
import type { CheckIn, Dose, Medication } from '../db/schema';

const DAY = 86_400_000;
const SIX_HOURS = 6 * 3_600_000;

/** Back up if the last backup (or, if never, the first record) is over 7 days old. No data, no prompt. */
export function needsBackup(lastBackupAt: string | null, earliestRecordAt: number | null, now: number): boolean {
  if (earliestRecordAt === null) return false;
  const ref = lastBackupAt ? Date.parse(lastBackupAt) : earliestRecordAt;
  return now - ref > 7 * DAY;
}

/** The dose to ask "how are you feeling?" about: the latest dose, once `delayMin` has passed, for up to 6 hours,
 *  unless there's already a check-in since it or the prompt was dismissed. */
export function checkInPromptDose(doses: Dose[], checkIns: CheckIn[], now: number, delayMin: number, dismissedId: string | null): Dose | undefined {
  if (delayMin <= 0) return undefined;
  let last: Dose | undefined;
  for (const d of doses) if (!d.deletedAt && Date.parse(d.takenAt) <= now && (!last || d.takenAt > last.takenAt)) last = d;
  if (!last || last.id === dismissedId) return undefined;
  const t = Date.parse(last.takenAt);
  if (now - t < delayMin * 60_000 || now - t > SIX_HOURS) return undefined;
  if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= t)) return undefined;
  return last;
}

/** Active medications at or below their low-stock level, unless dismissed at the current count. */
export function lowStockMeds(meds: Medication[], dismissed: Record<string, number>): Medication[] {
  return meds.filter((m) => !m.archived && m.stockCount !== undefined && m.lowStockAt !== undefined
    && m.stockCount <= m.lowStockAt && dismissed[m.id] !== m.stockCount);
}
