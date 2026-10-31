import { AlertTriangle } from 'lucide-react';
import type { Medication, SyringeType } from '../db/schema';
import { blendAmounts, doseGuide, drawWarnings, fmtMl, fmtUnits, unitsPerMl, type Draw, type DrawWarning } from '../logic/peptide';
import { fmtAmount } from '../logic/format';

export const WARN_TEXT: Record<DrawWarning, string> = {
  'too-small': 'Under 2 units is hard to measure accurately. More water in the vial makes each dose bigger to draw.',
  'too-big': "More than this syringe holds.",
  'not-exact': "This isn't on a half-unit mark, so round to the nearest mark you can read.",
};

/** An insulin syringe drawn to `units`: needle at the 0 end, the dose between the needle and the plunger's stopper,
 *  the plunger rod out the far end. Marks every unit (long marks every 5 and 10). */
export function SyringeGauge({ units, capacity, onHero = false }: { units: number; capacity: number; onHero?: boolean }) {
  // On a coloured hero card, everything is drawn in the card's ink.
  const c = onHero
    ? { line: 'var(--hero-muted)', part: 'color-mix(in srgb, var(--hero-ink) 35%, transparent)', barrel: 'color-mix(in srgb, var(--hero-ink) 12%, transparent)', edge: 'color-mix(in srgb, var(--hero-ink) 55%, transparent)', dose: 'var(--hero-ink)', mark: 'var(--hero-ink)', label: 'var(--hero-muted)' }
    : { line: 'var(--text-muted)', part: 'var(--border)', barrel: 'var(--fill)', edge: 'var(--border)', dose: 'var(--primary)', mark: 'var(--text)', label: 'var(--text-muted)' };
  const W = 320, H = 48, x0 = 34, x1 = 262, top = 8, bot = 30, mid = (top + bot) / 2;
  const u = Math.max(0, Math.min(units, capacity));
  const at = (v: number) => x0 + ((x1 - x0) * v) / capacity;
  const stop = at(u);
  const every = capacity > 50 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(capacity / every) + 1 }, (_, i) => i * every);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Syringe drawn to ${fmtUnits(units)} of ${capacity}`}>
      {/* needle and hub */}
      <line x1={2} x2={24} y1={mid} y2={mid} stroke={c.line} strokeWidth={1.5} strokeLinecap="round" />
      <rect x={24} y={mid - 5} width={x0 - 24} height={10} rx={2} fill={c.part} />
      {/* barrel, with the dose from the needle end up to the stopper */}
      <rect x={x0} y={top} width={x1 - x0} height={bot - top} rx={3} fill={c.barrel} stroke={c.edge} />
      <rect x={x0} y={top} width={stop - x0} height={bot - top} fill={c.dose} opacity={0.35} />
      {ticks.map((v) => (
        <line key={v} x1={at(v)} x2={at(v)} y1={bot} y2={v % 10 === 0 ? top + 10 : v % 5 === 0 ? top + 14 : top + 18} stroke={c.mark} strokeWidth={v % 10 === 0 ? 1.2 : 0.6} />
      ))}
      {ticks.filter((v) => v % 10 === 0).map((v) => (
        <text key={v} x={at(v)} y={H - 4} textAnchor="middle" fontSize={8} fill={c.label}>{v}</text>
      ))}
      {/* finger flange, plunger rod, thumb rest */}
      <rect x={x1} y={2} width={4} height={H - 16} rx={1} fill={c.part} />
      <line x1={stop} x2={W - 10} y1={mid} y2={mid} stroke={c.line} strokeWidth={3} />
      <rect x={W - 10} y={top - 2} width={5} height={bot - top + 4} rx={1.5} fill={c.line} />
      {/* the stopper's front edge is what lines up with the mark */}
      <rect x={stop} y={top + 1} width={7} height={bot - top - 2} rx={1.5} fill={c.mark} />
      <line x1={stop} x2={stop} y1={top - 4} y2={bot + 1} stroke={c.dose} strokeWidth={2} />
    </svg>
  );
}

/** "Draw to 10 units (0.1 mL)" with the syringe and anything worth double-checking. */
export function DrawResult({ draw, capacity, syringe }: { draw: Draw; capacity: number; syringe: SyringeType }) {
  const warnings = drawWarnings(draw, capacity);
  return (
    <div className="space-y-2" aria-live="polite">
      <p><span className="text-2xl font-semibold tnum">{fmtUnits(draw.units)}</span> <span className="text-muted tnum">· {fmtMl(draw.ml)} on a {syringe} syringe</span></p>
      <SyringeGauge units={draw.units} capacity={capacity} />
      {warnings.map((w) => (
        <p key={w} className="text-sm rounded-btn bg-caution-soft p-2.5 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" /> {WARN_TEXT[w]}</p>
      ))}
    </div>
  );
}

/** For a vial or pen medication: what to draw (from the vial in use) or dial for this amount. */
export function DrawGuide({ med, amount }: { med: Pick<Medication, 'id' | 'strength' | 'unit' | 'peptide' | 'vials' | 'defaultAmount' | 'name'>; amount: number }) {
  const g = doseGuide(med, amount);
  if (!g) return null;
  const parts = blendAmounts(med, amount).slice(1);
  if (g.kind === 'pen') {
    return (
      <div className="rounded-btn bg-primary-soft p-3 space-y-1" aria-live="polite">
        <p className="text-sm font-medium">On the pen</p>
        <p className="text-2xl font-semibold tnum">{g.clicks !== undefined ? `${g.clicks} click${g.clicks === 1 ? '' : 's'}` : `Set to ${fmtAmount(amount, med.unit)}`}</p>
        {g.clicks !== undefined && !Number.isInteger(g.clicks) && <p className="text-sm">Not a whole click.</p>}
      </div>
    );
  }
  return (
    <div className="rounded-btn bg-primary-soft p-3 space-y-1">
      <p className="text-sm font-medium">Draw to</p>
      <DrawResult draw={g.draw} capacity={g.capacity} syringe={g.syringe} />
      {parts.length > 0 && <p className="text-sm tnum">Also in this dose: {parts.map((b) => fmtAmount(b.amount, b.unit) + ' ' + b.name).join(', ')}</p>}
      <p className="text-xs text-muted">From {fmtAmount(g.amount, med.unit)} mixed with {g.waterMl} mL.</p>
    </div>
  );
}

/** Syringe sizes in mL and their capacity in units for a syringe type. */
export const syringeSizes = (s: SyringeType) => [0.3, 0.5, 1].map((ml) => ({ ml, units: Math.round(ml * unitsPerMl(s)) }));
