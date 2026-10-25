// Native app (iOS/Android) only: tag taps that open the app, links, and dose reminder notifications.
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications, type ActionPerformed } from '@capacitor/local-notifications';
import { liveQuery } from 'dexie';
import { db } from '../db/db';
import { getSettings, scheduleSettings, setSetting } from '../db/repos/settings';
import { dosesForPerson, listPeople, medIsFor, personOf, storedPerson } from '../db/repos/people';
import { CAFFEINE, intakesOf, usualDrinks, usualHabits, usualKey, usualToAsk } from '../logic/caffeine';
import { shortcutItems } from '../logic/widget';
import { widgetsPayload } from '../logic/widgets';
import { HAS_BODY, HAS_PEPTIDES } from '../edition';
import { addIntake } from '../db/repos/training';
import { addCheckIn } from '../db/repos/checkIns';
import { dayKey } from '../logic/stats';
import { autoImportHealth } from './health';
import { APP_NAME } from '../config';
import { getDayBounds, getExpectedAmount, getRecentDose } from '../logic/schedule';
import { logDose } from '../db/repos/doses';
import { liveSnoozes, planReminders, snoozeOf, withoutSnoozed } from '../logic/notify';
import { planTrainingReminders } from '../logic/trainingPlan';
import { trainingVsPeptide } from '../logic/training';
import { wearOffToday } from '../logic/wearOff';
import { planCheckInNotes } from '../logic/reminders';
import { fmtAmount, fmtTime } from '../logic/format';
import { shownName } from '../logic/privacy';
import { discreetName, viewMeds } from '../logic/privateView';
import type { Medication } from '../db/schema';
import { tagIdFromUrl } from '../nfc/url';
import { isNative, isNativeAndroid } from '../platform';
import { MedTapNative } from '../nfc/native';
import { go } from './router';
import { requestCheckIn, requestLog } from './pendingLog';

const CHANNEL = 'doses';
const TRAINING_CHANNEL = 'training';
const CHECKIN_CHANNEL = 'checkins';
/** The rest timer's notification, and the range used by training reminders: kept out of the dose reminders' clear-out. */
const REST_ID = 900_000_001;
const ACTIONS = 'dose';
const CHECKIN_ACTIONS = 'checkin';
const USUAL_ACTIONS = 'usual';

