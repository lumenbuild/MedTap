import { useEffect } from 'react';
import { getSettings, scheduleSettings, setSetting } from '../db/repos/settings';
import { deviceTimeZone } from '../logic/tz';
import { applyDuePlannedChanges } from '../db/repos/meds';
import { dayKey } from '../logic/stats';
import { runAutoBackup } from './autoBackup';
import { db } from '../db/db';
import { personOf } from '../db/repos/people';
import { calorieTarget, expenditure } from '../logic/energy';

/** Housekeeping that must happen even if the app is only opened occasionally:
 *  switch to planned schedules whose day has come, and write the daily automatic backup. */
export async function runMaintenance() {
  const st = await getSettings();
  if (!st.homeTimeZone) await setSetting('homeTimeZone', deviceTimeZone()); // first use: this is home
  await applyDuePlannedChanges(dayKey(Date.now(), scheduleSettings(st)), st.dayStartsAt);
  await runAutoBackup();
  await updateCalorieTarget();
}

/** With the calorie target worked out by the app: once a week, again from the last four weeks of food and weight. */
export async function updateCalorieTarget(now = Date.now()) {
  const st = await getSettings();
  if (!st.energyAuto || now - st.energyAutoAt < 6 * 86_400_000) return;
  const who = st.activePersonId;
  const mine = <T extends { personId?: string }>(r: T) => personOf(r) === who;
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const [logs, body] = await Promise.all([db.foodLogs.where('at').aboveOrEqual(from).toArray(), db.bodyEntries.toArray()]);
  const e = expenditure(logs.filter(mine), body.filter(mine), now, scheduleSettings(st));
  if (!e) return;
  await setSetting('energyTargetKcal', calorieTarget(e, st.lossRateKgWeek).kcal);
  await setSetting('energyAutoAt', now);
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
