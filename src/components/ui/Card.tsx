import type { ReactNode } from 'react';

const TONES: [RegExp, string][] = [
  [/bg-caution-soft/, 'var(--caution)'], [/bg-danger-soft/, 'var(--danger)'], [/bg-success-soft/, 'var(--success)'], [/bg-primary-soft/, 'var(--text)'],
];

/** A section of a screen: a card (white by day, dark with a hairline edge by night). A tinted card (bg-caution-soft
 *  etc.) is a notice: the same card with a small dot in its colour. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const tone = TONES.find(([re]) => re.test(className));
  if (!tone) return <section className={`box ${className}`}>{children}</section>;
  const rest = className.replace(/(^|\s)(bg-[\w-]+|shadow-none)/g, ' ');
  return (
    <section className={`notice box relative pl-8 ${rest}`}>
      <span aria-hidden="true" className="absolute left-4 top-[25px] w-2 h-2 rounded-full" style={{ background: tone[1] }} />
      {children}
    </section>
  );
}
