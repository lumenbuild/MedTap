import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Settings as Gear, ArrowLeft } from 'lucide-react';
import { goBack, parseRoute, replace, useHashRoute, type Route } from './router';
import { ToastProvider } from './toast';
import { LockGate } from './LockGate';
import { viewMode } from './viewMode';
import { useMeds, useSettings } from './data';
import { TabBar } from '../components/TabBar';
import { HealthNav } from '../components/HealthNav';
import { SECTION_TITLE, type SettingsSection } from '../screens/settingsSections';
import { helpTitle } from '../screens/Help/topics';
import { shownName } from '../logic/privacy';
import { UpdatePrompt } from './UpdatePrompt';
import { useMaintenance } from './useMaintenance';
import { ScanTagButton } from '../components/ScanTagButton';
import { isNativeIOS } from '../platform';
import { HAS_MEDS, HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, HAS_PEPTIDES, HAS_VISITS } from '../edition';
import { useNow } from './useNow';

/** A screen loaded on first use. Only the shell above loads up front, so a tag tap fetches just the tag screen, and
 *  each screen's code (and the charts, the peptide guide, food data …) arrives only when it's opened. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const screen = <K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const loadToday = () => import('../screens/Today/Today');
const loadTagLanding = () => import('../screens/TagLanding/TagLanding');
const Today = screen(loadToday, 'Today');
const TagLanding = screen(loadTagLanding, 'TagLanding');

/** Start loading the first screen's code at boot, alongside main.tsx's start-up work, rather than after the first
 *  render: otherwise the shell and the screen load one after the other. A tag tap fetches the tag screen; opening
 *  the app, Today. (The browser keeps the module, so the screen's own lazy() gets it straight away.) */
export function preloadFirstScreen(hash: string) {
  const name = parseRoute(hash.replace(/^#/, '') || '/today').name;
  const load = name === 'tag' ? loadTagLanding : name === 'today' ? loadToday : undefined;
  load?.().catch(() => {}); // a failure shows when the screen itself loads
}
const Settings = screen(() => import('../screens/Settings'), 'Settings');
const MedsList = screen(() => import('../screens/Meds/MedsList'), 'MedsList');
const MedEditor = screen(() => import('../screens/Meds/MedEditor'), 'MedEditor');
const Body = screen(() => import('../screens/Body/Body'), 'Body');
const Backup = screen(() => import('../screens/Backup/Backup'), 'Backup');
const Help = screen(() => import('../screens/Help/Help'), 'Help');
const Onboarding = screen(() => import('../screens/Onboarding/Onboarding'), 'Onboarding');
const Sync = screen(() => import('../screens/Sync'), 'Sync');
const JoinSync = screen(() => import('../screens/Sync'), 'JoinSync');
const PeptideCalc = screen(() => import('../screens/PeptideCalc'), 'PeptideCalc');
const PeptideGuide = screen(() => import('../screens/PeptideGuide'), 'PeptideGuide');
const Brain = screen(() => import('../screens/Brain'), 'Brain');
const Journal = screen(() => import('../screens/Journal'), 'Journal');
const YearReview = screen(() => import('../screens/YearReview'), 'YearReview');
const Experiments = screen(() => import('../screens/Experiments'), 'Experiments');
const Supplies = screen(() => import('../screens/Supplies'), 'Supplies');
const Appointments = screen(() => import('../screens/Visits'), 'Appointments');
const AppointmentSummary = screen(() => import('../screens/Visits'), 'AppointmentSummary');
const Labs = screen(() => import('../screens/Visits'), 'Labs');
const Travel = screen(() => import('../screens/Travel'), 'Travel');
const Protocol = screen(() => import('../screens/Protocol/Protocol'), 'Protocol');
const Progress = screen(() => import('../screens/Progress'), 'Progress');

/** A peptide or medicine guide entry's name for the header, once its guide (a large module) has loaded. */
function useGuideName(id: string | undefined, kind: 'peptide' | 'medicine' = 'peptide'): string | undefined {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!id || names[`${kind}:${id}`] !== undefined) return;
    let live = true;
    const key = `${kind}:${id}`;
    if (kind === 'medicine') void import('../logic/medGuide').then((m) => { if (live) setNames((n) => ({ ...n, [key]: m.guideMedById(id)?.name ?? '' })); });
    else void import('../logic/peptideGuide').then((m) => { if (live) setNames((n) => ({ ...n, [key]: m.guideById(id)?.name ?? '' })); });
    return () => { live = false; };
  }, [id, names, kind]);
  return id ? names[`${kind}:${id}`] || undefined : undefined;
}

