// Single source of truth for platform branching. UI should use these, not sniff the user agent.
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

// iPadOS 13+ reports as Macintosh, so also check for touch support.
export const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);

export const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const canWriteNFC = typeof window !== 'undefined' && 'NDEFReader' in window;
export const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
export const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
