// Native app (iOS/Android) only: tag taps that open the app, links, and dose reminder notifications.
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications, type ActionPerformed } from '@capacitor/local-notifications';
import { liveQuery } from 'dexie';
import { db } from '../db/db';
import { getSettings, scheduleSettings, setSetting } from '../db/repos/settings';
import { dosesForPerson, listPeople, medIsFor, personOf } from '../db/repos/people';
import { shortcutItems, widgetData } from '../logic/widget';
import { autoImportHealth } from './health';
import { APP_NAME } from '../config';
import { getRecentDose } from '../logic/schedule';
import { logDose } from '../db/repos/doses';
import { planReminders } from '../logic/notify';
import { fmtAmount, fmtTime } from '../logic/format';
import { shownName } from '../logic/privacy';
import { tagIdFromUrl } from '../nfc/url';
import { isNative, isNativeAndroid } from '../platform';
import { MedTapNative } from '../nfc/native';
import { go } from './router';
import { requestLog } from './pendingLog';

const CHANNEL = 'doses';
const ACTIONS = 'dose';

/** A tag or link opened the app: go to that tag's screen. */
function openUrl(url: string | null) {
  const join = url?.match(/#\/join\/([A-Za-z0-9_-]+)/);
  if (join) { go(`/join/${join[1]}`); return; }
  const id = url ? tagIdFromUrl(url) : null;
  if (id) go(`/tag/${encodeURIComponent(id)}`);
}

export async function initNative() {
  if (!isNative) return;
  await MedTapNative.addListener('tag', (e) => openUrl(e.url));
  if (isNativeAndroid) MedTapNative.nfcListen().catch(() => { /* no NFC on this phone */ });
  await CapApp.addListener('appUrlOpen', (e) => openUrl(e.url));
  await CapApp.addListener('resume', () => { void syncReminders(); void syncExtras(); void autoImportHealth(); });
  // Shortcuts, Siri and the widget ask to log a medicine; Health Connect can open the privacy page.
  await MedTapNative.addListener('logRequest', (e) => { go('/today'); requestLog(e.medId); });
  await MedTapNative.addListener('route', (e) => go(e.path));
  void autoImportHealth();

  await LocalNotifications.registerActionTypes({ types: [{ id: ACTIONS, actions: [{ id: 'log', title: 'Log it', foreground: true }] }] });
  if (isNativeAndroid) {
    await LocalNotifications.createChannel({ id: CHANNEL, name: 'Dose reminders', description: 'When a dose is due', importance: 4, vibration: true, visibility: 0 });
  }
  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => { void onAction(a); });

  // Reschedule whenever medications, doses or settings change (debounced).
  let timer: ReturnType<typeof setTimeout> | undefined;
  liveQuery(() => Promise.all([db.medications.count(), db.doses.count(), db.doses.orderBy('takenAt').last(), db.settings.toArray()]))
    .subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { void syncReminders(); void syncExtras(); }, 2000); });
}

/** The home-screen widget and the "Log <medicine>" shortcuts, for the person being shown. */
async function syncExtras() {
  try {
    const settings = await getSettings();
    const [meds, doses] = await Promise.all([db.medications.toArray(), db.doses.toArray()]);
    const mine = meds.filter((m) => medIsFor(m, settings.activePersonId));
    const ids = new Set(mine.map((m) => m.id));
    const live = dosesForPerson(doses.filter((d) => !d.deletedAt && ids.has(d.medicationId)), mine, settings.activePersonId);
    await MedTapNative.setWidget({ json: JSON.stringify(widgetData(APP_NAME, mine, live, Date.now(), scheduleSettings(settings))) });
    await MedTapNative.setShortcuts({ items: shortcutItems(mine) });
  } catch (e) { console.error('widget/shortcuts', e); }
}

/** "Log it" logs the planned amount straight away; tapping the notification opens Log dose. */
async function onAction({ actionId, notification }: ActionPerformed) {
  const { medId, amount } = (notification.extra ?? {}) as { medId?: string; amount?: number };
  if (!medId) return;
  const med = await db.medications.get(medId);
  if (!med) return;
  go('/today');
  if (actionId !== 'log' || med.shared || amount === undefined) { requestLog(medId); return; }
  const settings = await getSettings();
  const doses = await db.doses.where('medicationId').equals(medId).toArray();
  // Never log twice: if a dose was just logged, open Log dose so the person can see it.
  if (getRecentDose(doses.filter((d) => !d.deletedAt), medId, Date.now(), settings.guardMinutes)) { requestLog(medId); return; }
  await logDose({ medicationId: medId, takenAt: new Date().toISOString(), amount, source: 'reminder' });
}

