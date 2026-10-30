import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Table2 } from 'lucide-react';

/** The number a chart is about, big, with how it moved (in words, never colour alone). */
export interface Headline { value: string; unit?: string; delta?: string; dir?: 'up' | 'down' | 'flat'; tone?: 'good' | 'watch' | 'plain';
  /** A line under it, e.g. what the number is ("Last weigh-in, Fri 30 Oct · 7-day average 117.2 kg"). */
  note?: string }

export function HeadlineStat({ h }: { h: Headline }) {
  const Arrow = h.dir === 'up' ? ArrowUpRight : h.dir === 'down' ? ArrowDownRight : ArrowRight;
  const colour = h.tone === 'good' ? 'var(--success)' : h.tone === 'watch' ? 'var(--caution)' : 'var(--text-muted)';
  return (
    <div>
      <p className="flex items-baseline flex-wrap gap-x-2 tnum">
        <span className="text-[28px] font-semibold leading-tight">{h.value}</span>
        {h.unit && <span className="text-[15px] text-muted -ml-1">{h.unit}</span>}
        {h.delta && (
          <span className="inline-flex items-center gap-0.5 text-[15px] font-medium" style={{ color: colour }}>
            {h.dir && <Arrow size={16} aria-hidden="true" className="self-center" />}{h.delta}
          </span>
        )}
      </p>
      {h.note && <p className="text-sm text-muted tnum">{h.note}</p>}
    </div>
  );
}

/** A key for a chart's marks, as text beside a swatch drawn the way the mark is (solid, dashed, dotted, dot, band). */
export interface LegendItem { label: string; colour: string; kind: 'line' | 'dashed' | 'dotted' | 'dot' | 'band' }
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-hidden="true">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="10" className="shrink-0">
            {i.kind === 'dot' && <circle cx="9" cy="5" r="4" fill={i.colour} />}
            {i.kind === 'band' && <rect x="0" y="0" width="18" height="10" rx="2" fill={i.colour} />}
            {(i.kind === 'line' || i.kind === 'dashed' || i.kind === 'dotted') && (
              <line x1="1" y1="5" x2="17" y2="5" stroke={i.colour} strokeWidth={i.kind === 'dotted' ? 2 : 3} strokeLinecap="round"
                strokeDasharray={i.kind === 'dashed' ? '5 3' : i.kind === 'dotted' ? '0.5 4' : undefined} />
            )}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Title, the headline number, one plain-English line, the chart, and the same data as a table (for screen readers,
 *  print and colour-independent reading). */
export function ChartCard({ title, summary, empty, children, table, height = 220, footer, headline, legend, controls, actions }: {
  title: string; summary?: string | null; empty?: string | null; children?: ReactNode; height?: number | null; footer?: ReactNode;
  /** Under the title, shown even when there's nothing to chart (a picker). */
  controls?: ReactNode;
  /** Buttons under the chart (or the empty message), before the table: log a reading, add one. */
  actions?: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] }; headline?: Headline | null; legend?: LegendItem[];
}) {
  return (
    <section className="border-t border-border pt-5 pb-2 chart-card" aria-label={title}>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {controls && <div className="mt-2">{controls}</div>}
      {empty ? (
        <>
          <p className="text-muted mt-1">{empty}</p>
          {actions && <div className="mt-3">{actions}</div>}
        </>
      ) : (
        <>
          {headline && <div className="mt-1"><HeadlineStat h={headline} /></div>}
          {summary && <p className="text-muted text-[15px] mt-1">{summary}</p>}
          {legend && legend.length > 1 && <div className="mt-3"><ChartLegend items={legend} /></div>}
          <div className="mt-3 relative" style={height ? { height } : undefined} aria-hidden={table ? true : undefined}>{children}</div>
          {footer}
          {actions && <div className="mt-3">{actions}</div>}
          {table && table.rows.length > 0 && (
            <details className="mt-3 chart-table">
              <summary className="min-h-[44px] inline-flex items-center gap-1.5 text-sm text-muted cursor-pointer no-print"><Table2 size={16} aria-hidden="true" />Table</summary>
              <div className="overflow-x-auto" tabIndex={0}>
                <table className="w-full text-sm tnum mt-2">
                  <thead><tr>{table.head.map((h) => <th key={h} className="text-left font-semibold py-1.5 pr-3 border-b border-border">{h}</th>)}</tr></thead>
                  <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="py-1.5 pr-3 border-b border-border">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
