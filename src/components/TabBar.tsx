import { Dumbbell, HeartPulse, House, Layers, LineChart, Moon, Pill, Scale, TrendingUp, Utensils, type LucideIcon } from 'lucide-react';
import { FOCUS, HAS_BODY } from '../edition';

type Tab = { path: string; label: string; Icon: LucideIcon; match?: string[] };

/** The main tabs. MedTap: Today, Stack (everything taken: medicines, peptides, supplements, and their stock), Insights
 *  (trends, body and records), then Training, Sleep and Health (the watch's data) when they're on. */
export function tabsFor(stack: boolean, training = false, sleep = false, health = false): Tab[] {
  const train: Tab[] = training ? [{ path: '/training', label: 'Training', Icon: Dumbbell }] : [];
  // TapWeigh: weight first, then food. TapLift: training first. Neither has medicines.
  if (FOCUS === 'weight') return [
    { path: '/today', label: 'Today', Icon: House },
    { path: '/body', label: 'Body', Icon: Scale },
    { path: '/food', label: 'Food', Icon: Utensils },
    { path: '/trends', label: 'Trends', Icon: LineChart },
  ];
  if (FOCUS === 'training') return [
    { path: '/today', label: 'Today', Icon: House },
    { path: '/training', label: 'Training', Icon: Dumbbell },
    { path: '/trends', label: 'Trends', Icon: LineChart },
    { path: '/body', label: 'Body', Icon: Scale },
  ];
  if (stack) return [
    { path: '/today', label: 'Today', Icon: House },
    { path: '/meds', label: 'Stack', Icon: Layers, match: ['/protocol'] },
    { path: '/progress', label: 'Insights', Icon: TrendingUp, match: ['/trends', '/body'] },
    ...train,
    ...(sleep ? [{ path: '/sleep', label: 'Sleep', Icon: Moon }] : []),
    ...(health ? [{ path: '/health', label: 'Health', Icon: HeartPulse }] : []),
  ];
  return [
    { path: '/today', label: 'Today', Icon: House },
    ...train,
    { path: '/trends', label: 'Trends', Icon: LineChart },
    // TapDose has no weight or measurements; the tab holds blood pressure and heart rate only.
    { path: '/body', label: HAS_BODY ? 'Body' : 'Vitals', Icon: HAS_BODY ? Scale : HeartPulse },
    { path: '/meds', label: 'Meds', Icon: Pill },
  ];
}

export function TabBar({ route, stack, training = false, sleep = false, health = false }: { route: string; stack: boolean; training?: boolean; sleep?: boolean; health?: boolean }) {
  const tabs = tabsFor(stack, training, sleep, health);
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 bg-bg border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className={`mx-auto max-w-[560px] grid ${tabs.length === 6 ? 'grid-cols-6' : tabs.length === 5 ? 'grid-cols-5' : tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {tabs.map(({ path, label, Icon, match }) => {
          const active = [path, ...(match ?? [])].some((p) => route.startsWith(p));
          return (
            <li key={path}>
              <a href={`#${path}`} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[64px] text-[12px] ${active ? 'text-text font-semibold' : 'text-muted font-medium'}`}>
                <span aria-hidden="true" className={`flex items-center justify-center w-14 h-8 rounded-full transition-colors ${active ? 'bg-primary text-on-primary' : ''}`}>
                  <Icon size={22} strokeWidth={active ? 2.25 : 1.75} />
                </span>
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
