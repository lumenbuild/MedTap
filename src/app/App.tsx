import { lazy, Suspense, useEffect } from 'react';
import { Settings as Gear, ArrowLeft } from 'lucide-react';
import { goBack, parseRoute, replace, useHashRoute, type Route } from './router';
import { ToastProvider } from './toast';
import { LockGate } from './LockGate';
import { viewMode } from './viewMode';
import { useMeds, useSettings } from './data';
import { TabBar } from '../components/TabBar';
import { SECTION_TITLE, Settings, type SettingsSection } from '../screens/Settings';
import { Today } from '../screens/Today/Today';
import { TagLanding } from '../screens/TagLanding/TagLanding';
import { MedsList } from '../screens/Meds/MedsList';
import { MedEditor } from '../screens/Meds/MedEditor';
import { Body } from '../screens/Body/Body';
import { Backup } from '../screens/Backup/Backup';
import { Help, helpTitle } from '../screens/Help/Help';
import { Onboarding } from '../screens/Onboarding/Onboarding';
import { JoinSync, Sync } from '../screens/Sync';
import { PeptideCalc } from '../screens/PeptideCalc';
import { Supplies } from '../screens/Supplies';
import { Appointments, AppointmentSummary, Labs } from '../screens/Visits';
import { Travel } from '../screens/Travel';
import { UpdatePrompt } from './UpdatePrompt';
import { useMaintenance } from './maintenance';
import { ScanTagButton } from '../components/ScanTagButton';
import { isNativeIOS } from '../platform';
import { HAS_MEDS, HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, HAS_PEPTIDES, HAS_VISITS } from '../edition';
import { useNow } from './useNow';
import { Protocol } from '../screens/Protocol/Protocol';
import { Progress } from '../screens/Progress';

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
const ProtocolReport = lazy(() => import('../screens/Protocol/ProtocolReport').then((m) => ({ default: m.ProtocolReport })));
const ChartsLoading = () => <div className="space-y-4" aria-busy="true" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-60 rounded-card bg-surface-2 animate-pulse" />)}</div>;

const DATE_LINE = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

function title(r: Route, peptides = HAS_PEPTIDES): string {
  switch (r.name) {
    case 'today': return 'Today';
    case 'trends': return 'Trends';
    case 'body': return HAS_BODY ? 'Body' : 'Vitals';
    case 'meds': return HAS_MEDS ? 'Meds' : 'Today';
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
    case 'supplies': return peptides ? 'Supplies' : 'Today';
    case 'protocol': return peptides ? 'Protocol' : 'Today';
    case 'protocolReport': return peptides ? 'Protocol report' : 'Today';
    case 'progress': return 'Progress';
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
    case 'travel': return HAS_VISITS ? 'Plan a trip' : 'Today';
    default: return '';
  }
}

function backTo(r: Route, protocol: boolean): string | undefined {
  switch (r.name) {
    case 'protocolReport': return '#/protocol';
    case 'workout': case 'exercise': case 'routines': return '#/training';
    case 'appointments': case 'travel': case 'tags': return '#/settings';
    case 'appointmentSummary': return '#/appointments';
    case 'food': return FOCUS === 'weight' ? undefined : '#/today'; // a tab in TapWeigh
    case 'caffeine': return '#/today';
    case 'labs': return HAS_VISITS ? '#/appointments' : '#/settings';
    case 'settings': return r.section ? '#/settings' : '#/today';
    case 'medNew': case 'med': return '#/meds';
    case 'backup': case 'sync': case 'join': case 'calc': case 'supplies': return '#/settings';
    case 'report': return protocol ? '#/progress' : '#/trends';
    case 'help': return r.topic ? '#/help' : '#/settings';
    default: return undefined;
  }
}

