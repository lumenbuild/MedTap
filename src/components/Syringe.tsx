import { AlertTriangle } from 'lucide-react';
import type { Medication, SyringeType } from '../db/schema';
import { drawFor, drawWarnings, fmtMl, fmtUnits, unitsPerMl, type Draw, type DrawWarning } from '../logic/peptide';

const WARN_TEXT: Record<DrawWarning, string> = {
  'too-small': 'Under 2 units is hard to measure accurately. More water in the vial makes each dose bigger to draw.',
  'too-big': "That's more than this syringe holds. Use a bigger syringe or split the dose, as your prescriber or pharmacist advises.",
  'not-exact': "This isn't on a half-unit mark, so round to the nearest mark you can read.",
};

/** A syringe barrel filled to `units`, with marks every unit (long marks every 5 and 10). */
export function SyringeGauge({ units, capacity }: { units: number; capacity: number }) {
  const W = 300, H = 44, x0 = 14, x1 = W - 34;
  const frac = Math.max(0, Math.min(1, units / capacity));
  const at = (u: number) => x0 + ((x1 - x0) * u) / capacity;
  const every = capacity > 50 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(capacity / every) + 1 }, (_, i) => i * every);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Syringe filled to ${fmtUnits(units)} of ${capacity}`}>
      <rect x={x0} y={8} width={x1 - x0} height={22} rx={4} fill="var(--surface-2)" stroke="var(--border)" />
      <rect x={x0} y={8} width={(x1 - x0) * frac} height={22} rx={4} fill="var(--primary)" opacity={0.35} />
      <line x1={at(Math.min(units, capacity))} x2={at(Math.min(units, capacity))} y1={4} y2={34} stroke="var(--primary)" strokeWidth={2.5} />
      {ticks.map((u) => (
        <line key={u} x1={at(u)} x2={at(u)} y1={30} y2={u % 10 === 0 ? 18 : u % 5 === 0 ? 22 : 26} stroke="var(--text)" strokeWidth={u % 10 === 0 ? 1.2 : 0.6} />
      ))}
      {ticks.filter((u) => u % 10 === 0).map((u) => (
        <text key={u} x={at(u)} y={43} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{u}</text>
      ))}
      <rect x={x1} y={14} width={8} height={10} fill="var(--border)" />
      <line x1={x1 + 8} x2={W - 4} y1={19} y2={19} stroke="var(--text-muted)" strokeWidth={1.5} />
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

/** For a mixed-vial medication: how much to draw for this amount. */
export function DrawGuide({ med, amount }: { med: Pick<Medication, 'strength' | 'unit' | 'peptide'>; amount: number }) {
  const p = med.peptide;
  if (!p || !(med.strength > 0) || !(p.waterMl > 0) || !(amount > 0)) return null;
  return (
    <div className="rounded-btn bg-primary-soft p-3 space-y-1">
      <p className="text-sm font-medium">Draw to</p>
      <DrawResult draw={drawFor(amount, med.strength, p.waterMl, p.syringe)} capacity={p.syringeUnits} syringe={p.syringe} />
      <p className="text-xs text-muted">From {med.strength} {med.unit} mixed with {p.waterMl} mL. Check against your own working or your pharmacist's.</p>
    </div>
  );
}

/** Syringe sizes in mL and their capacity in units for a syringe type. */
export const syringeSizes = (s: SyringeType) => [0.3, 0.5, 1].map((ml) => ({ ml, units: Math.round(ml * unitsPerMl(s)) }));
