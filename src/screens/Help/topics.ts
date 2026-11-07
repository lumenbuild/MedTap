// Help topic titles, apart from the Help screen so the app's header can name a topic without loading every page.
import { Coffee, Utensils, BellRing, Sparkles, CalendarClock, Compass, Info, Lock, Nfc, RefreshCw, ScanText, ShieldCheck, Smartphone, Syringe, Target, Users, Dumbbell } from 'lucide-react';
import { APP_NAME } from '../../config';
import { HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, HAS_PEPTIDES } from '../../edition';

// TapWeigh and TapLift have no medicines: their topics are listed in FOCUS_TOPIC_IDS and their own pages come from
// HelpFocus.tsx.
export const ALL_TOPICS = [
  { id: 'start', title: 'Getting started', Icon: Compass },
  { id: 'schedules', title: 'Setting up a schedule', Icon: CalendarClock },
  { id: 'scan', title: 'Scanning a pharmacy label', Icon: ScanText },
  ...(HAS_BODY ? [{ id: 'goals', title: 'Goals and forecasts', Icon: Target }] as const : []),
  ...(HAS_TRAINING ? [{ id: 'training', title: 'Training and fitness', Icon: Dumbbell }] as const : []),
  ...(HAS_FOOD ? [{ id: 'food', title: 'Food and nutrition', Icon: Utensils }] as const : []),
  { id: 'caffeine', title: 'Caffeine', Icon: Coffee },
  { id: 'peptides', title: 'Peptides and injections', Icon: Syringe, peptides: true },
  { id: 'family', title: 'Family members', Icon: Users },
  { id: 'sync', title: 'Family sync', Icon: RefreshCw },
  { id: 'tags', title: FOCUS === 'meds' ? 'Which tags work' : 'Tags', Icon: Nfc },
  { id: 'phones', title: 'iPhone and Android', Icon: Smartphone },
  { id: 'reminders', title: FOCUS === 'meds' ? 'Reminders' : 'Check-ins and notifications', Icon: BellRing },
  { id: 'patterns', title: FOCUS === 'meds' ? 'Patterns and planning' : 'Trends', Icon: Sparkles },
  { id: 'privacy', title: 'Privacy', Icon: ShieldCheck },
  { id: 'lock', title: 'App lock', Icon: Lock },
  { id: 'about', title: `About ${APP_NAME}`, Icon: Info },
] as const;
const FOCUS_TOPIC_IDS = ['start', 'tags', 'goals', 'food', 'caffeine', 'training', 'reminders', 'patterns', 'family', 'sync', 'phones', 'privacy', 'lock', 'about'];
export const TOPICS = FOCUS === 'meds' ? ALL_TOPICS : ALL_TOPICS.filter((t) => FOCUS_TOPIC_IDS.includes(t.id)).sort((a, b) => FOCUS_TOPIC_IDS.indexOf(a.id) - FOCUS_TOPIC_IDS.indexOf(b.id));

export const helpTitle = (topic?: string, peptides = HAS_PEPTIDES) => TOPICS.filter((t) => !('peptides' in t) || peptides).find((t) => t.id === topic)?.title ?? 'Help';
