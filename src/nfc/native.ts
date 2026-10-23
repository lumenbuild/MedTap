// The native app's own plugin (native/medtap-native): NFC on Android and iPhone, printing, sharing and backup folders.
// Only used when running inside the iOS/Android app; the website uses Web NFC instead.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface MedTapNativePlugin {
  nfcStatus(): Promise<{ supported: boolean; enabled: boolean }>;
  // nfcWrite rejects with `code` set to an NfcErrorKind.
  /** Waits for a tag and writes one URL record to it. Android: `openInApp` adds a record that makes tapping the tag
   *  open this app instead of the browser. */
  nfcWrite(options: { url: string; timeoutMs: number; openInApp?: boolean }): Promise<void>;
  /** Waits for a tag and returns the first URL on it. Android: `opensApp` says whether it has the open-in-app record. */
  nfcRead(options: { timeoutMs: number }): Promise<{ url: string | null; opensApp?: boolean }>;
  nfcCancel(): Promise<void>;
  /** Android: deliver tag taps to the app while it's open ('tag' events). */
  nfcListen(): Promise<void>;
  openNfcSettings(): Promise<void>;
  print(options: { name: string }): Promise<void>;
  shareFile(options: { name: string; base64: string; mime: string; title: string }): Promise<void>;
  /** Ask for a folder to keep backups in. `uri` is kept to reach it again later. Rejects with code 'cancelled'. */
  pickFolder(): Promise<{ uri: string; name: string }>;
  /** Whether the app can still write into the folder (false once it's moved, deleted or access was removed). */
  folderAccess(options: { uri: string }): Promise<{ ok: boolean }>;
  /** Create or replace a file in the folder. */
  writeFile(options: { uri: string; name: string; text: string }): Promise<void>;
  listFiles(options: { uri: string }): Promise<{ names: string[] }>;
  deleteFile(options: { uri: string; name: string }): Promise<void>;
  addListener(event: 'tag', fn: (e: { url: string | null }) => void): Promise<PluginListenerHandle>;
  /** A shortcut, Siri or the widget asked to log a medicine. */
  addListener(event: 'logRequest', fn: (e: { medId: string }) => void): Promise<PluginListenerHandle>;
  /** Android opened the app on a page (e.g. Health Connect asking why the app reads health data). */
  addListener(event: 'route', fn: (e: { path: string }) => void): Promise<PluginListenerHandle>;
  /** Android: the watch sent a "log" tap (read them with takeWatchLogs), or a "set done" (takeWatchSets). */
  addListener(event: 'watchLog' | 'watchSet', fn: () => void): Promise<PluginListenerHandle>;

  // Health Connect (Android) / Apple Health (iPhone), read only. `granted` names the record types allowed (iPhone: ['unknown']).
  healthStatus(): Promise<{ status: 'available' | 'needs-update' | 'unsupported'; granted: string[] }>;
  healthRequest(): Promise<{ status: string; granted: string[] }>;
  healthRead(options: { from: number; to: number; zone: string }): Promise<HealthData>;
  openHealthConnect(): Promise<void>;
  /** "Log <medicine>" shortcuts (Android: long-press the app icon; iPhone: Siri and the Shortcuts app). */
  setShortcuts(options: { items: { id: string; label: string }[] }): Promise<void>;
  /** What can stop or delay reminders on this phone. */
  reminderHealth(): Promise<{ notificationsEnabled: boolean; channelOff: boolean; batteryUnrestricted: boolean; manufacturer: string; sdk: number }>;
  openBatterySettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** What the home-screen widget shows (Android). */
  setWidget(options: { json: string }): Promise<void>;
  /** Android: "log" taps from a paired Wear OS watch, waiting to be logged (cleared when read). */
  takeWatchLogs(): Promise<{ items: { medId: string; at: number }[] }>;
  /** Android: download a newer build of this app from its GitHub release and open the installer. Rejects with `code`
   *  'permission' (the "install unknown apps" setting was opened), 'mismatch' or 'io'. */
  installUpdate(options: { url: string }): Promise<void>;
  /** Android: the workout in progress, for the watch ("{}" when there's none). */
  setWatchWorkout(options: { json: string }): Promise<void>;
  takeWatchSets(): Promise<{ items: { setId: string; at: number }[] }>;
  addListener(event: 'updateProgress', fn: (e: { pct: number }) => void): Promise<PluginListenerHandle>;
}

export interface HealthDay { date: string; steps?: number; sleepMin?: number; restingHr?: number; exerciseMin?: number; hrvMs?: number; hrByHour?: (number | null)[] }
export interface HealthData {
  days: HealthDay[]; weights: { t: number; kg: number }[]; bp: { t: number; sys: number; dia: number }[];
  /** Exercise sessions from a watch or app: type is run, walk, ride, swim, row, strength or other. Older app versions leave these out. */
  workouts?: { t: number; end: number; type: string; km?: number }[];
  bodyFat?: { t: number; pct: number }[]; lean?: { t: number; kg: number }[];
}

export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
export const MedTapNative = registerPlugin<MedTapNativePlugin>('MedTapNative');
