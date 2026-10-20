// Single source of truth for platform branching. UI should use these, not sniff the user agent.
import { isNative, nativePlatform } from './nfc/native';

/** Running inside the iOS/Android app rather than a browser. */
export { isNative };
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

// iPadOS 13+ reports as Macintosh, so also check for touch support.
export const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);

/** Opened from a home-screen web app (never true in the native app). */
export const isStandalone =
  !isNative && typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const canWriteNFC = isNative || (typeof window !== 'undefined' && 'NDEFReader' in window);
export const isNativeIOS = nativePlatform === 'ios';
export const isNativeAndroid = nativePlatform === 'android';
export const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
export const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
