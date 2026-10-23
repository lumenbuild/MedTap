// Small visual pieces used across screens so numbers read at a glance instead of as sentences: a mini ring, a bar,
// an icon row (one short line with a coloured icon), an action tile, a stat tile, a sparkline, side-by-side bars, a
// shaded table and bars around zero.
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

/** A small line of recent values (no axes): the shape at a glance. An optional dashed step shows a level before and
 *  after a moment (e.g. where something changed), and the latest value gets a dot. */
export function Sparkline({ points, label, height = 36, step, tone = 'plain' }: {
  points: { t: number; v: number }[]; label: string; height?: number; tone?: Tone;
  step?: { at: number; before: number; after: number };
}) {
  if (points.length < 2) return null;
  const W = 300, H = height, pad = 4;
  const ts = points.map((p) => p.t), vs = [...points.map((p) => p.v), ...(step ? [step.before, step.after] : [])];
  const t0 = Math.min(...ts), t1 = Math.max(...ts), lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: H }}>
      {step && <path d={`M${pad},${y(step.before)}H${x(step.at)}V${y(step.after)}H${W - pad}`} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke={tone === 'plain' ? 'var(--text)' : TONE[tone].fg} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.t)} cy={y(last.v)} r="3" fill={tone === 'plain' ? 'var(--text)' : TONE[tone].fg} />
    </svg>
  );
}

/** Two things side by side for each measure (e.g. nights with caffeine against nights without): a dark bar and a
 *  light bar on the measure's own scale, with the values written at the ends. */
export function CompareBars({ a, b, rows }: { a: string; b: string; rows: { label: string; a: number | null; b: number | null; fmt: (v: number) => string }[] }) {
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 text-[13px]" aria-hidden="true">
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-text" />{a}</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px]" style={{ background: 'var(--border-strong)' }} />{b}</li>
      </ul>
      {rows.map((r) => {
        const max = Math.max(Math.abs(r.a ?? 0), Math.abs(r.b ?? 0)) || 1;
        const bar = (v: number | null, bg: string, who: string) => (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3"><div className="h-3 rounded-[3px]" style={{ width: v === null ? 0 : `${Math.max(2, (Math.abs(v) / max) * 100)}%`, background: bg }} /></div>
            <span className="text-sm tnum w-[64px] text-right shrink-0" aria-label={`${who}: ${v === null ? 'none' : r.fmt(v)}`}>{v === null ? '–' : r.fmt(v)}</span>
          </div>
        );
        return (
          <div key={r.label} role="group" aria-label={r.label}>
            <p className="text-sm text-muted mb-1">{r.label}</p>
            {bar(r.a, 'var(--text)', a)}
            <div className="h-1" />
            {bar(r.b, 'var(--border-strong)', b)}
          </div>
        );
      })}
    </div>
  );
}

/** A table of numbers whose cells are shaded by size (one hue, light to dark, each row on its own scale), with the
 *  number in each cell: patterns jump out and the values stay readable. */
export function HeatTable({ columns, rows, highlight }: {
  columns: string[]; highlight?: number;
  rows: { label: string; values: (number | null)[]; fmt?: (v: number) => string; text?: (string | null)[] }[];
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full table-fixed text-[13px] tnum border-separate" style={{ borderSpacing: 3 }}>
        <thead><tr><th className="text-left font-normal text-muted w-[84px]"><span className="sr-only">Measure</span></th>{columns.map((c, i) => <th key={i} className={`font-${i === highlight ? 'semibold' : 'normal'} text-muted text-center pb-1`}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const vs = r.values.filter((v): v is number => v !== null);
            const lo = Math.min(...vs), hi = Math.max(...vs);
            return (
              <tr key={r.label}>
                <th scope="row" className="text-left font-normal text-muted pr-1 truncate">{r.label}</th>
                {r.values.map((v, i) => {
                  // Capped so the ink text keeps its contrast on the darkest cell, in light and dark mode.
                  const k = v === null || hi === lo ? 0.2 : 0.08 + 0.54 * ((v - lo) / (hi - lo));
                  const pct = Math.round(k * 100);
                  return (
                    <td key={i} className="text-center rounded-[6px] h-9 px-0"
                      style={{ background: v === null ? 'transparent' : `color-mix(in srgb, var(--med-1) ${pct}%, var(--surface))`, color: 'var(--text)' }}>
                      {r.text?.[i] ?? (v === null ? '–' : (r.fmt ?? ((x: number) => String(Math.round(x * 10) / 10)))(v))}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Values either side of zero as small columns (e.g. strength against your usual on each day after a shot), each with
 *  its label underneath and its value on top. */
export function ZeroBars({ items, fmt, height = 56 }: { items: { label: string; v: number | null; strong?: boolean }[]; fmt: (v: number) => string; height?: number }) {
  const max = Math.max(...items.map((i) => Math.abs(i.v ?? 0))) || 1;
  const half = height / 2;
  return (
    <div className="flex items-stretch gap-1" role="img" aria-label={items.map((i) => `${i.label}: ${i.v === null ? 'no data' : fmt(i.v)}`).join(', ')}>
      {items.map((i) => {
        const h = i.v === null ? 0 : Math.max(2, (Math.abs(i.v) / max) * (half - 2));
        return (
          <div key={i.label} className="flex-1 flex flex-col items-center min-w-0" aria-hidden="true">
            <span className={`text-[12px] tnum ${i.strong ? 'font-semibold' : 'text-muted'}`}>{i.v === null ? '–' : fmt(i.v)}</span>
            <div className="relative w-full" style={{ height }}>
              <div className="absolute left-0 right-0 border-t border-border" style={{ top: half }} />
              {i.v !== null && <div className="absolute left-1/2 -translate-x-1/2 w-[60%] max-w-[26px] rounded-[3px]"
                style={{ height: h, top: i.v >= 0 ? half - h : half, background: i.v >= 0 ? 'var(--text)' : 'var(--border-strong)' }} />}
            </div>
            <span className={`text-[12px] ${i.strong ? 'font-semibold' : 'text-muted'}`}>{i.label}</span>
          </div>
        );
      })}
    </div>
  );
}
