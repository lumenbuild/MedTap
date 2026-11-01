// The native app's own plugin (native/medtap-native): NFC on Android and iPhone, printing, sharing and backup folders.
// Only used when running inside the iOS/Android app; the website uses Web NFC instead.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface MedTapNativePlugin {
  nfcStatus(): Promise<{ supported: boolean; enabled: boolean }>;
  // nfcWrite rejects with `code` set to an NfcErrorKind.
  /** Waits for a tag and writes one URL record to it. Android: `openInApp` adds a record that makes tapping the tag
   *  open this app instead of the browser. */
  nfcWrite(options: { url: string; timeoutMs: number; openInApp?: boolean }): Promise<{ previous?: string | null }>;
  /** Waits for a tag and wipes it (one empty record) so it can be used for something else. `previous`: the link it had. */
  nfcErase(options: { timeoutMs: number }): Promise<{ previous?: string | null }>;
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
  addListener(event: 'watchLog' | 'watchSet' | 'watchCheckIn', fn: () => void): Promise<PluginListenerHandle>;

  // Health Connect (Android) / Apple Health (iPhone), read only. `granted` names the record types allowed (iPhone: ['unknown']).
  /** `asked`: how many kinds of data the app asks for (Android), to offer ones not allowed yet. */
  healthStatus(): Promise<{ status: 'available' | 'needs-update' | 'unsupported'; granted: string[]; asked?: number }>;
  healthRequest(): Promise<{ status: string; granted: string[] }>;
  healthRead(options: { from: number; to: number; zone: string }): Promise<HealthData>;
  openHealthConnect(): Promise<void>;
  /** "Log <medicine>" shortcuts (Android: long-press the app icon; iPhone: Siri and the Shortcuts app). */
  setShortcuts(options: { items: { id: string; label: string }[] }): Promise<void>;
  /** What can stop or delay reminders on this phone. */
  reminderHealth(): Promise<{ notificationsEnabled: boolean; channelOff: boolean; batteryUnrestricted: boolean; manufacturer: string; sdk: number }>;
  openBatterySettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** What the home-screen widgets show (Android; see src/logic/widgets.ts). Also sent to the watch. */
  /** `watchJson`: the watch's own copy (no medicine names); without it the watch gets `json`. */
  setWidget(options: { json: string; watchJson?: string }): Promise<void>;
  /** Android: taps on the widgets still to log (cleared when read). */
  takeWidgetActions(): Promise<{ items: WidgetAction[] }>;
  /** Android: a widget was tapped (read them with takeWidgetActions). */
  addListener(event: 'widgetAction', fn: () => void): Promise<PluginListenerHandle>;
  /** Android: "log" taps from a paired Wear OS watch, waiting to be logged (cleared when read). */
  takeWatchLogs(): Promise<{ items: { medId: string; at: number }[] }>;
  /** From the watch: focus ratings, symptoms and reaction tests (biohacking tools), cleared. */
  takeWatchCheckIns(): Promise<{ items: WatchCheckIn[] }>;
  /** Android: download a newer build of this app from its GitHub release and open the installer. Rejects with `code`
   *  'permission' (the "install unknown apps" setting was opened), 'mismatch' or 'io'. */
  installUpdate(options: { url: string }): Promise<void>;
  /** Android: the workout in progress, for the watch ("{}" when there's none). */
  setWatchWorkout(options: { json: string }): Promise<void>;
  takeWatchSets(): Promise<{ items: { setId: string; at: number }[] }>;
  addListener(event: 'updateProgress', fn: (e: { pct: number }) => void): Promise<PluginListenerHandle>;
}

export type WidgetAction = { at: number } & ({ kind: 'dose'; medId: string } | { kind: 'intake'; field: 'proteinG' | 'waterMl'; amount: number } | { kind: 'chip'; chip: string });

export interface HealthDay {
  date: string; steps?: number; sleepMin?: number; restingHr?: number; exerciseMin?: number; hrvMs?: number; hrByHour?: (number | null)[];
  /** Heart rate and steps in 5-minute blocks (288 a day, local time). */
  hr5?: (number | null)[]; steps5?: number[];
  /** Sleep stages for the night ending that day, and when the main sleep began and ended (ms). */
  sleepDeepMin?: number; sleepRemMin?: number; sleepAwakeMin?: number; sleepWakes?: number; sleepStart?: number; sleepEnd?: number;
  spo2Avg?: number; spo2Min?: number; respRate?: number; skinTempDelta?: number; vo2max?: number; kcalTotal?: number; kcalActive?: number;
  floors?: number; climbM?: number; waterOtherMl?: number; foodOtherKcal?: number; foodOtherProteinG?: number; foodOtherCarbsG?: number; foodOtherFatG?: number;
  mindfulMin?: number; glucoseAvg?: number; glucoseMin?: number; glucoseMax?: number; glucoseInRange?: number; glucoseByHour?: (number | null)[];
}
export interface HealthData {
  days: HealthDay[]; weights: { t: number; kg: number; /** The app that wrote it. */ src?: string }[]; bp: { t: number; sys: number; dia: number }[];
  /** Exercise sessions from a watch or app: type is run, walk, ride, swim, row, strength or other. Older app versions leave these out. */
  workouts?: { t: number; end: number; type: string; km?: number; title?: string; avgHr?: number; maxHr?: number; kcal?: number; hrMin?: (number | null)[]; kmh?: number; watts?: number; climbM?: number }[];
  bodyFat?: { t: number; pct: number }[]; lean?: { t: number; kg: number }[];
}

export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
export const MedTapNative = registerPlugin<MedTapNativePlugin>('MedTapNative');

/** What the watch sends back besides dose taps and sets (as it sent it: check each field). */
export interface WatchCheckIn {
  at: number; focus?: number; mood?: number; energy?: number; sleepQuality?: number; chip?: string; chips?: unknown[];
  rtMs?: number; rtLapses?: number; rtEarly?: number; nbackPct?: number;
  caffeineMg?: number; drink?: string; waterMl?: number; hrBpm?: number; note?: string;
  /** A dose skipped from the watch's reminder: the medicine's id, and the set time it was for. */
  skip?: string; dueAt?: number;
}
