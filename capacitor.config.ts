import type { CapacitorConfig } from '@capacitor/cli';

// The native apps load the same web app, built with `npm run build:native` into dist-native/.
const config: CapacitorConfig = {
  appId: 'app.medtap.tracker',
  appName: 'MedTap',
  webDir: 'dist-native',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never' },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_medtap', iconColor: '#0B7A75' },
  },
};

export default config;