export type ReminderPermission = 'granted' | 'denied' | 'prompt';

export async function reminderPermission(): Promise<ReminderPermission> {
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

/** Turn reminders on (asking the phone for permission) or off. Returns whether they're on. */
export async function setRemindersEnabled(on: boolean): Promise<boolean> {
  if (on) {
    const p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') return false;
  }
  await setSetting('remindersEnabled', on);
  await syncReminders();
  return on;
}

/** Android 12+: whether reminders can go off at the exact minute (otherwise the phone may delay them a little). */
export async function exactRemindersAllowed(): Promise<boolean> {
  if (!isNativeAndroid) return true;
  try { return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'; } catch { return true; }
}
export const allowExactReminders = () => LocalNotifications.changeExactNotificationSetting();

let syncing: Promise<void> | null = null;

/** Replace the scheduled notifications with the next week's doses. */
export function syncReminders(): Promise<void> {
  if (!isNative) return Promise.resolve();
  syncing = (syncing ?? Promise.resolve()).then(doSync).catch((e) => console.error('reminders', e));
  return syncing;
}

async function doSync() {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  const settings = await getSettings();
  if (!settings.remindersEnabled || (await reminderPermission()) !== 'granted') return;
  const [meds, doses, people] = await Promise.all([db.medications.toArray(), db.doses.toArray(), listPeople()]);
  const live = doses.filter((d) => !d.deletedAt);
  const plan = planReminders(meds, live, Date.now(), scheduleSettings(settings), undefined, undefined, { nudges: settings.lateNudges });
  const byId = new Map(meds.map((m) => [m.id, m]));
  const many = people.length > 1;
  await LocalNotifications.schedule({
    notifications: plan.map((r) => {
      const med = byId.get(r.medId)!;
      const who = many && !med.shared ? `${people.find((p) => p.id === personOf(med))?.name ?? ''}: ` : '';
      return {
        id: r.id,
        title: `${who}${shownName(med)}`,
        body: r.kind === 'nudge' ? `Still to take: ${fmtAmount(r.amount, med.unit)}, due at ${fmtTime(r.dueAt)}` : `${fmtAmount(r.amount, med.unit)} due at ${fmtTime(r.dueAt)}`,
        schedule: { at: new Date(r.at), allowWhileIdle: true },
        channelId: CHANNEL,
        actionTypeId: ACTIONS,
        extra: { medId: med.id, amount: r.amount },
        smallIcon: 'ic_stat_medtap',
      };
    }),
  });
}


// ── Reminder check ──────────────────────────────────────────────────────────────────────────────────

export const reminderHealth = () => MedTapNative.reminderHealth();
export const openBatterySettings = () => MedTapNative.openBatterySettings();
export const openNotificationSettings = () => MedTapNative.openNotificationSettings();

const TEST_ID = 2_147_000_001;
/** A test reminder a minute from now. Calls back with how late it arrived (ms), when it arrives with the app open or
 *  is tapped (then it's at most that late). */
export async function testReminder(onArrived: (lateMs: number, tapped: boolean) => void): Promise<number> {
  const at = Date.now() + 60_000;
  const done = (tapped: boolean) => { onArrived(Math.max(0, Date.now() - at), tapped); void h1.then((h) => h.remove()); void h2.then((h) => h.remove()); };
  const h1 = LocalNotifications.addListener('localNotificationReceived', (n) => { if (n.id === TEST_ID) done(false); });
  const h2 = LocalNotifications.addListener('localNotificationActionPerformed', (a) => { if (a.notification.id === TEST_ID) done(true); });
  await LocalNotifications.schedule({ notifications: [{ id: TEST_ID, title: 'Test reminder', body: 'Reminders reach you. You can ignore this.', schedule: { at: new Date(at), allowWhileIdle: true }, channelId: CHANNEL, smallIcon: 'ic_stat_medtap' }] });
  return at;
}
