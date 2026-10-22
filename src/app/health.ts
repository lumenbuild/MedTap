// Health Connect (Android) / Apple Health (iPhone) import, in the app only: read-only, kept on the phone. Steps, sleep,
// resting and hourly heart rate and exercise go into daily rows; weigh-ins and blood pressure become records.
import { db } from '../db/db';
import { getSettings, setSetting } from '../db/repos/settings';
import { storedPerson } from '../db/repos/people';
import { upsertBody } from '../db/repos/body';
import { addVital } from '../db/repos/vitals';
import { planHealthImport } from '../logic/healthImport';
import { deviceTimeZone } from '../logic/tz';
import { HAS_BODY } from '../edition';
import { isNative, MedTapNative } from '../nfc/native';

const DAY = 86_400_000;

export const healthStatus = () => MedTapNative.healthStatus();

/** Ask for access, turn import on for `personId`, and import the last 90 days. */
export async function connectHealth(personId: string): Promise<{ granted: string[]; imported?: ImportResult }> {
  const r = await MedTapNative.healthRequest();
  if (!r.granted.length) return { granted: [] };
  await setSetting('healthImport', true);
  await setSetting('healthPersonId', personId);
  return { granted: r.granted, imported: await importHealth(true) };
}

export async function disconnectHealth() {
  await setSetting('healthImport', false);
}

export interface ImportResult { days: number; weighIns: number; readings: number }

/** Read since the last import (a day of overlap; 90 days the first time) and save it. */
export async function importHealth(full = false): Promise<ImportResult> {
  const s = await getSettings();
  const now = Date.now();
  const from = !full && s.healthLastImport ? Date.parse(s.healthLastImport) - DAY : now - 90 * DAY;
  const tz = deviceTimeZone();
  const data = await MedTapNative.healthRead({ from, to: now, zone: tz });
  const person = storedPerson(s.healthPersonId);
  const [daily, body, vitals] = await Promise.all([db.daily.toArray(), db.bodyEntries.toArray(), db.vitals.toArray()]);
  const plan = planHealthImport(data, { daily, body, vitals }, person, tz, new Date(now).toISOString());
  await db.daily.bulkPut(plan.daily);
  if (HAS_BODY) for (const b of plan.body) await upsertBody(b.date, { weightKg: b.kg, note: 'From Health' }, s.healthPersonId);
  for (const v of plan.vitals) await addVital({ at: v.at, systolic: v.systolic, diastolic: v.diastolic, note: 'From Health', personId: person });
  await setSetting('healthLastImport', new Date(now).toISOString());
  return { days: plan.daily.length, weighIns: HAS_BODY ? plan.body.length : 0, readings: plan.vitals.length };
}

/** On opening the app: import again if it's on and it's been 6 hours. */
export async function autoImportHealth() {
  if (!isNative) return;
  const s = await getSettings();
  if (!s.healthImport) return;
  if (s.healthLastImport && Date.now() - Date.parse(s.healthLastImport) < 6 * 3_600_000) return;
  try { await importHealth(); } catch (e) { console.error('health import', e); }
}