// Charts are the heaviest code; load them only when Trends or the report is opened, so tag taps stay fast.
const CaffeineFinder = lazy(() => import('../screens/CaffeineFinder').then((m) => ({ default: m.CaffeineFinder })));
const Trends = lazy(() => import('../screens/Trends/Trends').then((m) => ({ default: m.Trends })));
const Report = lazy(() => import('../screens/Report/Report').then((m) => ({ default: m.Report })));
const Training = lazy(() => import('../screens/Training/Training').then((m) => ({ default: m.Training })));
const WorkoutScreen = lazy(() => import('../screens/Training/WorkoutScreen').then((m) => ({ default: m.WorkoutScreen })));
const ExerciseScreen = lazy(() => import('../screens/Training/ExerciseScreen').then((m) => ({ default: m.ExerciseScreen })));
const Tags = lazy(() => import('../screens/Tags/Tags').then((m) => ({ default: m.Tags })));
const Routines = lazy(() => import('../screens/Training/Routines').then((m) => ({ default: m.Routines })));
const FoodScreen = lazy(() => import('../screens/Food').then((m) => ({ default: m.FoodScreen })));
const Sleep = lazy(() => import('../screens/Sleep').then((m) => ({ default: m.Sleep })));
const Health = lazy(() => import('../screens/Health').then((m) => ({ default: m.Health })));
const TopicScreen = lazy(() => import('../screens/Topic').then((m) => ({ default: m.Topic })));
const DataCheckScreen = lazy(() => import('../screens/DataCheck').then((m) => ({ default: m.DataCheck })));
const MedicineGuideScreen = lazy(() => import('../screens/MedicineGuide').then((m) => ({ default: m.MedicineGuide })));
const AheadScreen = lazy(() => import('../screens/Ahead').then((m) => ({ default: m.Ahead })));
const WeekScreen = lazy(() => import('../screens/Week').then((m) => ({ default: m.Week })));
const DayScreen = lazy(() => import('../screens/Day').then((m) => ({ default: m.Day })));
const TOPIC_TITLE: Record<string, string> = { sleep: 'Your sleep', rhr: 'Resting heart rate', hrv: 'HRV', focus: 'Focus', weight: 'Weight', lean: 'Lean mass' };
const Working = lazy(() => import('../screens/Working').then((m) => ({ default: m.Working })));
/** MedTap's layout: Today, Stack, Insights (and Training, Sleep). The other apps keep their own tabs. */
const STACK = HAS_PEPTIDES;
const ProtocolReport = lazy(() => import('../screens/Protocol/ProtocolReport').then((m) => ({ default: m.ProtocolReport })));
/** Shown for the moment a screen's code takes to load (it's on the phone, so usually a frame or two). */
const ScreenLoading = () => <div aria-busy="true" aria-label="Loading" className="min-h-[50vh]" />;
const ChartsLoading = () => <div className="space-y-4" aria-busy="true" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-60 rounded-card bg-surface-2 animate-pulse" />)}</div>;

const DATE_LINE = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

