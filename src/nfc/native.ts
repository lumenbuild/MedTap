// The native app's own plugin (native/medtap-native): NFC on Android and iPhone, and printing.
// Only used when running inside the iOS/Android app; the website uses Web NFC instead.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface MedTapNativePlugin {
  nfcStatus(): Promise<{ supported: boolean; enabled: boolean }>;
  /** Waits for a tag and writes one URL record to it. Rejects with `code` set to an NfcErrorKind. */
  nfcWrite(options: { url: string; timeoutMs: number }): Promise<void>;
  /** Waits for a tag and returns the first URL on it. */
  nfcRead(options: { timeoutMs: number }): Promise<{ url: string | null }>;
  nfcCancel(): Promise<void>;
  /** Android: deliver tag taps to the app while it's open ('tag' events). */
  nfcListen(): Promise<void>;
  openNfcSettings(): Promise<void>;
  print(options: { name: string }): Promise<void>;
  shareFile(options: { name: string; base64: string; mime: string; title: string }): Promise<void>;
  addListener(event: 'tag', fn: (e: { url: string | null }) => void): Promise<PluginListenerHandle>;
}

export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
export const MedTapNative = registerPlugin<MedTapNativePlugin>('MedTapNative');
