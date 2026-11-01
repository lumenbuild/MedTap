import { db } from '../db';
import { deviceTimeZone } from '../../logic/tz';
import type { ScheduleSettings } from '../../logic/schedule';
import { HAS_TRAINING, HAS_FOOD, FOCUS, HAS_PEPTIDES } from '../../edition';

export type Units = 'metric' | 'imperial';

export const DEFAULT_CHIPS = [
  'Headache', 'Dry mouth', 'Low appetite', 'Jittery', 'Calm', 'Focused', 'Irritable', 'Wearing off', 'Trouble sleeping', 'Nausea',
];

export interface AppSettings {
  dayStartsAt: string;
  guardMinutes: number;
  /** Tag IDs seen on this device but not yet assigned ("Not now"). */
  pendingTags: string[];
  iosBannerDismissed: boolean;
  onboarded: boolean;
  lastBackupAt: string | null;
  units: Units;
  chips: string[];
  /** Minutes after a dose to suggest a check-in on Today. 0 turns it off. */
  checkInDelayMin: number;
  /** The check-in prompt closed with "Not now": a dose id (after a dose) or a daily time's key (see checkInDue). */
  dismissedCheckInDoseId: string | null;
  /** Times each day to ask how the day went ("20:00"); empty for none. */
  checkInTimes: string[];
  /** Open the check-in by itself when one is due (once each), not just the card on Today. */
  checkInPopup: boolean;
  /** The last check-in that opened by itself, so it does once. */
  checkInPopupShown: string | null;
  /** Phone notifications for check-ins (after a dose and at the daily times), with reminders allowed. */
  checkInNotify: boolean;
  /** Medication id → the stock count when its low-stock banner was dismissed. */
  dismissedLowStock: Record<string, number>;
  installCardDismissed: boolean;
  lockEnabled: boolean;
  pinHash: string | null;
  pinSalt: string | null;
  pinLength: number;
  lockAfterMin: number;
  /** A second PIN that opens the private view (see logic/privateView.ts). Same length as the main PIN. */
  privacyPinHash: string | null;
  privacyPinSalt: string | null;
  /** In the private view, also leave out the peptide tools (Protocol, calculator, supplies). */
  privacyHidePeptides: boolean;
  /** Reminders say only "Reminder" and the time: no medicine names or amounts on the lock screen. */
  discreetReminders: boolean;
  /** With app lock on, every tag tap asks for the PIN before it shows or logs anything. */
  tagNeedsPin: boolean;
  /** The "Get set up" card on Today was hidden. */
  gettingStartedDismissed: boolean;
  /** Show the backup reminder when the last backup is older than this. */
  backupReminderDays: number;
  autoBackupEnabled: boolean;
  /** Keep this many daily automatic backup files in the folder. */
  autoBackupKeep: number;
  lastAutoBackupAt: string | null;
  /** Warn this many days before a medication is forecast to run out. */
  refillWarnDays: number;
  /** The family member being shown (Today, Trends, Body, Meds). */
  activePersonId: string;
  /** Today shows everyone's medications at once (for carers). */
  todayEveryone: boolean;
  /** Time zone the person normally lives in (recorded on first use). */
  homeTimeZone: string | null;
  /** Travel: set times and the day boundary follow the phone's current time zone ('device', default) or home time. */
  timeMode: 'device' | 'home';
  /** Native app: phone notifications when doses are due. */
  remindersEnabled: boolean;
  /** Peptides and injections: mixed vials, syringe units, titration plans, injection sites. */
  peptideTools: boolean;
  /** Biohacking tools: brain tests, readiness and day plan, tolerance, illness warning, recovery, fluids on a GLP-1,
   *  muscle protection, journal, year in review, and the watch's effect ring and tests. */
  biohackTools: boolean;
  /** Sleep: its own tab with last night, a sleep score, what affects your sleep, consistency, sleep debt and a bedtime
   *  coach, from the watch's sleep data. */
  sleepTools: boolean;
  /** Hours of sleep to aim for (sleep debt and the bedtime coach). */
  sleepTargetH: number;
  /** Days of the week the person marked busy (0 = Sunday), for the best shot day. */
  busyDays: number[];
  /** A second "still to take" reminder when a set-time dose isn't logged a while after its usual time. */
  lateNudges: boolean;
  /** Odd records the person said are fine (ids), so they aren't raised again. */
  oddDismissed: string[];
  /** Health Connect / Apple Health import: on, and when it last ran (this phone). */
  healthImport: boolean;
  healthLastImport: string | null;
  /** Whose records the imported data goes to (the person using this phone). */
  healthPersonId: string;
  /** MedTap: the Training tab (workouts, personal bests, body composition goals). */
  trainingTools: boolean;
  /** Training: rest timer after each set (seconds; 0 = off), the bar's weight, and daily targets the person sets. */
  restSeconds: number;
  barKg: number;
  proteinTargetG: number | null;
  waterTargetMl: number | null;
  /** MedTap: food logging (barcodes, label photos, hand portions, meals and recipes), energy shown in Cal or kJ,
   *  and an optional daily energy target (kcal). */
  foodTracking: boolean;
  energyUnit: 'kcal' | 'kJ';
  energyTargetKcal: number | null;
  /** Rest time worked out per set (heavy sets longer, small muscles shorter) from `restSeconds`. */
  smartRest: boolean;
  /** After a set that was clearly too easy or too hard, change the weight of that exercise's remaining sets. */
  autoAdjust: boolean;
  /** Reminders on the person's usual training days, and when the week's goal needs a session (app only). */
  trainingReminders: boolean;
  /** The "remind me on my usual days?" card on Training was answered. */
  trainingReminderAsked: boolean;
  /** Android app: look for a newer build once a day; the last answer, and a build the person said "later" to. */
  updateCheck: boolean;
  lastUpdateCheck: string | null;
  latestUpdate: { build: number; notes: string; url: string; page: string } | null;
  updateDismissed: number;
  /** Same-ingredient notices the person has read (pairs of medication ids). */
  overlapDismissed: string[];
  /** The person's pharmacy, for "Ask the pharmacy" (a phone number or an email address). */
  pharmacyName: string;
  /** The weekly digest: the week (its Monday) last closed on Today, and a Monday-morning notification (app). */
  digestSeen: number;
  /** Readings-worth-mentioning notes closed this week. */
  mentionsDismissed: string[];
  /** A planned lighter week: until when, and when the last one was (or the suggestion was put off). */
  lighterUntil: number;
  lighterLast: number;
  digestNotify: boolean;
  pharmacyContact: string;
  /** Reminders put off from the notification ("In 15 min"), kept until they go off or the dose is logged. */
  snoozes: Snooze[];
  /** A notification 30 minutes before a medicine's forecast wear-off (app). */
  wearOffNotify: boolean;
  /** Dose reminders from the watch app itself (Log, Snooze, Skip on the wrist, and they work without the phone nearby). */
  watchReminders: boolean;
  /** Caffeine: the person's own daily limit (mg), usual bedtime ('HH:mm') and how fast they clear it (half-life, h). */
  caffeineLimitMg: number | null;
  bedtime: string;
  caffeineHalfLifeH: number;
  /** The person's own caffeine cut-off ('HH:mm'), and when they started a two-week caffeine check (ms). */
  caffeineCutoff: string | null;
  caffeineCheckFrom: number | null;
  /** The app asked the phone for notification permission by itself (once). */
  notifyAsked: boolean;
  /** Milestones already celebrated (ids), and "Same as usual?": on, and the ones answered "not today". */
  milestonesSeen: string[];
  usualAsk: boolean;
  usualDismissed: string[];
  /** "Ready for the next programme" put off until then (ms). */
  coachMoveSnooze: number;
  /** The water and protein buttons on Today: the person's own amounts (a cup, a bottle, a scoop), most recently used first. */
  intakeAmounts: { waterMl: number[]; proteinG: number[] };
  /** How long Snooze on a dose reminder waits. */
  snoozeMin: number;
  /** The daily calorie target: the person's own number, or worked out from their logs and weight (and kept up to date). */
  energyAuto: boolean;
  /** When the worked-out target was last updated (ms). */
  energyAutoAt: number;
  /** The rate of loss the worked-out calorie target aims for (kg a week). */
  lossRateKgWeek: number;
  /** A steps target of the person's own; null: worked out from their recent days (logic/movement). */
  stepsTargetOwn: number | null;
  /** Fibre a day (g). */
  fibreTargetG: number;
  /** Daily targets the app works out and keeps up to date (logic/targets): true while automatic, false once the person
   *  sets their own. Missing: automatic unless they'd changed the number. */
  targetAuto: Partial<Record<'water' | 'protein' | 'fibre' | 'sleep' | 'caffeine', boolean>>;
  /** Changes the app made to an automatic target, newest first (for "Water target now 2.9 L"). */
  targetChanges: { key: string; from: number | null; to: number; at: number; why: string }[];
  /** When the automatic targets were last worked out (ms), and the stack they were worked out for. */
  targetsAt: number;
  targetsStack: string;
  /** Insights put away: id → until when (ms); a far-future time for good. */
  insightsHidden: Record<string, number>;
  /** Things done from an insight, to check back on a few weeks later ("since your 2 pm cut-off, sleep …"). */
  followUps: FollowUp[];
}