function title(r: Route, peptides = HAS_PEPTIDES, guideName?: string): string {
  switch (r.name) {
    case 'today': return 'Today';
    case 'trends': return 'Trends';
    case 'body': return HAS_BODY ? 'Body' : 'Vitals';
    case 'meds': return HAS_MEDS ? (STACK ? 'Stack' : 'Meds') : 'Today';
    case 'sleep': return 'Sleep';
    case 'health': return 'Health';
    case 'working': return "What's working";
    case 'settings': return r.section && r.section in SECTION_TITLE && !(!HAS_MEDS && ['doses', 'reminders'].includes(r.section)) && !(!HAS_TRAINING && r.section === 'training')
      ? SECTION_TITLE[r.section as SettingsSection] : 'Settings';
    case 'medNew': return HAS_MEDS ? 'Add medication' : 'Today';
    case 'med': return HAS_MEDS ? 'Medication' : 'Today';
    case 'backup': return 'Backup and restore';
    case 'report': return HAS_MEDS ? 'Doctor report' : 'Today';
    case 'help': return helpTitle(r.topic, HAS_PEPTIDES && viewMode() !== 'private');
    case 'sync': return 'Family sync';
    case 'join': return 'Join family sync';
    case 'calc': return peptides ? 'Peptide calculator' : 'Today';
    case 'guide': return peptides ? guideName || 'Peptide guide' : 'Today';
    case 'brain': return 'Brain test';
    case 'journal': return 'Journal';
    case 'year': return 'Year in review';
    case 'experiments': return 'Experiments';
    case 'supplies': return peptides ? 'Supplies' : 'Today';
    case 'protocol': return peptides ? 'Protocol' : 'Today';
    case 'protocolReport': return peptides ? 'Protocol report' : 'Today';
    case 'progress': return STACK ? (HAS_BODY ? 'Body' : 'Insights') : 'Progress';
    case 'training': return HAS_TRAINING ? 'Training' : 'Today';
    case 'workout': return HAS_TRAINING ? 'Workout' : 'Today';
    case 'exercise': return HAS_TRAINING ? 'Exercise' : 'Today';
    case 'routines': return HAS_TRAINING ? 'Routines' : 'Today';
    case 'tags': return 'Tags';
    case 'appointments': return HAS_VISITS ? 'Appointments' : 'Today';
    case 'appointmentSummary': return HAS_VISITS ? 'Since your last appointment' : 'Today';
    case 'labs': return HAS_MEDS ? 'Lab results' : 'Today';
    case 'food': return HAS_FOOD ? 'Food' : 'Today';
    case 'caffeine': return 'Caffeine cut-off and limit';
    case 'topic': return TOPIC_TITLE[r.id] ?? 'Insights';
    case 'day': return 'Your day';
    case 'week': return 'Your week';
    case 'ahead': return 'Week ahead';
    case 'medicines': return guideName || 'Medicine guide';
    case 'datacheck': return 'Check my records';
    case 'travel': return HAS_VISITS ? 'Plan a trip' : 'Today';
    default: return '';
  }
}

function backTo(r: Route, protocol: boolean, foodTab = false): string | undefined {
  switch (r.name) {
    case 'protocolReport': return '#/meds';
    case 'workout': case 'exercise': case 'routines': return '#/training';
    case 'appointments': return protocol ? '#/progress' : '#/trends';
    case 'travel': return '#/meds';
    case 'tags': return HAS_MEDS ? '#/meds' : '#/settings';
    case 'appointmentSummary': return '#/appointments';
    case 'food': return FOCUS === 'weight' || foodTab ? undefined : '#/today'; // a tab in TapWeigh, and in MedTap when food is on
    case 'caffeine': return '#/today';
    case 'topic': case 'day': case 'week': case 'ahead': return '#/today';
    case 'medicines': return r.id ? '#/medicines' : '#/meds';
    case 'datacheck': return '#/settings';
    case 'labs': return HAS_VISITS ? '#/appointments' : protocol ? '#/progress' : '#/trends';
    case 'settings': return r.section ? '#/settings' : '#/today';
    case 'medNew': return r.guideId ? `#/guide/${r.guideId}` : '#/meds';
    case 'med': return '#/meds';
    case 'guide': return r.id ? '#/guide' : '#/meds';
    case 'brain': case 'journal': case 'year': case 'experiments': return protocol ? '#/progress' : '#/trends';
    case 'calc': case 'supplies': return '#/meds';
    case 'working': return protocol ? '#/progress' : '#/trends';
    case 'backup': case 'sync': case 'join': return '#/settings';
    case 'report': return protocol ? '#/progress' : '#/trends';
    case 'help': return r.topic ? '#/help' : '#/settings';
    default: return undefined;
  }
}

