import { useEffect } from 'react';
import { getSettings, scheduleSettings } from '../db/repos/settings';
import { applyDuePlannedChanges } from '../db/repos/meds';
import { dayKey } from '../logic/stats';
import { runAutoBackup } from './autoBackup';

/** Housekeeping that must happen even if the app is only opened occasionally:
 *  switch to planned schedules whose day has come, and write the daily automatic backup. */
export async function runMaintenance() {
  const st = await getSettings();
  await applyDuePlannedChanges(dayKey(Date.now(), scheduleSettings(st)), st.dayStartsAt);
  await runAutoBackup();
}

/** Run at start, every 5 minutes while open, and whenever the app comes back to the foreground. */
export function useMaintenance() {
  useEffect(() => {
    const run = () => { if (document.visibilityState === 'visible') runMaintenance().catch((e) => console.error(e)); };
    run();
    const id = setInterval(run, 5 * 60_000);
    document.addEventListener('visibilitychange', run);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, []);
}
