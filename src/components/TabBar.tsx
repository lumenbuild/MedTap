import { Dumbbell, HeartPulse, House, LineChart, Pill, Scale, Syringe, TrendingUp, type LucideIcon } from 'lucide-react';
import { HAS_BODY } from '../edition';

type Tab = { path: string; label: string; Icon: LucideIcon; match?: string[] };

/** The main tabs. With peptide tools on (MedTap), the protocol comes first and Trends and Body share Progress. */
export function tabsFor(protocol: boolean, training = false): Tab[] {
  const train: Tab[] = training ? [{ path: '/training', label: 'Training', Icon: Dumbbell }] : [];
  if (protocol) return [
    { path: '/today', label: 'Today', Icon: House },
    { path: '/protocol', label: 'Protocol', Icon: Syringe },
    ...train,
    { path: '/progress', label: 'Progress', Icon: TrendingUp, match: ['/trends', '/body'] },
    { path: '/meds', label: 'Meds', Icon: Pill },
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

export function TabBar({ route, protocol, training = false }: { route: string; protocol: boolean; training?: boolean }) {
  const tabs = tabsFor(protocol, training);
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 bg-bg border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className={`mx-auto max-w-[560px] grid ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
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