function Screen({ r }: { r: Route }) {
  // Peptide screens only while the peptide tools are on (they're off in the private view too).
  const st = useSettings();
  const peptides = HAS_PEPTIDES && !!st?.peptideTools;
  const bio = HAS_PEPTIDES && !!st?.biohackTools;
  const sleepOn = HAS_PEPTIDES && !!st?.sleepTools;
  switch (r.name) {
    case 'settings': return <Settings section={r.section} />;
    case 'trends': return <Suspense fallback={<ChartsLoading />}><Trends /></Suspense>;
    case 'body': return <Body />;
    // TapWeigh and TapLift have no medicines: their links land on Today.
    case 'meds': return HAS_MEDS ? <MedsList /> : <Today />;
    case 'medNew': return HAS_MEDS ? <MedEditor key={`new-${r.tagId ?? ''}-${r.guideId ?? ''}`} tagId={r.tagId} guideId={peptides ? r.guideId : undefined} /> : <Today />;
    case 'med': return HAS_MEDS ? <MedEditor key={r.id} id={r.id} section={r.section} /> : <Today />;
    case 'sleep': return sleepOn ? <Suspense fallback={<ChartsLoading />}><Sleep /></Suspense> : <Today />;
    case 'health': return <Suspense fallback={<ChartsLoading />}><Health /></Suspense>;
    case 'working': return <Suspense fallback={<ChartsLoading />}><Working /></Suspense>;
    case 'tag': return <TagLanding key={r.id} id={r.id} />;
    case 'backup': return <Backup />;
    case 'report': return HAS_MEDS ? <Suspense fallback={<ChartsLoading />}><Report /></Suspense> : <Today />;
    case 'help': return <Help topic={r.topic} />;
    case 'sync': return <Sync />;
    case 'join': return <JoinSync code={r.code} />;
    case 'calc': return peptides ? <PeptideCalc key={r.medId ?? 'calc'} medId={r.medId} /> : <Today />;
    case 'guide': return peptides ? <PeptideGuide key={r.id ?? 'list'} id={r.id} /> : <Today />;
    case 'brain': return bio ? <Brain /> : <Today />;
    case 'journal': return bio ? <Journal /> : <Today />;
    case 'year': return bio ? <YearReview /> : <Today />;
    case 'experiments': return <Experiments key={r.guideId ?? 'list'} guideId={r.guideId} />;
    case 'supplies': return peptides ? <Supplies /> : <Today />;
    case 'protocol': return peptides ? <Protocol /> : <Today />;
    case 'protocolReport': return peptides ? <Suspense fallback={<ChartsLoading />}><ProtocolReport /></Suspense> : <Today />;
    case 'progress': return <Progress view={r.view} />;
    case 'training': return HAS_TRAINING ? <Suspense fallback={<ChartsLoading />}><Training key={r.start ? 'start' : 'tab'} start={r.start} /></Suspense> : <Today />;
    case 'workout': return HAS_TRAINING ? <Suspense fallback={<ChartsLoading />}><WorkoutScreen key={r.id} id={r.id} /></Suspense> : <Today />;
    case 'exercise': return HAS_TRAINING ? <Suspense fallback={<ChartsLoading />}><ExerciseScreen key={r.id} id={r.id} /></Suspense> : <Today />;
    case 'tags': return <Suspense fallback={<ChartsLoading />}><Tags /></Suspense>;
    case 'routines': return HAS_TRAINING ? <Suspense fallback={<ChartsLoading />}><Routines /></Suspense> : <Today />;
    case 'appointments': return HAS_VISITS ? <Appointments /> : <Today />;
    case 'appointmentSummary': return HAS_VISITS ? <AppointmentSummary /> : <Today />;
    case 'labs': return HAS_MEDS ? <Labs /> : <Today />;
    case 'food': return HAS_FOOD ? <Suspense fallback={<ChartsLoading />}><FoodScreen /></Suspense> : <Today />;
    case 'caffeine': return <Suspense fallback={<ChartsLoading />}><CaffeineFinder /></Suspense>;
    case 'topic': return <Suspense fallback={<ChartsLoading />}><TopicScreen key={r.id} id={r.id} /></Suspense>;
    case 'day': return <Suspense fallback={<ChartsLoading />}><DayScreen key={r.date ?? 'today'} date={r.date} /></Suspense>;
    case 'week': return <Suspense fallback={<ChartsLoading />}><WeekScreen /></Suspense>;
    case 'ahead': return <Suspense fallback={<ChartsLoading />}><AheadScreen /></Suspense>;
    case 'datacheck': return <Suspense fallback={<ChartsLoading />}><DataCheckScreen /></Suspense>;
    case 'medicines': return HAS_MEDS ? <Suspense fallback={<ChartsLoading />}><MedicineGuideScreen key={r.id ?? 'list'} id={r.id} /></Suspense> : <Today />;
    case 'travel': return HAS_VISITS ? <Travel /> : <Today />;
    default: return <Today />;
  }
}

