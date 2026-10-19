import { CalendarCheck, LineChart, Pill, Scale } from 'lucide-react';

const tabs = [
  { path: '/today', label: 'Today', Icon: CalendarCheck },
  { path: '/trends', label: 'Trends', Icon: LineChart },
  { path: '/body', label: 'Body', Icon: Scale },
  { path: '/meds', label: 'Meds', Icon: Pill },
];

export function TabBar({ route }: { route: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 inset-x-0 bg-surface border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto max-w-[560px] grid grid-cols-4">
        {tabs.map(({ path, label, Icon }) => {
          const active = route.startsWith(path);
          return (
            <li key={path}>
              <a
                href={`#${path}`}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-xs font-medium ${active ? 'text-primary' : 'text-muted'}`}
              >
                <Icon size={22} aria-hidden="true" />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
