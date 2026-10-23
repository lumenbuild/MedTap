// Small visual pieces used across screens so numbers read at a glance instead of as sentences: a mini ring, a bar,
// an icon row (one short line with a coloured icon), an action tile and a stat tile.
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Tone = 'primary' | 'good' | 'watch' | 'bad' | 'plain';
const TONE: Record<Tone, { fg: string; bg: string }> = {
  primary: { fg: 'var(--primary)', bg: 'var(--surface-2)' },
  good: { fg: 'var(--success)', bg: 'var(--success-soft)' },
  watch: { fg: 'var(--caution)', bg: 'var(--caution-soft)' },
  bad: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  plain: { fg: 'var(--text-muted)', bg: 'var(--surface-2)' },
};
export const toneColour = (t: Tone) => TONE[t].fg;

/** A small ring with the value inside (e.g. 1 of 2 doses). */
export function MiniRing({ value, max, size = 44, tone = 'primary', label, children }: { value: number; max: number; size?: number; tone?: Tone; label: string; children?: ReactNode }) {
  const stroke = 5, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span role="img" aria-label={label} className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TONE[tone].fg} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} className="ring-progress" />
      </svg>
      <span aria-hidden="true" className="absolute text-[12px] font-semibold tnum">{children ?? `${value}/${max}`}</span>
    </span>
  );
}

/** A horizontal bar: how far `value` is towards `max`, with an optional marker (e.g. a target or today). */
export function Bar({ value, max, tone = 'primary', marker, label, height = 8 }: { value: number; max: number; tone?: Tone; marker?: number; label: string; height?: number }) {
  const p = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div role="img" aria-label={label} className="relative w-full rounded-full overflow-hidden" style={{ height, background: 'var(--surface-2)' }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(p * 100, value > 0 ? 3 : 0)}%`, background: TONE[tone].fg }} />
      {marker !== undefined && max > 0 && <div aria-hidden="true" className="absolute top-0 bottom-0 w-0.5 bg-text" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />}
    </div>
  );
}

/** One line with a coloured round icon: a note, a nudge or a fact, with an optional action on the right. */
export function IconRow({ Icon, tone = 'plain', children, action, href }: { Icon: LucideIcon; tone?: Tone; children: ReactNode; action?: ReactNode; href?: string }) {
  const body = (
    <>
      <span aria-hidden="true" className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: TONE[tone].bg, color: TONE[tone].fg }}>
        <Icon size={18} />
      </span>
      <span className="flex-1 min-w-0 text-[15px] leading-snug">{children}</span>
    </>
  );
  return (
    <div className="flex items-center gap-3 min-h-[48px]">
      {href ? <a href={href} className="flex items-center gap-3 flex-1 min-w-0">{body}</a> : body}
      {action}
    </div>
  );
}

/** A square action button: big icon, short label underneath. */
export function Tile({ Icon, label, onClick, href, name }: { Icon: LucideIcon; label: string; onClick?: () => void; href?: string; name?: string }) {
  const cls = 'flex flex-col items-center justify-center gap-1.5 min-h-[76px] rounded-card bg-surface-2 text-[13px] font-medium active:scale-[0.97] transition-transform';
  const inner = <><Icon size={24} aria-hidden="true" className="text-primary" />{label}</>;
  return href ? <a href={href} aria-label={name} className={cls}>{inner}</a> : <button type="button" onClick={onClick} aria-label={name} className={cls}>{inner}</button>;
}

/** A number that matters, big, with a small label (and an optional icon or bar under it). */
export function Stat({ value, unit, label, Icon, tone = 'plain', children }: { value: ReactNode; unit?: string; label: string; Icon?: LucideIcon; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="rounded-card bg-surface-2 p-3 min-w-0">
      <p className="text-[12px] text-muted flex items-center gap-1.5">{Icon && <Icon size={14} aria-hidden="true" style={{ color: TONE[tone].fg }} />}{label}</p>
      <p className="mt-0.5"><span className="text-[24px] font-semibold tnum leading-none">{value}</span>{unit && <span className="text-sm text-muted ml-1">{unit}</span>}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