/** A tag or link opened the app: go to that tag's screen. */
function openUrl(url: string | null) {
  const join = url?.match(/#\/join\/([A-Za-z0-9_-]+)/);
  if (join) { go(`/join/${join[1]}`); return; }
  const id = url ? tagIdFromUrl(url) : null;
  if (id) go(`/tag/${encodeURIComponent(id)}`);
}

/** The notification buttons. The dose one's Snooze names the person's snooze length, so it's registered again when that
 *  changes. */
let actionsFor: number | null = null;
async function registerActions(snoozeMin: number) {
  if (actionsFor === snoozeMin) return;
  actionsFor = snoozeMin;
  const snooze = snoozeMin % 60 ? `In ${snoozeMin} min` : `In ${snoozeMin / 60} hour${snoozeMin === 60 ? '' : 's'}`;
  await LocalNotifications.registerActionTypes({ types: [
    // Check-ins answered from the notification; usual drinks confirmed from it.
    { id: CHECKIN_ACTIONS, actions: [{ id: 'ci-4', title: 'Good' }, { id: 'ci-3', title: 'OK' }, { id: 'ci-2', title: 'Rough' }] },
    { id: USUAL_ACTIONS, actions: [{ id: 'usual-yes', title: 'Yes' }, { id: 'usual-no', title: 'Not today' }] },
    { id: ACTIONS, actions: [
    { id: 'log', title: 'Log it', foreground: true },
    { id: 'snooze', title: snooze },
    { id: 'skip', title: 'Skip', destructive: true },
  ] }] });
}

export async function initNative() {
  if (!isNative) return;
  await MedTapNative.addListener('tag', (e) => openUrl(e.url));
  if (isNativeAndroid) MedTapNative.nfcListen().catch(() => { /* no NFC on this phone */ });
  await CapApp.addListener('appUrlOpen', (e) => openUrl(e.url));
  await CapApp.addListener('resume', () => { void syncReminders(); void syncExtras(); void autoImportHealth(); if (isNativeAndroid) { void logWatchTaps(); void logWidgetTaps(); } });
  // Shortcuts, Siri and the widget ask to log a medicine; Health Connect can open the privacy page.
  await MedTapNative.addListener('logRequest', (e) => { go('/today'); requestLog(e.medId); });
  await MedTapNative.addListener('route', (e) => { if (e.path === '/checkin') { go('/today'); requestCheckIn(); } else go(e.path); });
  if (isNativeAndroid) {
    await MedTapNative.addListener('watchLog', () => { void logWatchTaps(); }); void logWatchTaps();
    await MedTapNative.addListener('widgetAction', () => { void logWidgetTaps(); }); void logWidgetTaps();
  }
  void autoImportHealth();

  await registerActions((await getSettings()).snoozeMin);
  if (isNativeAndroid) {
    await LocalNotifications.createChannel({ id: CHANNEL, name: 'Dose reminders', description: 'When a dose is due', importance: 4, vibration: true, visibility: 0 });
    await LocalNotifications.createChannel({ id: TRAINING_CHANNEL, name: 'Training', description: 'Rest timer and training-day reminders', importance: 4, vibration: true, visibility: 1 });
    await LocalNotifications.createChannel({ id: CHECKIN_CHANNEL, name: 'Check-ins', description: 'How the day has been, and after a dose', importance: 4, vibration: true, visibility: 1 });
  }
  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => { void onAction(a); });
  // Check-in notifications start on, but Android 13+ only shows any once the app has asked: ask once, after the
  // welcome, rather than leave them switched on and silent.
  void (async () => {
    const st = await getSettings();
    if (st.onboarded && !st.notifyAsked && (st.checkInNotify || st.remindersEnabled) && (await reminderPermission()) === 'prompt') {
      await setSetting('notifyAsked', true);
      if ((await LocalNotifications.requestPermissions()).display === 'granted') await syncReminders();
    }
  })().catch((e) => console.error('notification permission', e));

  // Reschedule whenever medications, doses or settings change (debounced).
  let timer: ReturnType<typeof setTimeout> | undefined;
  liveQuery(() => Promise.all([db.medications.count(), db.doses.count(), db.doses.orderBy('takenAt').last(), db.settings.toArray(), db.workouts.count()]))
    .subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { void syncReminders(); void syncExtras(); }, 2000); });
  // Protein, water and check-ins change only some widgets: refresh just those quickly.
  let quick: ReturnType<typeof setTimeout> | undefined;
  liveQuery(() => Promise.all([db.daily.count(), db.daily.orderBy('date').last(), db.checkIns.count(), db.bodyEntries.count()]))
    .subscribe(() => { clearTimeout(quick); quick = setTimeout(() => { void syncExtras(); void syncCheckIns(); }, 1500); });
}

/** Taps on the watch: log each at the time it was tapped, at the planned amount, unless one was logged just before
 *  (the same guard as a tag tap). */
async function logWatchTaps() {
  try {
    const { items } = await MedTapNative.takeWatchLogs();
    for (const it of items) await logTap(it.medId, it.at, 'watch');
  } catch (e) { console.error('watch', e); }
}

async function logTap(medId: string, atMs: number, source: 'watch' | 'widget') {
  const settings = await getSettings();
  const med = await db.medications.get(medId);
  if (!med || med.archived) return;
  const doses = (await db.doses.where('medicationId').equals(med.id).toArray()).filter((d) => !d.deletedAt);
  const at = Number(atMs) || Date.now();
  if (getRecentDose(doses, med.id, at, settings.guardMinutes)) return;
  await logDose({ medicationId: med.id, takenAt: new Date(at).toISOString(), amount: getExpectedAmount(med, doses, at, scheduleSettings(settings)), source, ...(med.shared ? { personId: storedPerson(settings.activePersonId) } : {}) });
}

/** Taps on the home-screen widgets (as-needed medicines, protein, water, coffee), logged at the time they were tapped
 *  for the person the widgets show. */