export function App() {
  const r = parseRoute(useHashRoute());
  useMaintenance();
  const settings = useSettings();
  const meds = useMeds();
  // Peptide tools on (MedTap): the tabs are Today, Protocol, Progress (Trends and Body together) and Meds.
  const protocol = STACK;
  const training = HAS_TRAINING && !!settings?.trainingTools;
  // Food: its own tab in MedTap when food logging is on.
  const foodTab = STACK && HAS_FOOD && !!settings?.foodTracking;
  const back = backTo(r, protocol, foodTab);
  const now = useNow(60_000);
  const showTabs = !back && r.name !== 'tag';
  // A medicine's page is titled with its name.
  const pepName = useGuideName(r.name === 'guide' && HAS_PEPTIDES ? r.id : undefined);
  const medName = useGuideName(r.name === 'medicines' ? r.id : undefined, 'medicine');
  const guideName = r.name === 'medicines' ? medName : pepName;
  const pageMed = r.name === 'med' ? meds?.find((m) => m.id === r.id) : undefined;
  const heading = pageMed ? shownName(pageMed) : r.name === 'sleep' && settings && !settings.sleepTools ? 'Today'
    // MedTap: Sleep and Training are sections of Health.
    : STACK && ['sleep', 'training'].includes(r.name) ? 'Health' : title(r, protocol, guideName);
  // Progress is Trends and Body together, for the peptide layout. Without it they're separate tabs, so a link to
  // Progress opens the matching one.
  const loose = r.name === 'progress' && settings !== undefined && !STACK;
  useEffect(() => { if (loose) replace(r.view === 'body' ? '/body' : '/trends'); }, [loose, r]);
  // MedTap: Trends and Body live in Insights, and the peptide dashboard in each peptide's page on Stack.
  useEffect(() => {
    if (STACK && (r.name === 'trends' || r.name === 'body')) replace(`/progress/${r.name}`);
    if (STACK && r.name === 'protocol') replace('/meds');
  }, [r]);
  const sleepTab = HAS_PEPTIDES && !!settings?.sleepTools;
  // Health: everything from the watch, once Health data is on.
  const healthTab = STACK && !!settings?.healthImport;
  // First run only: no medications yet and never onboarded. Tag taps and help skip it.
  const onboarding = r.name === 'welcome' || (settings && meds && !settings.onboarded && meds.length === 0 && !['tag', 'help', 'medNew', 'backup', 'join'].includes(r.name));

  return (
    <ToastProvider raised={showTabs && !onboarding}>
      <LockGate>
        <div className={`mx-auto max-w-[560px] px-6 ${showTabs && !onboarding ? 'pb-28' : 'pb-6'}`} style={{ paddingTop: onboarding ? undefined : 'env(safe-area-inset-top)' }}>
          {onboarding ? <Suspense fallback={<ScreenLoading />}><Onboarding again={r.name === 'welcome'} /></Suspense> : (
            <>
              {r.name !== 'tag' && (back ? (
                <header className="app-header flex items-center gap-1 h-14">
                  <a href={back} aria-label="Back" className="w-11 h-11 -ml-3 flex items-center justify-center" onClick={(e) => { e.preventDefault(); goBack(back); }}><ArrowLeft size={22} strokeWidth={1.5} aria-hidden="true" /></a>
                  <h1 className="text-xl font-medium truncate">{heading}</h1>
                </header>
              ) : (
                // B2: the date (Today) or nothing in a slim top row, then a large light title. On Today the next dose is the
                // headline, so its title is for screen readers only.
                <header className="app-header">
                  <div className="flex items-center justify-between h-14">
                    <p className="text-sm text-muted font-medium">{r.name === 'today' ? DATE_LINE.format(now) : ''}</p>
                    <div className="flex items-center -mr-3">
                      {r.name === 'today' && isNativeIOS && <ScanTagButton />}
                      {r.name !== 'settings' && (
                        <a href="#/settings" aria-label="Settings" className="w-11 h-11 flex items-center justify-center"><Gear size={22} strokeWidth={1.75} aria-hidden="true" /></a>
                      )}
                    </div>
                  </div>
                  <h1 className={r.name === 'today' ? 'text-[34px] leading-[40px] font-extrabold tracking-[-0.02em] -mt-1 mb-4' : 'text-[34px] leading-[40px] font-extrabold tracking-[-0.02em] mt-2 mb-4'}>{heading}</h1>
                </header>
              ))}
              <main>
                {STACK && ['health', 'sleep', 'training'].includes(r.name) && <HealthNav route={'/' + r.name} overview={healthTab} sleep={sleepTab} training={training} />}
                <Suspense fallback={<ScreenLoading />}><Screen r={r} /></Suspense>
              </main>
              {showTabs && <TabBar route={'/' + r.name} stack={STACK} training={training} sleep={sleepTab} health={healthTab} food={foodTab} />}
            </>
          )}
          <UpdatePrompt />
        </div>
      </LockGate>
    </ToastProvider>
  );
}
