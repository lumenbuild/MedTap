import { Dumbbell, HeartPulse, House, Layers, LineChart, Pill, Scale, TrendingUp, Utensils, type LucideIcon } from 'lucide-react';
import { FOCUS, HAS_BODY } from '../edition';

type Tab = { path: string; label: string; Icon: LucideIcon; match?: string[] };

/** The main tabs. MedTap: Today, Stack (everything taken: medicines, peptides, supplements, and their stock), Food,
 *  Body (body, trends and records) and Health (the watch's data, sleep and training) when they're on. */
export function tabsFor(stack: boolean, training = false, sleep = false, health = false, food = false): Tab[] {
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
  // MedTap: five at most. Body holds trends too; Health holds sleep and training as sections.
  if (stack) return [
    { path: '/today', label: 'Today', Icon: House },
    { path: '/meds', label: 'Stack', Icon: Layers, match: ['/protocol'] },
    ...(food ? [{ path: '/food', label: 'Food', Icon: Utensils }] : []),
    { path: '/progress', label: HAS_BODY ? 'Body' : 'Insights', Icon: HAS_BODY ? Scale : TrendingUp, match: ['/trends', '/body'] },
    ...(health || sleep || training ? [{ path: health ? '/health' : sleep ? '/sleep' : '/training', label: 'Health', Icon: HeartPulse, match: ['/health', '/sleep', '/training'] }] : []),
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

export function TabBar({ route, stack, training = false, sleep = false, health = false, food = false }: { route: string; stack: boolean; training?: boolean; sleep?: boolean; health?: boolean; food?: boolean }) {
  const tabs = tabsFor(stack, training, sleep, health, food);
  // Six or seven tabs: a narrower pill and smaller label so each still fits a 360-wide phone.
  const tight = tabs.length >= 6;
  const cols = ['', '', '', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6', 'grid-cols-7'][tabs.length] ?? 'grid-cols-4';
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 bg-bg border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className={`mx-auto max-w-[560px] grid ${cols}`}>
        {tabs.map(({ path, label, Icon, match }) => {
          const active = [path, ...(match ?? [])].some((p) => route.startsWith(p));
          return (
            <li key={path}>
              <a href={`#${path}`} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[64px] ${tight ? 'text-[11px] tracking-[-0.01em]' : 'text-[12px]'} ${active ? 'text-text font-semibold' : 'text-muted font-medium'}`}>
                <span aria-hidden="true" className={`flex items-center justify-center ${tight ? 'w-11' : 'w-14'} h-8 rounded-full transition-colors ${active ? 'bg-primary text-on-primary' : ''}`}>
                  <Icon size={tight ? 21 : 22} strokeWidth={active ? 2.25 : 1.75} />
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
