import type { ReactNode } from 'react';

/** An on/off setting: the label and what it does on the left, a switch on the right, with On or Off beside it.
 *  Changes save straight away, like every setting. */
export function Switch({ label, children, checked, onChange }: { label: string; children?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 min-h-[48px] text-left">
      <span className="flex-1 min-w-0">
        <span className="block font-medium">{label}</span>
        {children && <span className="block text-sm text-muted">{children}</span>}
      </span>
      <span className="shrink-0 flex items-center gap-2" aria-hidden="true">
        <span className="text-[13px] text-muted w-6 text-right">{checked ? 'On' : 'Off'}</span>
        <span className={`relative w-12 h-7 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-2 border border-border-strong'}`}>
          <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full shadow transition-all ${checked ? 'left-6 bg-on-primary' : 'left-1 bg-muted'}`} />
        </span>
      </span>
    </button>
  );
}
