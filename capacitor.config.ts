import type { CapacitorConfig } from '@capacitor/cli';

// The native apps load the same web app, built with `npm run build:native` (or build:native:tapdose) into dist-native/.
// TapDose, TapWeigh and TapLift are more Android apps from the same code (see src/edition.ts and the flavours in
// android/app/build.gradle).
const APPS: Record<string, { appId: string; appName: string }> = {
  medtap: { appId: 'app.medtap.tracker', appName: 'MedTap' },
  tapdose: { appId: 'app.tapdose.tracker', appName: 'TapDose' },
  tapweigh: { appId: 'app.tapweigh.tracker', appName: 'TapWeigh' },
  taplift: { appId: 'app.taplift.tracker', appName: 'TapLift' },
};
const config: CapacitorConfig = {
  ...(APPS[process.env.VITE_EDITION ?? ''] ?? APPS.medtap),
  webDir: 'dist-native',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never' },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_medtap', iconColor: '#0A0A0A' },
  },
};

export default config;
