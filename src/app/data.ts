import { db } from '../db/db';
import { useLive } from '../db/live';
import { getSettings, scheduleSettings, type AppSettings } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';
import { listPeople } from '../db/repos/people';
import { DEFAULT_PERSON } from '../db/schema';
import { hiddenMedIds, viewMeds, withoutHidden } from '../logic/privateView';
import { isPrivateView, useViewMode } from './viewMode';
import { HAS_MEDS } from '../edition';

// In the private view (see logic/privateView.ts) these hooks are where it happens: left-out medicines and everything
// of theirs disappear, covered ones come back under their cover name, and the peptide tools read as off. Screens
// don't need to know.
async function viewSettings(): Promise<AppSettings> {
  const s = await getSettings();
  return isPrivateView() && s.privacyHidePeptides ? { ...s, peptideTools: false } : s;
}
async function hidden(): Promise<Set<string>> {
  if (!isPrivateView()) return new Set();
  const [meds, s] = await Promise.all([db.medications.toArray(), getSettings()]);
  return hiddenMedIds(meds, s.privacyHidePeptides);
}
/** Drop a left-out medicine's records (private view only). */
export async function inView<T extends { medicationId?: string }>(rows: T[]): Promise<T[]> {
  return withoutHidden(rows, await hidden());
}

export const useSettings = () => { const v = useViewMode(); return useLive(viewSettings, [v]); };
// TapWeigh and TapLift have no medicines: even a restored backup that has some shows none.
export const useMeds = () => {
  const v = useViewMode();
  return useLive(async () => {
    if (!HAS_MEDS) return [];
    const meds = await db.medications.orderBy('name').toArray();
    if (v === 'full') return meds;
    return viewMeds(meds, (await getSettings()).privacyHidePeptides).sort((a, b) => a.name.localeCompare(b.name));
  }, [v]);
};
export const useDoses = () => { const v = useViewMode(); return useLive(async () => (HAS_MEDS ? inView(await db.doses.toArray()) : []), [v]); };
export const useTags = () => { const v = useViewMode(); return useLive(async () => inView(await db.tags.toArray()), [v]); };

export function useScheduleSettings(): [AppSettings, ScheduleSettings] | undefined {
  const s = useSettings();
  return s ? [s, scheduleSettings(s)] : undefined;
}
export const useCheckIns = () => useLive(() => db.checkIns.toArray());
export const useBodyEntries = () => useLive(() => db.bodyEntries.orderBy('date').toArray());
export const useMedEvents = () => { const v = useViewMode(); return useLive(async () => inView(await db.medEvents.toArray()), [v]); };
export const useVitals = () => useLive(() => db.vitals.toArray());
export const useSupplies = () => { const v = useViewMode(); return useLive(async () => ((await viewSettings()).peptideTools ? db.supplies.toArray() : []), [v]); };
export const usePeople = () => useLive(listPeople);
export const useLabs = () => useLive(() => db.labs.toArray());
export const useExperiments = () => useLive(() => db.experiments.toArray());
export const useAppointments = () => useLive(() => db.appointments.toArray());
export const useQuestions = () => useLive(() => db.questions.toArray());
export const useDaily = () => useLive(() => db.daily.toArray());
export const useExercises = () => useLive(() => db.exercises.toArray());
export const useWorkouts = () => useLive(() => db.workouts.toArray());
export const useRoutines = () => useLive(() => db.routines.toArray());

/** The family member being shown, validated against the people list, plus Today's "Everyone" mode. */
export function useFamily() {
  const people = usePeople();
  const settings = useSettings();
  if (!people || !settings) return undefined;
  const personId = people.some((p) => p.id === settings.activePersonId) ? settings.activePersonId : DEFAULT_PERSON;
  const many = people.length > 1;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Me';
  return { people, personId, many, everyone: many && settings.todayEveryone, nameOf, person: nameOf(personId) };
}