async function logWidgetTaps() {
  try {
    const { items } = await MedTapNative.takeWidgetActions();
    if (!items.length) return;
    const settings = await getSettings();
    const who = settings.activePersonId;
    for (const a of items) {
      const at = Number(a.at) || Date.now();
      if (a.kind === 'dose') await logTap(a.medId, at, 'widget');
      else if (a.kind === 'intake' && (a.field === 'proteinG' || a.field === 'waterMl')) await addIntake(who, dayKey(at, scheduleSettings(settings)), a.field, Number(a.amount) || 0);
      else if (a.kind === 'chip' && a.chip === CAFFEINE) {
        // Coffee: the person's usual drink and its amount (just "Caffeine" until they have one).
        const mine = (await db.checkIns.toArray()).filter((c) => personOf(c) === who);
        const usual = usualDrinks(intakesOf(mine), at)[0];
        await addCheckIn({ at: new Date(at).toISOString(), chips: [CAFFEINE], personId: storedPerson(who), ...(usual ? { note: usual.name, caffeineMg: usual.mg } : {}) });
      } else if (a.kind === 'chip') await addCheckIn({ at: new Date(at).toISOString(), chips: [a.chip], personId: storedPerson(who) });
    }
    await syncExtras();
  } catch (e) { console.error('widget taps', e); }
}

/** The home-screen widgets, the watch's tile and the "Log <medicine>" shortcuts, for the person being shown. */
async function syncExtras() {
  try {
    const settings = await getSettings();
    const who = settings.activePersonId;
    const [meds, doses, checkIns, body, daily, workouts, events, own, people] = await Promise.all([db.medications.toArray(), db.doses.toArray(), db.checkIns.toArray(),
      db.bodyEntries.toArray(), db.daily.toArray(), db.workouts.toArray(), db.medEvents.toArray(), db.exercises.toArray(), listPeople()]);
    // With a privacy PIN set, what shows without unlocking (widgets, the watch, shortcuts) follows the private view.
    const all = meds.filter((m) => medIsFor(m, who));
    const mine = settings.privacyPinHash ? viewMeds(all, settings.privacyHidePeptides) : all;
    const ids = new Set(mine.map((m) => m.id));
    const live = dosesForPerson(doses.filter((d) => !d.deletedAt && ids.has(d.medicationId)), mine, who);
    const theirs = <T extends { personId?: string; deletedAt?: string }>(xs: T[]) => xs.filter((x) => !x.deletedAt && personOf(x) === who);
    const payload = widgetsPayload({
      app: APP_NAME, meds: mine, doses: live, checkIns: theirs(checkIns), body: theirs(body), daily: theirs(daily), workouts: theirs(workouts),
      events: events.filter((e) => ids.has(e.medicationId)), own, goals: people.find((p) => p.id === who)?.goals ?? [], units: settings.units,
      proteinTarget: settings.proteinTargetG, waterTarget: settings.waterTargetMl, amounts: settings.intakeAmounts, body_: HAS_BODY, training: settings.trainingTools,
      peptides: HAS_PEPTIDES && settings.peptideTools && !(settings.privacyPinHash && settings.privacyHidePeptides),
    }, Date.now(), scheduleSettings(settings));
    await MedTapNative.setWidget({ json: JSON.stringify(payload) });
    await MedTapNative.setShortcuts({ items: shortcutItems(mine) });
  } catch (e) { console.error('widget/shortcuts', e); }
}

/** "Log it" logs the planned amount straight away; Snooze reminds again after the person's snooze length; "Skip" records the dose as skipped
 *  (it covers its place in the plan); tapping the notification opens Log dose. */
