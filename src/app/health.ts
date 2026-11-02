// Health Connect (Android) / Apple Health (iPhone) import, in the app only: read-only, kept on the phone. Steps, sleep,
// resting and hourly heart rate, heart rate variability and exercise go into daily rows; weigh-ins, body fat, lean mass,
// blood pressure and workouts (with heart rate and calories) become records.
import { db } from '../db/db';
import { getSettings, setSetting } from '../db/repos/settings';
import { storedPerson } from '../db/repos/people';
import { upsertBody } from '../db/repos/body';
import { addVital } from '../db/repos/vitals';
import { planHealthImport, type HealthPlan } from '../logic/healthImport';
import { deviceTimeZone } from '../logic/tz';
import { HAS_BODY, HAS_PEPTIDES as STACK, HAS_TRAINING } from '../edition';
import { fmtWeight } from '../logic/units';
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

export interface ImportResult { days: number; weighIns: number; readings: number; workouts: number; newest?: HealthPlan['newest'] }

/** Read since the last import (a day of overlap; 90 days the first time) and save it. */
export async function importHealth(full = false): Promise<ImportResult> {
  const s = await getSettings();
  const now = Date.now();
  const from = !full && s.healthLastImport ? Date.parse(s.healthLastImport) - DAY : now - 90 * DAY;
  const tz = deviceTimeZone();
  const data = await MedTapNative.healthRead({ from, to: now, zone: tz });
  const person = storedPerson(s.healthPersonId);
  const [daily, body, vitals, workouts] = await Promise.all([db.daily.toArray(), db.bodyEntries.toArray(), db.vitals.toArray(), db.workouts.toArray()]);
  const plan = planHealthImport(data, { daily, body, vitals, workouts }, person, tz, new Date(now).toISOString());
  await db.daily.bulkPut(plan.daily);
  if (HAS_BODY) for (const b of plan.body) await upsertBody(b.date, { weightKg: b.kg, note: 'From Health' }, s.healthPersonId);
  if (HAS_BODY) for (const { date, ...c } of plan.comp) await upsertBody(date, { ...c, compSource: 'scale' }, s.healthPersonId);
  if (HAS_TRAINING) {
    const at = new Date(now).toISOString();
    await db.workouts.bulkAdd(plan.cardio.map(({ at: start, ...c }) => ({ id: crypto.randomUUID(), startedAt: start, endedAt: start, sets: [], source: 'health' as const, personId: person, createdAt: at, updatedAt: at,
      cardio: c })));
    // Heart rate and calories from the watch, added to workouts already here.
    for (const e of plan.enrich) {
      const w = await db.workouts.get(e.id);
      if (!w) continue;
      await db.workouts.update(e.id, { ...(e.cardio && w.cardio ? { cardio: { ...w.cardio, ...e.cardio } } : {}), ...(e.watch ? { watch: e.watch } : {}), updatedAt: at });
    }
  }
  for (const v of plan.vitals) await addVital({ at: v.at, systolic: v.systolic, diastolic: v.diastolic, note: 'From Health', personId: person });
  await setSetting('healthLastImport', new Date(now).toISOString());
  return { newest: HAS_BODY ? plan.newest : undefined, days: plan.daily.length, weighIns: HAS_BODY ? plan.body.length : 0, readings: plan.vitals.length, workouts: HAS_TRAINING ? plan.cardio.length + plan.enrich.length : 0 };
}

/** On opening the app or coming back to it: import again if it’s on and it’s been 2 minutes, so a weigh-in on the scale
 *  shows here as soon as its app has passed it to Health Connect, with a notice saying so. */
export async function autoImportHealth() {
  if (!isNative) return;
  const s = await getSettings();
  if (!s.healthImport) return;
  if (s.healthLastImport && Date.now() - Date.parse(s.healthLastImport) < 120_000) return;
  try {
    const r = await importHealth();
    const n = r.newest;
    if (n && n.date >= new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10)) {
      window.dispatchEvent(new CustomEvent('medtap-toast', { detail: `New weigh-in: ${fmtWeight(n.kg, s.units)}${n.bodyFatPct !== undefined ? `, body fat ${n.bodyFatPct}%` : ''}. Details in ${STACK ? 'Insights → Body' : 'Body'}.` }));
    }
  } catch (e) { console.error('health import', e); }
}
