import { HAS_BODY } from '../edition';

type Tab = { path: string; label: string; match?: string[] };

/** The main tabs. With peptide tools on (MedTap), the protocol comes first and Trends and Body share Progress. */
export function tabsFor(protocol: boolean, training = false): Tab[] {
  const train: Tab[] = training ? [{ path: '/training', label: 'Training' }] : [];
  if (protocol) return [
    { path: '/today', label: 'Today' },
    { path: '/protocol', label: 'Protocol' },
    ...train,
    { path: '/progress', label: 'Progress', match: ['/trends', '/body'] },
    { path: '/meds', label: 'Meds' },
  ];
  return [
    { path: '/today', label: 'Today' },
    ...train,
    { path: '/trends', label: 'Trends' },
    // TapDose has no weight or measurements; the tab holds blood pressure and heart rate only.
    { path: '/body', label: HAS_BODY ? 'Body' : 'Vitals' },
    { path: '/meds', label: 'Meds' },
  ];
}

export function TabBar({ route, protocol, training = false }: { route: string; protocol: boolean; training?: boolean }) {
  const tabs = tabsFor(protocol, training);
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 bg-bg border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className={`mx-auto max-w-[560px] grid ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {tabs.map(({ path, label, match }) => {
          const active = [path, ...(match ?? [])].some((p) => route.startsWith(p));
          return (
            <li key={path}>
              <a href={`#${path}`} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1.5 min-h-[64px] text-[13px] ${active ? 'text-text font-semibold' : 'text-muted font-medium'}`}>
                {label}
                <span aria-hidden="true" className={`w-1 h-1 rounded-full ${active ? 'bg-text' : ''}`} />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