async function onAction({ actionId, notification }: ActionPerformed) {
  const { medId, amount, route, dueAt, doseId, usual } = (notification.extra ?? {}) as { medId?: string; amount?: number; route?: string; dueAt?: number;
    doseId?: string; usual?: { name: string; mg: number; at: number; dayStart: number } };
  // A check-in answered from the notification: saved as it is (Good, OK or Rough), nothing to open.
  if (route === '/checkin' && actionId.startsWith('ci-')) {
    const mood = Number(actionId.slice(3));
    const st = await getSettings();
    await addCheckIn({ at: new Date().toISOString(), chips: [], mood, personId: storedPerson(st.activePersonId), ...(doseId ? { relatedDoseId: doseId } : {}) });
    return;
  }
  // "Had your usual?": Yes logs it at the usual time; Not today leaves it for the day.
  if (usual && (actionId === 'usual-yes' || actionId === 'usual-no')) {
    const st = await getSettings();
    if (actionId === 'usual-yes') await addCheckIn({ at: new Date(Math.min(usual.at, Date.now())).toISOString(), chips: [CAFFEINE], note: usual.name, caffeineMg: usual.mg, personId: storedPerson(st.activePersonId) });
    else await setSetting('usualDismissed', [usualKey(usual, usual.dayStart), ...st.usualDismissed].slice(0, 60));
    return;
  }
  // Training reminders open Training; the rest timer just brings the app (and the workout) back.
  if (route === '/checkin') { go('/today'); requestCheckIn(); return; }
  if (route) { if (route !== 'back') go(route); return; }
  if (!medId) return;
  const med = await db.medications.get(medId);
  if (!med) return;
  const settings = await getSettings();
  const doses = (await db.doses.where('medicationId').equals(medId).toArray()).filter((d) => !d.deletedAt);
  if (actionId === 'snooze' && amount !== undefined) {
    const z = snoozeOf({ medId, amount, dueAt: dueAt ?? Date.now() }, Date.now(), settings.snoozeMin);
    await setSetting('snoozes', [...liveSnoozes(settings.snoozes, doses, Date.now()).filter((x) => !(x.medId === medId && x.dueAt === z.dueAt)), z]);
    await syncReminders();
    return;
  }
  if (actionId === 'skip' && !med.shared && amount !== undefined) {
    // Already logged or skipped just now: nothing more to record.
    if (getRecentDose(doses, medId, Date.now(), settings.guardMinutes)) return;
    const at = dueAt && dueAt <= Date.now() + 3_600_000 ? dueAt : Date.now();
    await logDose({ medicationId: medId, takenAt: new Date(at).toISOString(), amount, source: 'reminder', skipped: true, skipReason: 'Skipped from the reminder' });
    return;
  }
  go('/today');
  if (actionId !== 'log' || med.shared || amount === undefined) { requestLog(medId); return; }
  // Never log twice: if a dose was just logged, open Log dose so the person can see it.
  if (getRecentDose(doses, medId, Date.now(), settings.guardMinutes)) { requestLog(medId); return; }
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

/** Training-day reminders on (asking for permission) or off. Returns whether they're on. */
export async function setTrainingReminders(on: boolean): Promise<boolean> {
  if (on) {
    const p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') return false;
  }
  await setSetting('trainingReminders', on);
  await setSetting('trainingReminderAsked', true);
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
  const stale = pending.notifications.filter((n) => n.id !== REST_ID);
  if (stale.length) await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
  const settings = await getSettings();
  if ((await reminderPermission()) !== 'granted') return;
  await registerActions(settings.snoozeMin).catch((e) => console.error('actions', e));
  // Each kind on its own, so one that fails can't stop the others (check-ins used to sit behind all of these).
  const safe = async (what: string, f: () => Promise<void>) => { try { await f(); } catch (e) { console.error(what, e); } };
  await safe('check-ins', () => scheduleCheckIns(settings));
  await safe('usual drinks', () => scheduleUsual(settings));
  if (settings.trainingTools && settings.trainingReminders) await safe('training', () => scheduleTraining(settings));
  if (settings.digestNotify) await safe('digest', scheduleDigest);
  if (settings.wearOffNotify) await safe('wear-off', () => scheduleWearOff(settings));
  if (!settings.remindersEnabled) return;
  const [meds, doses, people] = await Promise.all([db.medications.toArray(), db.doses.toArray(), listPeople()]);
  const live = doses.filter((d) => !d.deletedAt);
  const snoozes = liveSnoozes(settings.snoozes, live, Date.now());
  if (snoozes.length !== settings.snoozes.length) await setSetting('snoozes', snoozes);
  const plan = [
    ...withoutSnoozed(planReminders(meds, live, Date.now(), scheduleSettings(settings), undefined, undefined, { nudges: settings.lateNudges }), snoozes),
    ...snoozes.filter((z) => meds.some((m) => m.id === z.medId && !m.archived)).map((z) => ({ id: z.id, at: z.at, medId: z.medId, amount: z.amount, kind: 'snooze' as const, dueAt: z.dueAt })),
  ];
  const byId = new Map(meds.map((m) => [m.id, m]));
  const many = people.length > 1;
  // Lock-screen text: with a privacy PIN set, covered medicines show their cover name and left-out ones say nothing.
  // "Discreet reminders" hides every medicine's name and amount.
  const title = (med: Medication) => (settings.discreetReminders ? null : settings.privacyPinHash ? discreetName(med, settings.privacyHidePeptides, shownName) : shownName(med));
  await LocalNotifications.schedule({
    notifications: plan.map((r) => {
      const med = byId.get(r.medId)!;
      const who = many && !med.shared ? `${people.find((p) => p.id === personOf(med))?.name ?? ''}: ` : '';
      return {
        id: r.id,
        title: `${who}${title(med) ?? 'Reminder'}`,
        body: title(med) === null ? `Due at ${fmtTime(r.dueAt)}`
          : r.kind === 'due' ? `${fmtAmount(r.amount, med.unit)} due at ${fmtTime(r.dueAt)}` : `Still to take: ${fmtAmount(r.amount, med.unit)}, due at ${fmtTime(r.dueAt)}`,
        schedule: { at: new Date(r.at), allowWhileIdle: true },
        channelId: CHANNEL,
        actionTypeId: ACTIONS,
        extra: { medId: med.id, amount: r.amount, dueAt: r.dueAt },
        smallIcon: 'ic_stat_medtap',
      };
    }),
  });
}


/** Usual-day training reminders and the week's goal note, for the person this phone's Health import belongs to (the
 *  phone's own person). */
async function scheduleTraining(settings: Awaited<ReturnType<typeof getSettings>>) {
  const s = scheduleSettings(settings);
  const me = settings.healthPersonId;
  const [workouts, people, meds, doses] = await Promise.all([db.workouts.toArray(), listPeople(), db.medications.toArray(), db.doses.toArray()]);
  const mine = workouts.filter((w) => personOf(w) === me);
  const goal = people.find((p) => p.id === me)?.fitnessGoals?.find((g) => g.kind === 'sessions');
  const peptide = settings.peptideTools ? meds.find((m) => m.peptide && !m.archived && medIsFor(m, me)) : undefined;
  const pv = peptide ? trainingVsPeptide(peptide, doses, mine) : null;
  const shots = peptide ? doses.filter((d) => d.medicationId === peptide.id && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b) : [];
  const gap = shots.length >= 2 ? Math.round((shots[shots.length - 1] - shots[shots.length - 2]) / 86_400_000) : undefined;
  const plan = planTrainingReminders(mine, Date.now(), s, { perWeek: goal?.perWeek, strongDays: pv?.bestDays, lastShot: shots[shots.length - 1], shotEveryDays: gap && gap >= 3 ? gap : undefined });
  if (!plan.length) return;
  await LocalNotifications.schedule({
    notifications: plan.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: new Date(r.at), allowWhileIdle: true }, channelId: TRAINING_CHANNEL, smallIcon: 'ic_stat_medtap', extra: { route: '/training' } })),
  });
}

