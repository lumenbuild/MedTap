import { db } from '../db';
import { deviceTimeZone } from '../../logic/tz';
import type { ScheduleSettings } from '../../logic/schedule';

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
}

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
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.settings.put({ key, value });
}

export function scheduleSettings(s: AppSettings, tz = deviceTimeZone()): ScheduleSettings {
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
