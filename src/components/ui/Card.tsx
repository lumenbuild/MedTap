import type { ReactNode } from 'react';

const TONES: [RegExp, string][] = [
  [/bg-caution-soft/, 'var(--caution)'], [/bg-danger-soft/, 'var(--danger)'], [/bg-success-soft/, 'var(--success)'], [/bg-primary-soft/, 'var(--text)'],
];

/** A section of a screen (B2): a hairline above, no box. A tinted card (bg-caution-soft etc.) is a notice: the same
 *  hairline section with a small dot in its colour instead of a coloured box. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const tone = TONES.find(([re]) => re.test(className));
  if (!tone) return <section className={`border-t border-border pt-5 pb-1 ${className}`}>{children}</section>;
  const rest = className.replace(/(^|\s)(bg-[\w-]+|shadow-none)/g, ' ');
  return (
    <section className={`notice relative border-t border-border pt-4 pb-1 pl-5 ${rest}`}>
      <span aria-hidden="true" className="absolute left-0 top-[25px] w-2 h-2 rounded-full" style={{ background: tone[1] }} />
      {children}
    </section>
  );
}
