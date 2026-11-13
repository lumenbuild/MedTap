import { db } from '../db/db';
import { memoLast, useShared } from '../db/live';
import { getSettings, scheduleSettings, type AppSettings } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';
import { listPeople } from '../db/repos/people';
import { DEFAULT_PERSON, type Person } from '../db/schema';
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

// Each table is read once for the whole app (see useShared), so every card gets the same arrays.
export const useSettings = () => { const v = useViewMode(); return useShared(`settings|${v}`, viewSettings); };
// TapWeigh and TapLift have no medicines: even a restored backup that has some shows none.
export const useMeds = () => {
  const v = useViewMode();
  return useShared(`meds|${v}`, async () => {
    if (!HAS_MEDS) return [];
    const meds = await db.medications.orderBy('name').toArray();
    if (v === 'full') return meds;
    return viewMeds(meds, (await getSettings()).privacyHidePeptides).sort((a, b) => a.name.localeCompare(b.name));
  });
};
export const useDoses = () => { const v = useViewMode(); return useShared(`doses|${v}`, async () => (HAS_MEDS ? inView(await db.doses.toArray()) : [])); };
export const useTags = () => { const v = useViewMode(); return useShared(`tags|${v}`, async () => inView(await db.tags.toArray())); };

const scheduleOf = new WeakMap<AppSettings, [AppSettings, ScheduleSettings]>();
export function useScheduleSettings(): [AppSettings, ScheduleSettings] | undefined {
  const s = useSettings();
  if (!s) return undefined;
  let pair = scheduleOf.get(s);
  if (!pair) { pair = [s, scheduleSettings(s)]; scheduleOf.set(s, pair); }
  return pair;
}
export const useCheckIns = () => useShared('checkIns', () => db.checkIns.toArray());
export const useBodyEntries = () => useShared('bodyEntries', () => db.bodyEntries.orderBy('date').toArray());
export const useMedEvents = () => { const v = useViewMode(); return useShared(`medEvents|${v}`, async () => inView(await db.medEvents.toArray())); };
export const useVitals = () => useShared('vitals', () => db.vitals.toArray());
export const useSupplies = () => { const v = useViewMode(); return useShared(`supplies|${v}`, async () => ((await viewSettings()).peptideTools ? db.supplies.toArray() : [])); };
export const usePeople = () => useShared('people', listPeople);
export const useLabs = () => useShared('labs', () => db.labs.toArray());
export const useExperiments = () => useShared('experiments', () => db.experiments.toArray());
export const useAppointments = () => useShared('appointments', () => db.appointments.toArray());
export const useQuestions = () => useShared('questions', () => db.questions.toArray());
export const useDaily = () => useShared('daily', () => db.daily.toArray());
export const useExercises = () => useShared('exercises', () => db.exercises.toArray());
export const useWorkouts = () => useShared('workouts', () => db.workouts.toArray());
export const useRoutines = () => useShared('routines', () => db.routines.toArray());
export const useFoodLogs = () => useShared('foodLogs', () => db.foodLogs.toArray());
export const useFoods = () => useShared('foods', () => db.foods.toArray());

const family = memoLast((people: Person[], settings: AppSettings) => {
  const personId = people.some((p) => p.id === settings.activePersonId) ? settings.activePersonId : DEFAULT_PERSON;
  const many = people.length > 1;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Me';
  return { people, personId, many, everyone: many && settings.todayEveryone, nameOf, person: nameOf(personId) };
});

/** The family member being shown, validated against the people list, plus Today's "Everyone" mode. */
export function useFamily() {
  const people = usePeople();
  const settings = useSettings();
  if (!people || !settings) return undefined;
  return family(people, settings);
}
