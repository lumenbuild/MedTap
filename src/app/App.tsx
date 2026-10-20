import { lazy, Suspense } from 'react';
import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import { parseRoute, useHashRoute, type Route } from './router';
import { ToastProvider } from './toast';
import { LockGate } from './LockGate';
import { useMeds, useSettings } from './data';
import { TabBar } from '../components/TabBar';
import { Settings } from '../screens/Settings';
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
import { UpdatePrompt } from './UpdatePrompt';
import { useMaintenance } from './maintenance';
import { ScanTagButton } from '../components/ScanTagButton';
import { isNativeIOS } from '../platform';

// Charts are the heaviest code; load them only when Trends or the report is opened, so tag taps stay fast.
const Trends = lazy(() => import('../screens/Trends/Trends').then((m) => ({ default: m.Trends })));
const Report = lazy(() => import('../screens/Report/Report').then((m) => ({ default: m.Report })));
const ChartsLoading = () => <div className="space-y-4" aria-busy="true" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-60 rounded-card bg-surface-2 animate-pulse" />)}</div>;

function title(r: Route): string {
  switch (r.name) {
    case 'today': return 'Today';
    case 'trends': return 'Trends';
    case 'body': return 'Body';
    case 'meds': return 'Meds';
    case 'settings': return 'Settings';
    case 'medNew': return 'Add medication';
    case 'med': return 'Medication';
    case 'backup': return 'Backup and restore';
    case 'report': return 'Doctor report';
    case 'help': return helpTitle(r.topic);
    case 'sync': return 'Family sync';
    case 'join': return 'Join family sync';
    case 'calc': return 'Peptide calculator';
    case 'supplies': return 'Supplies';
    default: return '';
  }
}

function backTo(r: Route): string | undefined {
  switch (r.name) {
    case 'settings': return '#/today';
    case 'medNew': case 'med': return '#/meds';
    case 'backup': case 'sync': case 'join': case 'calc': case 'supplies': return '#/settings';
    case 'report': return '#/trends';
    case 'help': return r.topic ? '#/help' : '#/settings';
    default: return undefined;
  }
}

function Screen({ r }: { r: Route }) {
  switch (r.name) {
    case 'settings': return <Settings />;
    case 'trends': return <Suspense fallback={<ChartsLoading />}><Trends /></Suspense>;
    case 'body': return <Body />;
    case 'meds': return <MedsList />;
    case 'medNew': return <MedEditor key={`new-${r.tagId ?? ''}`} tagId={r.tagId} />;
    case 'med': return <MedEditor key={r.id} id={r.id} />;
    case 'tag': return <TagLanding key={r.id} id={r.id} />;
    case 'backup': return <Backup />;
    case 'report': return <Suspense fallback={<ChartsLoading />}><Report /></Suspense>;
    case 'help': return <Help topic={r.topic} />;
    case 'sync': return <Sync />;
    case 'join': return <JoinSync code={r.code} />;
    case 'calc': return <PeptideCalc />;
    case 'supplies': return <Supplies />;
    default: return <Today />;
  }
}

export function App() {
  const r = parseRoute(useHashRoute());
  useMaintenance();
  const settings = useSettings();
  const meds = useMeds();
  const back = backTo(r);
  const showTabs = !back && r.name !== 'tag';
  // First run only: no medications yet and never onboarded. Tag taps and help skip it.
  const onboarding = settings && meds && !settings.onboarded && meds.length === 0 && !['tag', 'help', 'medNew', 'backup', 'join'].includes(r.name);

  return (
    <ToastProvider raised={showTabs && !onboarding}>
      <LockGate>
        <div className={`mx-auto max-w-[560px] px-4 ${showTabs && !onboarding ? 'pb-28' : 'pb-6'}`} style={{ paddingTop: onboarding ? undefined : 'env(safe-area-inset-top)' }}>
          {onboarding ? <Onboarding /> : (
            <>
              {r.name !== 'tag' && (
                <header className="app-header flex items-center justify-between h-14">
                  {back ? (
                    <a href={back} aria-label="Back" className="w-12 h-12 -ml-3 flex items-center justify-center"><ArrowLeft aria-hidden="true" /></a>
                  ) : r.name === 'today' && isNativeIOS ? <ScanTagButton /> : <span className="w-12" />}
                  <h1 className="text-2xl font-semibold truncate">{title(r)}</h1>
                  {r.name === 'today' ? (
                    <a href="#/settings" aria-label="Settings" className="w-12 h-12 -mr-3 flex items-center justify-center"><SettingsIcon aria-hidden="true" /></a>
                  ) : <span className="w-12" />}
                </header>
              )}
              <main><Screen r={r} /></main>
              {showTabs && <TabBar route={'/' + r.name} />}
            </>
          )}
          <UpdatePrompt />
        </div>
      </LockGate>
    </ToastProvider>
  );
}
