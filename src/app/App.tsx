import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import { useHashRoute } from './router';
import { TabBar } from '../components/TabBar';
import { Placeholder } from '../screens/Placeholder';
import { Settings } from '../screens/Settings';
import { UpdatePrompt } from './UpdatePrompt';

const titles: Record<string, string> = { '/today': 'Today', '/trends': 'Trends', '/body': 'Body', '/meds': 'Meds', '/settings': 'Settings' };

export function App() {
  const route = useHashRoute();
  const isSettings = route.startsWith('/settings');
  const title = titles['/' + route.split('/')[1]] ?? 'Today';

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-28" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between h-14">
        {isSettings ? (
          <a href="#/today" aria-label="Back" className="w-12 h-12 -ml-3 flex items-center justify-center"><ArrowLeft aria-hidden="true" /></a>
        ) : <span className="w-12" />}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {isSettings ? <span className="w-12" /> : (
          <a href="#/settings" aria-label="Settings" className="w-12 h-12 -mr-3 flex items-center justify-center"><SettingsIcon aria-hidden="true" /></a>
        )}
      </header>
      <main>
        {route.startsWith('/settings') ? <Settings />
          : route.startsWith('/trends') ? <Placeholder title="Trends" note="Charts arrive in Phase 4." />
          : route.startsWith('/body') ? <Placeholder title="Body" note="Weight and measurements arrive in Phase 3." />
          : route.startsWith('/meds') ? <Placeholder title="Meds" note="Add your medications here in Phase 1." />
          : <Placeholder title="Welcome" note="Your doses and countdowns will appear here. 🔒 Saved on this device." />}
      </main>
      {!isSettings && <TabBar route={route} />}
      <UpdatePrompt />
    </div>
  );
}
