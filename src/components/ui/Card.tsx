import type { ReactNode } from 'react';

/** Surface card. Pass a bg-* class to tint it (the default surface is only applied when none is given). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const bg = /(^|\s)bg-/.test(className) ? '' : 'bg-surface';
  return <section className={`${bg} rounded-card shadow-card p-5 ${className}`}>{children}</section>;
}
