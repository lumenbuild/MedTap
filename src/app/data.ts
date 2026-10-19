import { db } from '../db/db';
import { useLive } from '../db/live';
import { getSettings, scheduleSettings, type AppSettings } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';

export const useSettings = () => useLive(getSettings);
export const useMeds = () => useLive(() => db.medications.orderBy('name').toArray());
export const useDoses = () => useLive(() => db.doses.toArray());
export const useTags = () => useLive(() => db.tags.toArray());

export function useScheduleSettings(): [AppSettings, ScheduleSettings] | undefined {
  const s = useSettings();
  return s ? [s, scheduleSettings(s)] : undefined;
}
