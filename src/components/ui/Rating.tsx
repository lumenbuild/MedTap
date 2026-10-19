import { Angry, Frown, Laugh, Meh, Smile } from 'lucide-react';

export const MOOD_LABELS = ['Very low', 'Low', 'Okay', 'Good', 'Great'];
export const MOOD_ICONS = [Angry, Frown, Meh, Smile, Laugh];

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
            className={`min-h-[48px] rounded-btn font-semibold tnum transition-colors ${value === n ? 'bg-primary text-on-primary' : value && n < value ? 'bg-primary-soft text-primary' : 'bg-surface-2'}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted" aria-hidden="true"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

/** Mood: five faces with words, not just colour. */
export function MoodPicker({ value, onChange, compact = false }: { value?: number; onChange: (v: number | undefined) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Mood" className="grid grid-cols-5 gap-1.5">
      {MOOD_ICONS.map((Icon, i) => {
        const n = i + 1;
        const on = value === n;
        return (
          <button key={n} type="button" role="radio" aria-checked={on} aria-label={MOOD_LABELS[i]} onClick={() => onChange(on ? undefined : n)}
            className={`flex flex-col items-center justify-center gap-1 ${compact ? 'min-h-[56px]' : 'min-h-[72px]'} rounded-btn transition-colors ${on ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>
            <Icon size={compact ? 24 : 28} aria-hidden="true" />
            {!compact && <span className="text-xs font-medium">{MOOD_LABELS[i]}</span>}
          </button>
        );
      })}
    </div>
  );
}