function Screen({ r }: { r: Route }) {
  // Peptide screens only while the peptide tools are on (they're off in the private view too).
  const peptides = HAS_PEPTIDES && !!useSettings()?.peptideTools;
  switch (r.name) {
    case 'settings': return <Settings section={r.section} />;
    case 'trends': return <Suspense fallback={<ChartsLoading />}><Trends /></Suspense>;
    case 'body': return <Body />;
    // TapWeigh and TapLift have no medicines: their links land on Today.
    case 'meds': return HAS_MEDS ? <MedsList /> : <Today />;
    case 'medNew': return HAS_MEDS ? <MedEditor key={`new-${r.tagId ?? ''}`} tagId={r.tagId} /> : <Today />;
    case 'med': return HAS_MEDS ? <MedEditor key={r.id} id={r.id} /> : <Today />;
    case 'tag': return <TagLanding key={r.id} id={r.id} />;
    case 'backup': return <Backup />;
    case 'report': return HAS_MEDS ? <Suspense fallback={<ChartsLoading />}><Report /></Suspense> : <Today />;
    case 'help': return <Help topic={r.topic} />;
    case 'sync': return <Sync />;
    case 'join': return <JoinSync code={r.code} />;
    case 'calc': return peptides ? <PeptideCalc /> : <Today />;
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
  const protocol = HAS_PEPTIDES && !!settings?.peptideTools;
  const training = HAS_TRAINING && !!settings?.trainingTools;
  const back = backTo(r, protocol);
  const now = useNow(60_000);
  const showTabs = !back && r.name !== 'tag';
  // Progress is Trends and Body together, for the peptide layout. Without it they're separate tabs, so a link to
  // Progress opens the matching one.
  const loose = r.name === 'progress' && settings !== undefined && !protocol;
  useEffect(() => { if (loose) replace(r.view === 'body' ? '/body' : '/trends'); }, [loose, r]);
  // First run only: no medications yet and never onboarded. Tag taps and help skip it.
  const onboarding = r.name === 'welcome' || (settings && meds && !settings.onboarded && meds.length === 0 && !['tag', 'help', 'medNew', 'backup', 'join'].includes(r.name));

  return (
    <ToastProvider raised={showTabs && !onboarding}>
      <LockGate>
        <div className={`mx-auto max-w-[560px] px-6 ${showTabs && !onboarding ? 'pb-28' : 'pb-6'}`} style={{ paddingTop: onboarding ? undefined : 'env(safe-area-inset-top)' }}>
          {onboarding ? <Onboarding again={r.name === 'welcome'} /> : (
            <>
              {r.name !== 'tag' && (back ? (
                <header className="app-header flex items-center gap-1 h-14">
                  <a href={back} aria-label="Back" className="w-11 h-11 -ml-3 flex items-center justify-center" onClick={(e) => { e.preventDefault(); goBack(back); }}><ArrowLeft size={22} strokeWidth={1.5} aria-hidden="true" /></a>
                  <h1 className="text-xl font-medium truncate">{title(r, protocol)}</h1>
                </header>
              ) : (
                // B2: the date (Today) or nothing in a slim top row, then a large light title. On Today the next dose is the
                // headline, so its title is for screen readers only.
                <header className="app-header">
                  <div className="flex items-center justify-between h-14">
                    <p className="text-sm text-muted">{r.name === 'today' ? DATE_LINE.format(now) : ''}</p>
                    <div className="flex items-center -mr-3">
                      {r.name === 'today' && isNativeIOS && <ScanTagButton />}
                      {r.name !== 'settings' && (
                        <a href="#/settings" aria-label="Settings" className="w-11 h-11 flex items-center justify-center"><Gear size={22} strokeWidth={1.75} aria-hidden="true" /></a>
                      )}
                    </div>
                  </div>
                  <h1 className={r.name === 'today' ? 'sr-only' : 'text-[44px] leading-[48px] font-light tracking-[-0.04em] mt-4 mb-6'}>{title(r, protocol)}</h1>
                </header>
              ))}
              <main><Screen r={r} /></main>
              {showTabs && <TabBar route={'/' + r.name} protocol={protocol} training={training} />}
            </>
          )}
          <UpdatePrompt />
        </div>
      </LockGate>
    </ToastProvider>
  );
}
