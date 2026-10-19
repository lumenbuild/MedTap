import { Minus, Plus } from 'lucide-react';
import { round } from '../../logic/stock';

export function Stepper({ value, onChange, step = 1, min = 0, label, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; label: string; suffix?: string;
}) {
  const set = (v: number) => onChange(Math.max(min, round(v)));
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" onClick={() => set(value - step)} disabled={value - step < min}
        aria-label={`Decrease ${label}`} className="w-12 h-12 rounded-btn bg-surface-2 flex items-center justify-center disabled:opacity-40">
        <Minus aria-hidden="true" />
      </button>
      <label className="flex-1 flex items-baseline justify-center gap-1.5 min-h-[48px] rounded-btn bg-surface-2 px-3">
        <span className="sr-only">{label}</span>
        <input
          type="number" inputMode="decimal" min={min} step="any" value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className="w-20 bg-transparent text-center text-2xl font-semibold tnum py-2 outline-none"
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </label>
      <button type="button" onClick={() => set((Number.isFinite(value) ? value : 0) + step)}
        aria-label={`Increase ${label}`} className="w-12 h-12 rounded-btn bg-surface-2 flex items-center justify-center">
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
