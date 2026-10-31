// How much a long-acting peptide's level falls between shots: once a week against split into two (or the reverse),
// as two bars from peak (full) down to the lowest point before the next shot.
import type { SplitView } from '../logic/peptideGuide';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const label = (n: number) => (n === 1 ? 'Once a week' : n === 2 ? 'Twice a week' : `${n} times a week`);

export function SwingBars({ view, yours = false }: { view: SplitView; yours?: boolean }) {
  const rows = [{ perWeek: view.perWeek, swing: view.swing, mine: yours }, { perWeek: view.other.perWeek, swing: view.other.swing, mine: false }].sort((a, b) => a.perWeek - b.perWeek);
  return (
    <ul className="mt-3 space-y-2.5 tnum" aria-label="How far the level drops before the next shot">
      {rows.map((r) => (
        <li key={r.perWeek}>
          <div className="flex justify-between text-sm"><span>{label(r.perWeek)}{r.mine ? <span className="text-muted"> (yours)</span> : ''}</span><span className="font-semibold">drops {pct(r.swing)}</span></div>
          <div className="mt-1 h-2.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
            {/* The part of the peak still there at the low point, then the drop. */}
            <div className="h-full rounded-full" style={{ width: `${(1 - r.swing) * 100}%`, background: r.perWeek > 1 ? 'var(--success)' : 'var(--primary)' }} />
          </div>
        </li>
      ))}
      <li className="text-[13px] text-muted">The bar is what’s left at the lowest point, just before the next shot, as a share of the peak.</li>
    </ul>
  );
}