/** 30 minutes before each medicine's forecast wear-off today (learned effect window, adjusted for today). */
async function scheduleWearOff(settings: Awaited<ReturnType<typeof getSettings>>) {
  const me = settings.healthPersonId;
  const [meds, doses, checkIns, daily] = await Promise.all([db.medications.toArray(), db.doses.toArray(), db.checkIns.toArray(), db.daily.toArray()]);
  const now = Date.now();
  const s = scheduleSettings(settings);
  const mine = meds.filter((m) => !m.archived && !m.peptide && medIsFor(m, me))
    .map((m) => (settings.privacyPinHash ? (() => { const n = discreetName(m, settings.privacyHidePeptides, shownName); return n === null ? null : { ...m, name: n, nickname: undefined }; })() : m))
    .filter((m): m is Medication => !!m);
  const notes = mine.map((m) => wearOffToday(m, doses, checkIns.filter((c) => personOf(c) === me), daily.filter((d) => personOf(d) === me), now, s))
    .filter((w): w is NonNullable<typeof w> => !!w && w.at - 30 * 60_000 > now);
  if (!notes.length) return;
  await LocalNotifications.schedule({
    notifications: notes.map((w, i) => ({ id: 900_400_000 + i,
      title: settings.discreetReminders ? 'Heads-up' : `${shownName(w.med)} wearing off soon`,
      body: settings.discreetReminders ? `About ${fmtTime(w.at)}` : `Focus likely drops about ${fmtTime(w.at)}`,
      schedule: { at: new Date(w.at - 30 * 60_000), allowWhileIdle: true }, channelId: CHANNEL, smallIcon: 'ic_stat_medtap', extra: { route: '/today' } })),
  });
}

