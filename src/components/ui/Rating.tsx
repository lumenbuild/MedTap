export const MOOD_LABELS = ['Low', 'Meh', 'OK', 'Good', 'Great'];

/** 1–5 scale as five large buttons with labels at each end. Tapping the chosen value again clears it. */
export function Rating({ label, value, onChange, low, high }: {
  label: string; value?: number; onChange: (v: number | undefined) => void; low: string; high: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium mb-1.5">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5${n === 1 ? `, ${low}` : n === 5 ? `, ${high}` : ''}`}
            onClick={() => onChange(value === n ? undefined : n)}
            className={`min-h-[48px] rounded-btn font-medium tnum transition-colors ${value === n ? 'bg-primary text-on-primary' : 'border border-border-strong'}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted" aria-hidden="true"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

/** Mood: five words, low to great. */
export function MoodPicker({ value, onChange, compact = false }: { value?: number; onChange: (v: number | undefined) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Mood" className="grid grid-cols-5 gap-1.5">
      {MOOD_LABELS.map((label, i) => {
        const n = i + 1;
        const on = value === n;
        return (
          <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? undefined : n)}
            className={`${compact ? 'min-h-[48px]' : 'min-h-[52px]'} rounded-btn text-sm font-medium transition-colors ${on ? 'bg-primary text-on-primary' : 'border border-border-strong'}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
