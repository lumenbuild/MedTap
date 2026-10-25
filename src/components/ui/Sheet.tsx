import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// undefined: not inside a sheet. null: inside one, footer not mounted yet.
const FooterSlot = createContext<HTMLElement | null | undefined>(undefined);

/** Bottom sheet dialog for quick forms and confirmations.
 *  It always fits the visible screen (address bar, keyboard and system bars included): the title stays at the top,
 *  the content scrolls, and anything wrapped in <SheetActions> stays pinned at the bottom. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);

  // The latest onClose, without re-running the effect below: callers pass a new function on every render, and screens
  // re-render often (Today every second). Re-running it moved focus to the sheet, which closed the phone's keyboard as
  // soon as a field was tapped.
  const close = useRef(onClose);
  close.current = onClose;

  // What had focus before the sheet opened, taken while rendering: by the time the effect runs, a field with autoFocus
  // inside the sheet already has it.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const prev = opener.current;
    // Into the sheet, unless a field in it already has focus (taking it would close the keyboard straight away).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Counted, for a sheet opened from a sheet. While any is open, toasts show at the top (index.css).
    const b = document.body.dataset;
    b.sheets = String(Number(b.sheets ?? 0) + 1);
    return () => {
      document.removeEventListener('keydown', onKey);
      const n = Number(b.sheets ?? 1) - 1;
      if (n > 0) b.sheets = String(n); else delete b.sheets;
      if (!n) document.body.style.overflow = '';
      const now = document.activeElement;
      if (prev?.isConnected && (!now || now === document.body || ref.current?.contains(now))) prev.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop fixed inset-x-0 top-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="sheet-panel relative w-full max-w-[560px] flex flex-col bg-surface rounded-t-card shadow-card animate-slide-up outline-none"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id={id} className="text-lg font-semibold pt-2 min-w-0 break-words">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 w-12 h-12 -mr-3 -mt-1 flex items-center justify-center rounded-btn text-muted">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="sheet-body flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5" onFocus={keepInView}>
          <FooterSlot.Provider value={footer}>{children}</FooterSlot.Provider>
        </div>
        <div ref={setFooter} className="sheet-footer shrink-0 px-5 pt-3 border-t border-border space-y-2 empty:hidden" />
      </div>
    </div>,
    document.body,
  );
}

/** A key that changes each time `value` becomes a new value, so a form in a sheet starts fresh each time it opens. Worked
 *  out while rendering: bumping a key from an effect rebuilt the form just after it opened, which moved focus off the
 *  field and shut the phone's keyboard as soon as it appeared. */
export function useFreshKey(value: unknown): number {
  const last = useRef<unknown>(undefined);
  const n = useRef(0);
  if (value !== last.current) { last.current = value; if (value) n.current += 1; }
  return n.current;
}

/** The sheet's main buttons: pinned to the bottom of the sheet so they never need scrolling to.
 *  Outside a sheet (e.g. a flow also used on a full screen) they render where they are. */
export function SheetActions({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  // Outside a sheet (the tag screen): stick to the bottom of the screen so Log dose is always in reach.
  if (slot === undefined) return <div className="sticky bottom-0 z-10 bg-bg pt-3 pb-[max(12px,env(safe-area-inset-bottom))] space-y-2">{children}</div>;
  return slot ? createPortal(children, slot) : null;
}

/** When the keyboard opens, keep the field being typed in on screen (above the pinned buttons). */
function keepInView(e: React.FocusEvent<HTMLDivElement>) {
  const el = e.target as HTMLElement;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 300);
}
