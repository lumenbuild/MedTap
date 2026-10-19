import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-surface rounded-card shadow-card p-5 ${className}`}>{children}</section>;
}
