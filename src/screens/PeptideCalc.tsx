import { useState } from 'react';
import type { SyringeType } from '../db/schema';
import { concentration, convert, doseForUnits, drawFor, fmtMl, SYRINGES, unitsPerMl, waterForUnits } from '../logic/peptide';
import { Card } from '../components/ui/Card';
import { Select, TextInput } from '../components/ui/Field';
import { DrawResult, syringeSizes } from '../components/Syringe';

const AMOUNT_UNITS = ['mg', 'mcg'] as const;
type AmountUnit = (typeof AMOUNT_UNITS)[number];
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const fmt = (n: number, dp = 3) => (Number.isFinite(n) ? String(Math.round(n * 10 ** dp) / 10 ** dp) : '–');

/** Reconstitution calculator: vial + water + dose → syringe units, and the reverse. Uses only the person's numbers. */
export function PeptideCalc() {
  const [vial, setVial] = useState('5');
  const [vialUnit, setVialUnit] = useState<AmountUnit>('mg');
  const [water, setWater] = useState('2');
  const [dose, setDose] = useState('250');
  const [doseUnit, setDoseUnit] = useState<AmountUnit>('mcg');
  const [syringe, setSyringe] = useState<SyringeType>('U-100');
  const [sizeMl, setSizeMl] = useState('0.3');
  const [units, setUnits] = useState('10');
  const [target, setTarget] = useState('10');

  const sizes = syringeSizes(syringe);
  const capacity = sizes.find((x) => String(x.ml) === sizeMl)?.units ?? sizes[0].units;
  // Work in the dose's unit throughout.
  const vialInDoseUnit = convert(num(vial), vialUnit, doseUnit) ?? NaN;
  const ok = num(vial) > 0 && num(water) > 0;
  const doseOk = ok && num(dose) > 0;
  const draw = doseOk ? drawFor(num(dose), vialInDoseUnit, num(water), syringe) : null;
  const conc = ok ? concentration(vialInDoseUnit, num(water)) : NaN;
  const perVial = doseOk ? Math.floor(vialInDoseUnit / num(dose) + 1e-9) : NaN;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Your vial</h2>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          <TextInput label="Amount in the vial" type="number" inputMode="decimal" min="0" step="any" value={vial} onChange={(e) => setVial(e.target.value)} />
          <Select label="Unit" value={vialUnit} onChange={(e) => setVialUnit(e.target.value as AmountUnit)}>{AMOUNT_UNITS.map((u) => <option key={u}>{u}</option>)}</Select>
        </div>
        <TextInput label="Water added (mL)" help="Bacteriostatic or sterile water, as directed." type="number" inputMode="decimal" min="0" step="any" value={water} onChange={(e) => setWater(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Syringe" value={syringe} onChange={(e) => setSyringe(e.target.value as SyringeType)}>{SYRINGES.map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}</Select>
          <Select label="Size" value={sizeMl} onChange={(e) => setSizeMl(e.target.value)}>{sizes.map((x) => <option key={x.ml} value={String(x.ml)}>{x.ml} mL ({x.units} units)</option>)}</Select>
        </div>
        {ok && <p className="text-sm text-muted tnum">Mixed: {fmt(conc)} {doseUnit} per mL · {fmt(conc / unitsPerMl(syringe), 4)} {doseUnit} per unit</p>}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">How much to draw</h2>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          <TextInput label="Dose" type="number" inputMode="decimal" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} />
          <Select label="Unit" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as AmountUnit)}>{AMOUNT_UNITS.map((u) => <option key={u}>{u}</option>)}</Select>
        </div>
        {draw ? <DrawResult draw={draw} capacity={capacity} syringe={syringe} /> : <p className="text-muted">Enter the vial amount, water and dose.</p>}
        {Number.isFinite(perVial) && <p className="text-sm text-muted tnum">About {perVial} dose{perVial === 1 ? '' : 's'} per vial.</p>}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Units to dose</h2>
        <TextInput label="Units on the syringe" type="number" inputMode="decimal" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)} />
        <p className="tnum" aria-live="polite">{ok && num(units) > 0 ? <><strong>{fmt(doseForUnits(num(units), vialInDoseUnit, num(water), syringe))} {doseUnit}</strong> <span className="text-muted">({fmtMl(num(units) / unitsPerMl(syringe))})</span></> : '–'}</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Choose the water</h2>
        <p className="text-sm text-muted">How much water makes your dose a set number of units, for an easier draw.</p>
        <TextInput label="Units you'd like each dose to be" type="number" inputMode="decimal" min="0" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
        <p className="tnum" aria-live="polite">{doseOk && num(target) > 0 ? <>Add <strong>{fmt(waterForUnits(num(dose), vialInDoseUnit, num(target), syringe), 2)} mL</strong> of water</> : '–'}</p>
      </Card>

      <p className="text-sm text-muted text-center px-4">These are sums on the numbers you enter. Check them against the label, your prescriber's directions or your pharmacist before injecting.</p>
    </div>
  );
}
