import type { ReactNode } from 'react';

/** Title, one plain-English line, the chart, and the same data as a table (for screen readers, print and colour-independent reading). */
export function ChartCard({ title, summary, empty, children, table, height = 220, footer }: {
  title: string; summary?: string | null; empty?: string | null; children?: ReactNode; height?: number | null; footer?: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
}) {
  return (
    <section className="border-t border-border pt-5 pb-2 chart-card" aria-label={title}>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {empty ? (
        <p className="text-muted mt-1">{empty}</p>
      ) : (
        <>
          {summary && <p className="text-muted mt-1">{summary}</p>}
          <div className="mt-4 relative" style={height ? { height } : undefined} aria-hidden={table ? true : undefined}>{children}</div>
          {footer}
          {table && table.rows.length > 0 && (
            <details className="mt-3 chart-table">
              <summary className="min-h-[44px] flex items-center text-sm font-semibold text-primary cursor-pointer no-print">Show as table</summary>
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
