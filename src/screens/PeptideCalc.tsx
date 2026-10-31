import { useState } from 'react';
import { AlertTriangle, Minus, Plus, Syringe as SyringeIcon } from 'lucide-react';
import type { Medication, SyringeType } from '../db/schema';
import { concentration, convert, doseForUnits, drawFor, drawWarnings, fmtMl, SYRINGES, unitsPerMl, waterForUnits } from '../logic/peptide';
import { useFamily, useMeds } from '../app/data';
import { medIsFor } from '../db/repos/people';
import { shownName } from '../logic/privacy';
import { SyringeGauge, syringeSizes, WARN_TEXT } from '../components/Syringe';
import { Segmented } from '../components/ui/Field';

type Unit = 'mg' | 'mcg';
type Mode = 'draw' | 'dose' | 'water';
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const r = (n: number, dp = 3) => (Number.isFinite(n) ? String(Math.round(n * 10 ** dp) / 10 ** dp) : '–');

/** Numbers handed over from a guide's mixing table (once). */
function preset(): { vialMg: number; waterMl: number; dose: number; doseUnit: string } | null {
  try { const s = sessionStorage.getItem('calcPreset'); sessionStorage.removeItem('calcPreset'); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** A step that suits the size of the number: small doses move in small steps. */
function step(v: number, unit: Unit | 'mL' | 'units'): number {
  if (unit === 'mL') return 0.5;
  if (unit === 'units') return v < 10 ? 1 : 5;
  if (unit === 'mcg') return v < 500 ? 25 : v < 2000 ? 100 : 500;
  return v < 1 ? 0.05 : v < 5 ? 0.25 : v < 20 ? 1 : 5;
}

/** One number with − and +, typed or stepped. Tapping the unit swaps mg and mcg where that applies. */
function Stepper({ label, value, unit, onChange, onUnit, active = false }: { label: string; value: string; unit: string; onChange: (v: string) => void; onUnit?: () => void; active?: boolean }) {
  const v = num(value);
  const bump = (dir: 1 | -1) => {
    const st = step(Number.isFinite(v) ? v : 0, unit as Unit);
    const next = Math.max(0, Math.round(((Number.isFinite(v) ? v : 0) + dir * st) * 1000) / 1000);
    onChange(String(next));
  };
  return (
    <div className={`box p-3 ${active ? 'ring-2 ring-[var(--c-pep)]' : ''}`}>
      <label className="block">
        <span className="text-[15px] text-muted">{label}</span>
        <span className="flex items-baseline gap-1 mt-1">
          <input type="number" inputMode="decimal" min="0" step="any" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} (${unit})`}
            className="w-full min-w-0 bg-transparent text-[28px] leading-8 font-bold tnum tracking-[-0.02em] outline-none" />
        </span>
      </label>
      <span className="flex items-center justify-between">
        {onUnit
          ? <button type="button" onClick={onUnit} className="text-[15px] text-muted underline decoration-dotted underline-offset-4 min-h-[32px]" aria-label={`${label} unit: ${unit}. Change`}>{unit}</button>
          : <span className="text-[15px] text-muted min-h-[32px] inline-flex items-center">{unit}</span>}
      </span>
      <span className="grid grid-cols-2 gap-1.5 mt-1">
        <button type="button" onClick={() => bump(-1)} aria-label={`Less ${label.toLowerCase()}`} className="h-10 rounded-btn flex items-center justify-center" style={{ background: 'var(--fill)' }}><Minus size={18} aria-hidden="true" /></button>
        <button type="button" onClick={() => bump(1)} aria-label={`More ${label.toLowerCase()}`} className="h-10 rounded-btn flex items-center justify-center" style={{ background: 'var(--fill)' }}><Plus size={18} aria-hidden="true" /></button>
      </span>
    </div>
  );
}

/** Reconstitution calculator: vial + water + dose → syringe units, the reverse, and the water for an easy draw.
 *  Your own peptides are one tap away. Uses only the numbers entered. */
export function PeptideCalc() {
  const meds = useMeds(); const fam = useFamily();
  const [p] = useState(preset);
  const [vial, setVial] = useState(p ? String(p.vialMg) : '10');
  const [vialUnit, setVialUnit] = useState<Unit>('mg');
  const [water, setWater] = useState(p ? String(p.waterMl) : '1');
  const [dose, setDose] = useState(p ? String(p.dose) : '2');
  const [doseUnit, setDoseUnit] = useState<Unit>(p && (p.doseUnit === 'mg' || p.doseUnit === 'mcg') ? p.doseUnit : 'mg');
  const [syringe, setSyringe] = useState<SyringeType>('U-100');
  const [sizeMl, setSizeMl] = useState('0.5');
  const [units, setUnits] = useState('20');
  const [target, setTarget] = useState('20');
  const [mode, setMode] = useState<Mode>('draw');
  const [picked, setPicked] = useState<string>('custom');

  const mine = (meds ?? []).filter((m) => !m.archived && m.peptide?.kind === 'vial' && m.strength > 0 && (!fam || medIsFor(m, fam.personId))).slice(0, 4);
  const pick = (m: Medication) => {
    setPicked(m.id);
    const u: Unit = m.unit === 'mcg' ? 'mcg' : 'mg';
    setVial(String(m.strength)); setVialUnit(u);
    if (m.peptide?.waterMl) setWater(String(m.peptide.waterMl));
    setDose(String(m.defaultAmount)); setDoseUnit(u);
    if (m.peptide?.syringe) setSyringe(m.peptide.syringe);
  };

  const sizes = syringeSizes(syringe);
  const capacity = sizes.find((x) => String(x.ml) === sizeMl)?.units ?? sizes[sizes.length - 1].units;
  const vialIn = convert(num(vial), vialUnit, doseUnit) ?? NaN; // the vial in the dose's unit
  const ok = num(vial) > 0 && num(water) > 0;
  const conc = ok ? concentration(vialIn, num(water)) : NaN;
  const draw = ok && num(dose) > 0 ? drawFor(num(dose), vialIn, num(water), syringe) : null;
  const perVial = draw ? Math.floor(vialIn / num(dose) + 1e-9) : NaN;
  const fromUnits = ok && num(units) > 0 ? doseForUnits(num(units), vialIn, num(water), syringe) : NaN;
  const waterNeeded = ok && num(dose) > 0 && num(target) > 0 ? waterForUnits(num(dose), vialIn, num(target), syringe) : NaN;
  const swap = (u: Unit) => (u === 'mg' ? 'mcg' : 'mg');
  const warnings = draw ? drawWarnings(draw, capacity) : [];
  const shownUnits = mode === 'dose' ? num(units) : mode === 'water' ? num(target) : draw?.units ?? 0;

  return (
    <div className="space-y-3 pb-8">
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Fill in from">
        {mine.map((m) => (
          <button key={m.id} type="button" aria-pressed={picked === m.id} onClick={() => pick(m)}
            className={`shrink-0 min-h-[44px] px-4 rounded-full font-semibold inline-flex items-center gap-1.5 ${picked === m.id ? 'bg-primary text-on-primary' : ''}`} style={picked === m.id ? undefined : { background: 'var(--fill)' }}>
            {picked === m.id && <SyringeIcon size={16} aria-hidden="true" />}{shownName(m)}
          </button>
        ))}
        <button type="button" aria-pressed={picked === 'custom'} onClick={() => setPicked('custom')}
          className={`shrink-0 min-h-[44px] px-4 rounded-full font-semibold ${picked === 'custom' ? 'bg-primary text-on-primary' : ''}`} style={picked === 'custom' ? undefined : { background: 'var(--fill)' }}>Custom</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stepper label="Vial" value={vial} unit={vialUnit} onChange={(v) => { setVial(v); setPicked('custom'); }} onUnit={() => setVialUnit(swap(vialUnit))} />
        <Stepper label="Water" value={water} unit="mL" onChange={(v) => { setWater(v); setPicked('custom'); }} active={mode === 'water'} />
        {mode === 'dose'
          ? <Stepper label="Units" value={units} unit="units" onChange={setUnits} active />
          : mode === 'water'
            ? <Stepper label="Units" value={target} unit="units" onChange={setTarget} />
            : <Stepper label="Dose" value={dose} unit={doseUnit} onChange={(v) => { setDose(v); setPicked('custom'); }} onUnit={() => setDoseUnit(swap(doseUnit))} active />}
      </div>
      {mode === 'water' && (
        <div className="grid grid-cols-3 gap-2"><div className="col-start-3"><Stepper label="Dose" value={dose} unit={doseUnit} onChange={setDose} onUnit={() => setDoseUnit(swap(doseUnit))} /></div></div>
      )}

      <section className="hero pep" aria-live="polite" aria-label="Result">
        {mode === 'draw' && <>
          <p className="hero-label">Draw to</p>
          <p className="mt-1 tnum"><span className="text-[64px] leading-[64px] font-bold tracking-[-0.03em]">{draw ? r(draw.units, 1) : '–'}</span><span className="text-[24px] font-semibold ml-2 text-muted">units</span></p>
        </>}
        {mode === 'dose' && <>
          <p className="hero-label">That’s a dose of</p>
          <p className="mt-1 tnum"><span className="text-[52px] leading-[56px] font-bold tracking-[-0.03em]">{r(fromUnits)}</span><span className="text-[24px] font-semibold ml-2 text-muted">{doseUnit}</span></p>
        </>}
        {mode === 'water' && <>
          <p className="hero-label">Add</p>
          <p className="mt-1 tnum"><span className="text-[52px] leading-[56px] font-bold tracking-[-0.03em]">{r(waterNeeded, 2)}</span><span className="text-[24px] font-semibold ml-2 text-muted">mL of water</span></p>
          <p className="text-muted text-[15px]">so {r(num(dose))} {doseUnit} is {r(num(target), 1)} units</p>
        </>}
        <div className="mt-3"><SyringeGauge units={Number.isFinite(shownUnits) ? shownUnits : 0} capacity={capacity} onHero /></div>
        <dl className="mt-3 pt-3 grid grid-cols-3 gap-2 tnum" style={{ borderTop: '1px solid color-mix(in srgb, var(--hero-ink) 22%, transparent)' }}>
          <div><dd className="text-[19px] font-bold">{mode === 'draw' && draw ? fmtMl(draw.ml) : mode === 'dose' && num(units) > 0 ? fmtMl(num(units) / unitsPerMl(syringe)) : mode === 'water' && num(target) > 0 ? fmtMl(num(target) / unitsPerMl(syringe)) : '–'}</dd><dt className="text-[13px] text-muted">volume</dt></div>
          <div><dd className="text-[19px] font-bold">{Number.isFinite(perVial) ? perVial : '–'}</dd><dt className="text-[13px] text-muted">doses / vial</dt></div>
          <div><dd className="text-[19px] font-bold">{ok ? `${r(conc, 2)} ${doseUnit}/mL` : '–'}</dd><dt className="text-[13px] text-muted">strength</dt></div>
        </dl>
      </section>

      {mode === 'draw' && warnings.map((w) => (
        <p key={w} className="text-sm rounded-btn bg-caution-soft p-3 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{WARN_TEXT[w]}</p>
      ))}

      <Segmented<Mode> label="Work out" value={mode} onChange={setMode} options={[{ value: 'draw', label: 'Dose → units' }, { value: 'dose', label: 'Units → dose' }, { value: 'water', label: 'Water' }]} />

      <div className="box flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[15px] text-muted">Syringe</span>
        <span className="flex gap-1.5" role="group" aria-label="Syringe type">
          {SYRINGES.map((x) => <button key={x.value} type="button" aria-pressed={syringe === x.value} onClick={() => setSyringe(x.value)}
            className={`min-h-[36px] px-3 rounded-full text-sm font-medium ${syringe === x.value ? 'bg-primary text-on-primary' : ''}`} style={syringe === x.value ? undefined : { background: 'var(--fill)' }}>{x.value}</button>)}
        </span>
        <span className="flex gap-1.5" role="group" aria-label="Syringe size">
          {sizes.map((x) => <button key={x.ml} type="button" aria-pressed={sizeMl === String(x.ml)} onClick={() => setSizeMl(String(x.ml))}
            className={`min-h-[36px] px-3 rounded-full text-sm font-medium ${sizeMl === String(x.ml) ? 'bg-primary text-on-primary' : ''}`} style={sizeMl === String(x.ml) ? undefined : { background: 'var(--fill)' }}>{x.ml} mL</button>)}
        </span>
      </div>
    </div>
  );
}
