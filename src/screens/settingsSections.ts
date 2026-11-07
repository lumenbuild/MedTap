// Settings page titles, apart from the Settings screen so the app's header doesn't load it.
import { APP_NAME } from '../config';

export type SettingsSection = 'targets' | 'reminders' | 'doses' | 'training' | 'checkins' | 'caffeine' | 'people' | 'health' | 'privacy' | 'display' | 'watch' | 'about';
export const SECTION_TITLE: Record<SettingsSection, string> = {
  targets: 'Targets', reminders: 'Reminders', doses: 'Doses', training: 'Training', checkins: 'Check-ins', caffeine: 'Caffeine', people: 'People and sync', health: 'Health data',
  privacy: 'Privacy', display: 'Display', watch: 'Watch', about: `About ${APP_NAME}`,
};