export interface FollowUp { id: string; kind: 'cutoff' | 'protein' | 'calories'; at: number; value: number }

export interface Snooze { id: number; medId: string; amount: number; dueAt: number; at: number; made: number }

export const DEFAULT_SETTINGS: AppSettings = {
  dayStartsAt: '04:00',
  guardMinutes: 10,
  pendingTags: [],
  iosBannerDismissed: false,
  onboarded: false,
  lastBackupAt: null,
  units: 'metric',
  chips: DEFAULT_CHIPS,
  checkInDelayMin: 90,
  dismissedCheckInDoseId: null,
  checkInTimes: ['20:00'],
  checkInPopup: true,
  checkInPopupShown: null,
  checkInNotify: true,
  dismissedLowStock: {},
  installCardDismissed: false,
  lockEnabled: false,
  pinHash: null,
  pinSalt: null,
  pinLength: 4,
  lockAfterMin: 5,
  privacyPinHash: null,
  privacyPinSalt: null,
  privacyHidePeptides: true,
  discreetReminders: false,
  tagNeedsPin: false,
  gettingStartedDismissed: false,
  backupReminderDays: 7,
  autoBackupEnabled: false,
  autoBackupKeep: 7,
  lastAutoBackupAt: null,
  refillWarnDays: 7,
  activePersonId: 'me',
  todayEveryone: false,
  homeTimeZone: null,
  timeMode: 'device',
  remindersEnabled: false,
  peptideTools: false,
  biohackTools: false,
  sleepTools: false,
  sleepTargetH: 8,
  busyDays: [],
  lateNudges: true,
  oddDismissed: [],
  healthImport: false,
  healthLastImport: null,
  healthPersonId: 'me',
  trainingTools: true,
  restSeconds: 120,
  barKg: 20,
  proteinTargetG: null,
  waterTargetMl: null,
  foodTracking: true,
  energyUnit: 'kcal',
  energyTargetKcal: null,
  smartRest: true,
  autoAdjust: true,
  trainingReminders: false,
  trainingReminderAsked: false,
  updateCheck: true,
  lastUpdateCheck: null,
  latestUpdate: null,
  updateDismissed: 0,
  overlapDismissed: [],
  pharmacyName: '',
  digestSeen: 0,
  mentionsDismissed: [],
  lighterUntil: 0,
  lighterLast: 0,
  digestNotify: false,
  pharmacyContact: '',
  snoozes: [],
  wearOffNotify: true,
  watchReminders: false,
  caffeineLimitMg: 400,
  bedtime: '22:30',
  caffeineHalfLifeH: 5,
  caffeineCutoff: null,
  caffeineCheckFrom: null,
  notifyAsked: false,
  milestonesSeen: [],
  usualAsk: true,
  usualDismissed: [],
  coachMoveSnooze: 0,
  intakeAmounts: { waterMl: [250, 500], proteinG: [10, 25, 40] },
  snoozeMin: 15,
  energyAuto: false,
  energyAutoAt: 0,
  lossRateKgWeek: 0.5,
  stepsTargetOwn: null,
  fibreTargetG: 25,
  targetAuto: {},
  targetChanges: [],
  targetsAt: 0,
  targetsStack: '',
  insightsHidden: {},
  followUps: [],
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  if (!HAS_PEPTIDES) { out.peptideTools = false; out.biohackTools = false; out.sleepTools = false; } // e.g. after restoring a MedTap backup into TapDose
  if (!HAS_TRAINING) out.trainingTools = false;
  if (!HAS_FOOD) out.foodTracking = false;
  // The app's own main thing can't be switched off.
  if (FOCUS === 'training') out.trainingTools = true;
  if (FOCUS === 'weight') out.foodTracking = true;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.settings.put({ key, value });
}

/** The time zone schedules run in: the phone's current one, unless the person chose to keep home time while away. */
export function scheduleTimeZone(s: Pick<AppSettings, 'timeMode' | 'homeTimeZone'>, device = deviceTimeZone()): string {
  return s.timeMode === 'home' && s.homeTimeZone ? s.homeTimeZone : device;
}

export function scheduleSettings(s: AppSettings, tz = scheduleTimeZone(s)): ScheduleSettings {
  return { dayStartsAt: s.dayStartsAt, guardMinutes: s.guardMinutes, tz };
}

export async function addPendingTag(id: string) {
  const s = await getSettings();
  if (!s.pendingTags.includes(id)) await setSetting('pendingTags', [...s.pendingTags, id]);
}

export async function removePendingTag(id: string) {
  const s = await getSettings();
  if (s.pendingTags.includes(id)) await setSetting('pendingTags', s.pendingTags.filter((t) => t !== id));
}
