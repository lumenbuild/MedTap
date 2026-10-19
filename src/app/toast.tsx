import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastOpts { actionLabel?: string; onAction?: () => void; duration?: number }
interface ToastState extends ToastOpts { id: number; message: string }

const Ctx = createContext<(message: string, opts?: ToastOpts) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** One toast at a time, above the tab bar. Toasts with an action (Undo) stay for at least 10 seconds. */
export function ToastProvider({ children, raised }: { children: ReactNode; raised: boolean }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((message: string, opts: ToastOpts = {}) => {
    clearTimeout(timer.current);
    const t = { ...opts, message, id: Date.now() };
    setToast(t);
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === t.id ? null : cur)), opts.duration ?? (opts.onAction ? 10_000 : 4_000));
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className={`fixed left-4 right-4 z-50 mx-auto max-w-[528px] pointer-events-none ${raised ? 'bottom-[calc(76px+env(safe-area-inset-bottom))]' : 'bottom-[calc(16px+env(safe-area-inset-bottom))]'}`}
      >
        {toast && (
          <div key={toast.id} className="pointer-events-auto bg-text text-bg rounded-btn shadow-card pl-4 pr-2 py-2 flex items-center justify-between gap-3 animate-slide-up">
            <span className="text-sm py-2">{toast.message}</span>
            {toast.onAction && (
              <button
                onClick={() => { toast.onAction?.(); setToast(null); }}
                className="min-h-[44px] min-w-[48px] px-3 rounded-btn font-semibold text-primary-soft underline-offset-2 hover:underline"
              >
                {toast.actionLabel ?? 'Undo'}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
