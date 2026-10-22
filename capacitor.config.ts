import type { CapacitorConfig } from '@capacitor/cli';

// The native apps load the same web app, built with `npm run build:native` (or build:native:tapdose) into dist-native/.
// TapDose is a second Android app from the same code (see src/edition.ts and the flavours in android/app/build.gradle).
const tapdose = process.env.VITE_EDITION === 'tapdose';
const config: CapacitorConfig = {
  appId: tapdose ? 'app.tapdose.tracker' : 'app.medtap.tracker',
  appName: tapdose ? 'TapDose' : 'MedTap',
  webDir: 'dist-native',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never' },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_medtap', iconColor: '#0A0A0A' },
  },
};

export default config;
