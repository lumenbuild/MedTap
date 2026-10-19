import { db } from '../db';
import { deviceTimeZone } from '../../logic/tz';
import type { ScheduleSettings } from '../../logic/schedule';

export interface AppSettings {
  dayStartsAt: string;
  guardMinutes: number;
  /** Tag IDs seen on this device but not yet assigned ("Not now"). */
  pendingTags: string[];
  iosBannerDismissed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dayStartsAt: '04:00',
  guardMinutes: 10,
  pendingTags: [],
  iosBannerDismissed: false,
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
