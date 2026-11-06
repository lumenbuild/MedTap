// Health's sections (MedTap): the watch's overview, sleep and training, one tab with a switch at the top.
export function HealthNav({ route, overview, sleep, training }: { route: string; overview: boolean; sleep: boolean; training: boolean }) {
  const items = [overview && { path: '/health', label: 'Overview' }, sleep && { path: '/sleep', label: 'Sleep' }, training && { path: '/training', label: 'Training' }]
    .filter((x): x is { path: string; label: string } => !!x);
  if (items.length < 2) return null;
  return (
    <nav aria-label="Health sections" className="mb-4 grid gap-1 p-1 rounded-full bg-surface-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((x) => {
        const on = route === x.path;
        return <a key={x.path} href={`#${x.path}`} aria-current={on ? 'page' : undefined}
          className={`min-h-[40px] rounded-full flex items-center justify-center text-[14px] font-medium ${on ? 'bg-surface shadow-card text-text' : 'text-muted'}`}>{x.label}</a>;
      })}
    </nav>
  );
}