const CHECKIN_IDS = Array.from({ length: 80 }, (_, i) => ({ id: 900_500_000 + i }));

/** Check-in notifications (after the latest dose and at the daily times) for the person being shown. They say nothing
 *  about which medicine, so they suit the lock screen as they are. */
async function scheduleCheckIns(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.checkInNotify) return;
  const who = settings.activePersonId;
  const [meds, doses, checkIns] = await Promise.all([db.medications.toArray(), db.doses.toArray(), db.checkIns.toArray()]);
  const mine = meds.filter((m) => medIsFor(m, who));
  const ids = new Set(mine.map((m) => m.id));
  const plan = planCheckInNotes(dosesForPerson(doses.filter((d) => ids.has(d.medicationId)), mine, who), checkIns.filter((c) => personOf(c) === who), Date.now(),
    { delayMin: settings.checkInDelayMin, times: settings.checkInTimes }, scheduleSettings(settings));
  if (!plan.length) return;
  await LocalNotifications.schedule({
    notifications: plan.map((r) => ({ id: r.id, title: r.kind === 'daily' ? 'How has today been?' : 'How are you feeling?', body: 'Answer here, or tap for the full check-in.',
      schedule: { at: new Date(r.at), allowWhileIdle: true }, channelId: CHECKIN_CHANNEL, smallIcon: 'ic_stat_medtap', actionTypeId: CHECKIN_ACTIONS,
      extra: { route: '/checkin', ...(r.doseId ? { doseId: r.doseId } : {}) } })),
  });
}

const USUAL_IDS = Array.from({ length: 40 }, (_, i) => ({ id: 900_600_000 + i }));

/** "Had your usual flat white?" an hour after its usual time each day for the next week, unless it's logged (or
 *  answered "not today") first. */
async function scheduleUsual(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.usualAsk) return;
  const who = settings.activePersonId;
  const s = scheduleSettings(settings);
  const now = Date.now();
  const intakes = intakesOf((await db.checkIns.toArray()).filter((c) => personOf(c) === who));
  const habits = usualHabits(intakes, now, s);
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const ask = new Set(usualToAsk(habits, intakes, Infinity, settings.usualDismissed, s).map((h) => h.name)); // not logged or dismissed today
  const notes = [];
  let n = 0;
  for (let k = 0; k < 7; k++) for (const h of habits) {
    const at = h.at + k * 86_400_000, when = at + 60 * 60_000;
    if (when <= now || (k === 0 && !ask.has(h.name)) || n >= USUAL_IDS.length) continue;
    notes.push({ id: 900_600_000 + n++, title: `Had your usual ${h.name.replace(/^./, (c) => c.toLowerCase())}?`, body: `About ${fmtTime(at)} · ${h.mg} mg`,
      schedule: { at: new Date(when), allowWhileIdle: true }, channelId: CHECKIN_CHANNEL, smallIcon: 'ic_stat_medtap', actionTypeId: USUAL_ACTIONS,
      extra: { route: '/today', usual: { name: h.name, mg: h.mg, at, dayStart: today + k * 86_400_000 } } });
  }
  if (notes.length) await LocalNotifications.schedule({ notifications: notes });
}

/** After a check-in (or a dose): replace just the check-in notifications, in turn with any full resync so the two
 *  can't cancel each other's. */
