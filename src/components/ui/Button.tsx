import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface-2 text-text hover:bg-border',
  danger: 'bg-danger-soft text-danger',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`min-h-[48px] px-5 rounded-btn font-semibold transition-colors disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
