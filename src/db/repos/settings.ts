import { db } from '../db';
import { deviceTimeZone } from '../../logic/tz';
import type { ScheduleSettings } from '../../logic/schedule';
import { HAS_BODY, HAS_PEPTIDES } from '../../edition';

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
  dismissedCheckInDoseId: string | null;
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
  /** Days of the week the person marked busy (0 = Sunday), for the best shot day. */
  busyDays: number[];
  /** A second "still to take" reminder when a set-time dose isn't logged a while after its usual time. */
  lateNudges: boolean;
  /** Odd records the person said are fine (ids), so they aren't raised again. */
  oddDismissed: string[];
  /** Optional: a "Period" button on Today, and check-ins by phase of the cycle in Trends. */
  cycleTracking: boolean;
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
}

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
  busyDays: [],
  lateNudges: true,
  oddDismissed: [],
  cycleTracking: false,
  healthImport: false,
  healthLastImport: null,
  healthPersonId: 'me',
  trainingTools: true,
  restSeconds: 120,
  barKg: 20,
  proteinTargetG: null,
  waterTargetMl: null,
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
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  if (!HAS_PEPTIDES) out.peptideTools = false; // e.g. after restoring a MedTap backup into TapDose
  if (!HAS_BODY) out.trainingTools = false;
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