function syncCheckIns(): Promise<void> {
  if (!isNative) return Promise.resolve();
  syncing = (syncing ?? Promise.resolve()).then(async () => {
    if ((await reminderPermission()) !== 'granted') return;
    await LocalNotifications.cancel({ notifications: [...CHECKIN_IDS, ...USUAL_IDS] });
    const st = await getSettings();
    await scheduleCheckIns(st);
    await scheduleUsual(st);
  }).catch((e) => console.error('check-in notifications', e));
  return syncing;
}

export interface CheckInNoteStatus { permission: ReminderPermission; exact: boolean; next: number | null; pending: number }

/** For Settings → Check-ins: whether the phone allows notifications and exact times, and the next one booked. */
export async function checkInNoteStatus(): Promise<CheckInNoteStatus | null> {
  if (!isNative) return null;
  const permission = await reminderPermission();
  const exact = await exactRemindersAllowed();
  const ids = new Set(CHECKIN_IDS.map((x) => x.id));
  const mine = (await LocalNotifications.getPending()).notifications.filter((n) => ids.has(n.id));
  const times = mine.map((n) => (n.schedule?.at ? new Date(n.schedule.at).getTime() : NaN)).filter((t) => Number.isFinite(t) && t > Date.now()).sort((a, b) => a - b);
  return { permission, exact, next: times[0] ?? null, pending: mine.length };
}

/** Ask the phone for notifications (and book the check-ins at once if it says yes). */
export async function allowCheckInNotes(): Promise<boolean> {
  const p = await LocalNotifications.requestPermissions();
  if (p.display !== 'granted') return false;
  await syncReminders();
  return true;
}

/** A test check-in notification ten seconds from now, to see it arrive. */
export async function testCheckInNote(): Promise<boolean> {
  if ((await reminderPermission()) !== 'granted') return false;
  await LocalNotifications.schedule({ notifications: [{ id: 900_599_999, title: 'How has today been?', body: 'A test: tap for a quick check-in.',
    schedule: { at: new Date(Date.now() + 10_000), allowWhileIdle: true }, channelId: CHECKIN_CHANNEL, smallIcon: 'ic_stat_medtap', extra: { route: '/checkin' } }] });
  return true;
}

/** Next Monday 8:30 am: "Your week" (the digest is on Today until Wednesday). */
async function scheduleDigest() {
  const d = new Date(); d.setHours(8, 30, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || (Date.now() < d.getTime() && d.getDay() === 1 ? 0 : 7)));
  await LocalNotifications.schedule({ notifications: [{ id: 900_300_000, title: 'Your week', body: 'Doses, weight, training and sleep against the week before. Tap to see.', schedule: { at: d, allowWhileIdle: true }, channelId: TRAINING_CHANNEL, smallIcon: 'ic_stat_medtap', extra: { route: '/today' } }] });
}

/** The Monday digest notification on (asking for permission) or off. */
export async function setDigestNotify(on: boolean): Promise<boolean> {
  if (on) { const p = await LocalNotifications.requestPermissions(); if (p.display !== 'granted') return false; }
  await setSetting('digestNotify', on);
  await syncReminders();
  return on;
}

/** Check-in notifications on (asking for permission) or off. */
export async function setCheckInNotify(on: boolean): Promise<boolean> {
  if (on && isNative) { const p = await LocalNotifications.requestPermissions(); if (p.display !== 'granted') return false; }
  await setSetting('checkInNotify', on);
  await syncReminders();
  return on;
}

/** The rest timer, for when the phone is locked or the app is in the background. */
export async function scheduleRestEnd(at: number, body: string) {
  if (!isNative) return;
  try {
    if ((await reminderPermission()) !== 'granted') return;
    await LocalNotifications.schedule({ notifications: [{ id: REST_ID, title: 'Rest over', body, schedule: { at: new Date(at), allowWhileIdle: true }, channelId: TRAINING_CHANNEL, smallIcon: 'ic_stat_medtap', extra: { route: 'back' } }] });
  } catch (e) { console.error('rest timer', e); }
}
export async function cancelRestEnd() {
  if (!isNative) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: REST_ID }] }); } catch { /* none pending */ }
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
