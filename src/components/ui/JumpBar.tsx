import { useEffect, useState } from 'react';

/** A sticky row of chips, one per chart section on the screen: tap to jump to it. Built from the sections themselves, so
 *  a section that isn't showing has no chip. */
export function JumpBar({ deps = [], inline = false }: { deps?: unknown[]; inline?: boolean }) {
  const [items, setItems] = useState<{ el: HTMLElement; label: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const els = [...document.querySelectorAll<HTMLElement>('main section.chart-card[aria-label]')];
      setItems(els.map((el) => ({ el, label: el.getAttribute('aria-label') ?? '' })).filter((x) => x.label));
    }, 300);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  if (items.length < 4) return null;
  return (
    <nav aria-label="Jump to" className={`${inline ? 'mt-2' : 'sticky top-0 z-10 py-2 bg-bg'} -mx-6 px-6 overflow-x-auto no-scrollbar`}>
      <ul className="flex gap-2 w-max">
        {items.map(({ el, label }) => (
          <li key={label}>
            <button type="button" onClick={() => el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="h-9 px-3.5 rounded-chip bg-surface-2 text-sm font-medium whitespace-nowrap">{label}</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
