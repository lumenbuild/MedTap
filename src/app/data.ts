import { db } from '../db/db';
import { useLive } from '../db/live';
import { getSettings, scheduleSettings, type AppSettings } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';
import { listPeople } from '../db/repos/people';
import { DEFAULT_PERSON } from '../db/schema';

export const useSettings = () => useLive(getSettings);
export const useMeds = () => useLive(() => db.medications.orderBy('name').toArray());
export const useDoses = () => useLive(() => db.doses.toArray());
export const useTags = () => useLive(() => db.tags.toArray());

export function useScheduleSettings(): [AppSettings, ScheduleSettings] | undefined {
  const s = useSettings();
  return s ? [s, scheduleSettings(s)] : undefined;
}
export const useCheckIns = () => useLive(() => db.checkIns.toArray());
export const useBodyEntries = () => useLive(() => db.bodyEntries.orderBy('date').toArray());
export const useMedEvents = () => useLive(() => db.medEvents.toArray());
export const useVitals = () => useLive(() => db.vitals.toArray());
export const useSupplies = () => useLive(() => db.supplies.toArray());
export const usePeople = () => useLive(listPeople);
export const useLabs = () => useLive(() => db.labs.toArray());
export const useAppointments = () => useLive(() => db.appointments.toArray());
export const useQuestions = () => useLive(() => db.questions.toArray());
export const useDaily = () => useLive(() => db.daily.toArray());

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
