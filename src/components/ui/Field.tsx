import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const inputCls = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3.5 text-base outline-none focus:border-primary';

/** Label above, optional helper text, inline error. Never placeholder-only. */
export function Field({ label, help, error, children, id }: { label: ReactNode; help?: ReactNode; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
      {help && !error && <p id={`${id}-help`} className="text-sm text-muted">{help}</p>}
      {error && <p id={`${id}-err`} className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

type Common = { label: ReactNode; help?: ReactNode; error?: string };

export function TextInput({ label, help, error, className = '', ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
        className={`${inputCls} ${className}`} {...rest} />
    </Field>
  );
}

export function Select({ label, help, error, children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <select id={id} className={inputCls} {...rest}>{children}</select>
    </Field>
  );
}

export function TextArea({ label, help, error, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <textarea id={id} className={`${inputCls} py-3 min-h-[96px]`} {...rest} />
    </Field>
  );
}

/** Row of mutually exclusive options. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 p-1 rounded-btn bg-surface-2" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-[44px] rounded-[10px] text-sm font-semibold transition-colors ${value === o.value ? 'bg-surface shadow-card text-text' : 'text-muted'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
