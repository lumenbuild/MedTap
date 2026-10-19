import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import { parseRoute, useHashRoute, type Route } from './router';
import { ToastProvider } from './toast';
import { TabBar } from '../components/TabBar';
import { Placeholder } from '../screens/Placeholder';
import { Settings } from '../screens/Settings';
import { Today } from '../screens/Today/Today';
import { TagLanding } from '../screens/TagLanding/TagLanding';
import { MedsList } from '../screens/Meds/MedsList';
import { MedEditor } from '../screens/Meds/MedEditor';
import { UpdatePrompt } from './UpdatePrompt';

const titles: Record<Route['name'], string> = {
  today: 'Today', trends: 'Trends', body: 'Body', meds: 'Meds', settings: 'Settings',
  medNew: 'Add medication', med: 'Medication', tag: '',
};
const backTo: Partial<Record<Route['name'], string>> = { settings: '#/today', medNew: '#/meds', med: '#/meds' };

function Screen({ r }: { r: Route }) {
  switch (r.name) {
    case 'settings': return <Settings />;
    case 'trends': return <Placeholder title="Trends" note="Charts arrive in Phase 4." />;
    case 'body': return <Placeholder title="Body" note="Weight and measurements arrive in Phase 3." />;
    case 'meds': return <MedsList />;
    case 'medNew': return <MedEditor key={`new-${r.tagId ?? ''}`} tagId={r.tagId} />;
    case 'med': return <MedEditor key={r.id} id={r.id} />;
    case 'tag': return <TagLanding key={r.id} id={r.id} />;
    default: return <Today />;
  }
}

export function App() {
  const r = parseRoute(useHashRoute());
  const back = backTo[r.name];
  const showTabs = !back && r.name !== 'tag';

  return (
    <ToastProvider raised={showTabs}>
      <div className={`mx-auto max-w-[560px] px-4 ${showTabs ? 'pb-28' : 'pb-6'}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {r.name !== 'tag' && (
          <header className="flex items-center justify-between h-14">
            {back ? (
              <a href={back} aria-label="Back" className="w-12 h-12 -ml-3 flex items-center justify-center"><ArrowLeft aria-hidden="true" /></a>
            ) : <span className="w-12" />}
            <h1 className="text-2xl font-semibold">{titles[r.name]}</h1>
            {r.name === 'today' ? (
              <a href="#/settings" aria-label="Settings" className="w-12 h-12 -mr-3 flex items-center justify-center"><SettingsIcon aria-hidden="true" /></a>
            ) : <span className="w-12" />}
          </header>
        )}
        <main><Screen r={r} /></main>
        {showTabs && <TabBar route={'/' + r.name} />}
        <UpdatePrompt />
      </div>
    </ToastProvider>
  );
}
