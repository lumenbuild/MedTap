import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
// B2: one solid black button per screen; everything else is outlined.
const styles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-border-strong text-text hover:bg-surface-2',
  danger: 'border border-border-strong text-danger hover:bg-danger-soft',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`min-h-[48px] px-5 rounded-btn font-medium transition-colors disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
