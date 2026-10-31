// The peptide calculator: start from one of your vials, a peptide in the guide, or your own numbers, then one task at a
// time: the draw for a dose, the dose in a number of units, or the water that makes a dose an easy number of units.
// Taps rather than typing where it can (vial sizes, doses, water and syringe size), and the answer large, with the syringe.
import { useState } from 'react';
import type { Medication, SyringeType } from '../db/schema';
import { concentration, convert, currentVial, doseForUnits, drawFor, fmtMl, SYRINGES, unitsPerMl, waterForUnits } from '../logic/peptide';
import { fmtDose, GUIDE, guideById, guideFor } from '../logic/peptideGuide';
import { useFamily, useMeds } from '../app/data';
import { medIsFor } from '../db/repos/people';
import { go } from '../app/router';
import { shownName } from '../logic/privacy';
import { ChipPicker, Segmented, Select, TextInput } from '../components/ui/Field';
import { Stepper } from '../components/ui/Stepper';
import { Button } from '../components/ui/Button';
import { DrawResult, SyringeGauge, syringeSizes } from '../components/Syringe';

type Unit = 'mg' | 'mcg';
type Mode = 'draw' | 'units' | 'water';
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const fmt = (n: number, dp = 3) => (Number.isFinite(n) ? String(Math.round(n * 10 ** dp) / 10 ** dp) : '–');

interface Setup { vial: string; vialUnit: Unit; water: number; dose: string; doseUnit: Unit; syringe: SyringeType; capacity: number; doses: number[]; vials: number[] }

/** What a source fills in: a medication's vial in use, or a guide entry's first vial and starting dose. */
function fromMed(m: Medication): Setup {
  const v = currentVial(m);
  const unit: Unit = m.unit === 'mcg' ? 'mcg' : 'mg';
  return { vial: String(v?.amount ?? m.strength), vialUnit: unit, water: v?.waterMl ?? m.peptide?.waterMl ?? 2, dose: String(m.defaultAmount), doseUnit: unit,
    syringe: m.peptide?.syringe ?? 'U-100', capacity: m.peptide?.syringeUnits ?? 100, doses: guideFor(m.name)?.tableDoses ?? [m.defaultAmount], vials: [] };
}
function fromGuide(id: string): Setup {
  const g = guideById(id)!;
  return { vial: String(g.vials[0].amount), vialUnit: g.unit, water: g.vials[0].waterMl, dose: String(g.setup.defaultAmount), doseUnit: g.unit, syringe: 'U-100', capacity: g.setup.syringeUnits,
    doses: g.tableDoses, vials: g.vials.map((v) => v.amount) };
}
const CUSTOM: Setup = { vial: '5', vialUnit: 'mg', water: 2, dose: '250', doseUnit: 'mcg', syringe: 'U-100', capacity: 30, doses: [], vials: [] };

export function PeptideCalc({ guideId: fromGuideId }: { guideId?: string } = {}) {
  const meds = useMeds(); const fam = useFamily();
  const mine = (meds ?? []).filter((m) => m.peptide && m.peptide.kind !== 'pen' && !m.archived && fam && medIsFor(m, fam.personId));
  const [source, setSource] = useState<string>(fromGuideId && guideById(fromGuideId) ? 'guide' : '');
  const [guideId, setGuideId] = useState(fromGuideId && guideById(fromGuideId) ? fromGuideId : GUIDE[0].id);
  const [st, setSt] = useState<Setup>(CUSTOM);
  const [mode, setMode] = useState<Mode>('draw');
  const [units, setUnits] = useState(10);
  const [target, setTarget] = useState(10);
  // The first of your vials, once they've loaded; else the guide.
  const src = source || (meds ? (mine[0] ? `med:${mine[0].id}` : 'guide') : '');
  const [applied, setApplied] = useState('');
  if (src && applied !== `${src}|${guideId}`) {
    setApplied(`${src}|${guideId}`);
    setSt(src.startsWith('med:') ? fromMed(mine.find((m) => `med:${m.id}` === src) ?? mine[0]) : src === 'guide' ? fromGuide(guideId) : CUSTOM);
  }
  const set = <K extends keyof Setup>(k: K, v: Setup[K]) => setSt((p) => ({ ...p, [k]: v }));

  const sizes = syringeSizes(st.syringe);
  const vialAmt = convert(num(st.vial), st.vialUnit, st.doseUnit) ?? NaN;
  const ok = num(st.vial) > 0 && st.water > 0;
  const dose = num(st.dose);
  const draw = ok && dose > 0 ? drawFor(dose, vialAmt, st.water, st.syringe) : null;
  const conc = ok ? concentration(vialAmt, st.water) : NaN;
  const perVial = ok && dose > 0 ? Math.floor(vialAmt / dose + 1e-9) : NaN;
  const sources = [...mine.map((m) => ({ value: `med:${m.id}`, label: shownName(m) })), { value: 'guide', label: 'From the guide' }, { value: 'custom', label: 'My own numbers' }];
  const g = src === 'guide' ? guideById(guideId) : undefined;

  return (
    <div className="space-y-5 pb-8">
      <ChipPicker label="Start from" value={src} onChange={setSource} options={sources} />
      {src === 'guide' && (
        <Select label="Peptide" value={guideId} onChange={(e) => setGuideId(e.target.value)}>
          {GUIDE.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      )}

      {/* The vial: amount (sizes to tap when the guide knows them), water, syringe. */}
      <section aria-labelledby="vial-h" className="rounded-card bg-surface-2 p-4 space-y-3">
        <h2 id="vial-h" className="text-sm font-medium text-muted">Vial</h2>
        {st.vials.length > 1
          ? <ChipPicker label="Vial size" value={st.vial} onChange={(v) => set('vial', v)} options={st.vials.map((a) => ({ value: String(a), label: fmtDose(a, st.vialUnit) }))} />
          : (
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <TextInput label="Amount in the vial" type="number" inputMode="decimal" min="0" step="any" value={st.vial} onChange={(e) => set('vial', e.target.value)} />
              <Select label="Unit" value={st.vialUnit} onChange={(e) => set('vialUnit', e.target.value as Unit)}>{(['mg', 'mcg'] as const).map((u) => <option key={u}>{u}</option>)}</Select>
            </div>
          )}
        <div>
          <p className="text-sm font-medium mb-1">Water added</p>
          <Stepper label="Water added" value={st.water} onChange={(v) => set('water', v)} step={0.5} min={0} suffix="mL" />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <Segmented label="Syringe size" value={String(st.capacity)} onChange={(v) => set('capacity', Number(v))} options={sizes.map((x) => ({ value: String(x.units), label: `${x.units} u` }))} />
          <Select label="Type" value={st.syringe} onChange={(e) => { const t = e.target.value as SyringeType; setSt((p) => ({ ...p, syringe: t, capacity: syringeSizes(t)[0].units })); }}>
            {SYRINGES.map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
          </Select>
        </div>
        {ok && <p className="text-sm tnum"><span className="font-medium">{fmtDose(conc, st.doseUnit)} per mL</span> <span className="text-muted">· {fmtDose(conc / unitsPerMl(st.syringe), st.doseUnit)} per unit</span></p>}
      </section>

      <Segmented<Mode> label="Work out" value={mode} onChange={setMode} options={[{ value: 'draw', label: 'Dose → units' }, { value: 'units', label: 'Units → dose' }, { value: 'water', label: 'Pick water' }]} />

      {mode !== 'units' && (
        <div className="space-y-2">
          {st.doses.length > 0 && <ChipPicker label="Dose" value={st.dose} onChange={(v) => set('dose', v)} options={st.doses.map((d) => ({ value: String(d), label: fmtDose(d, st.doseUnit) }))} />}
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <TextInput label="Dose" type="number" inputMode="decimal" min="0" step="any" value={st.dose} onChange={(e) => set('dose', e.target.value)} />
            <Select label="Unit" value={st.doseUnit} onChange={(e) => set('doseUnit', e.target.value as Unit)}>{(['mg', 'mcg'] as const).map((u) => <option key={u}>{u}</option>)}</Select>
          </div>
        </div>
      )}

      <section aria-label="Result" className="rounded-card border border-border p-4 space-y-3">
        {mode === 'draw' && (draw
          ? <>
            <p className="text-sm text-muted">Draw to</p>
            <DrawResult draw={draw} capacity={st.capacity} syringe={st.syringe} />
            {Number.isFinite(perVial) && <p className="text-sm text-muted tnum">About {perVial} dose{perVial === 1 ? '' : 's'} a vial.</p>}
          </>
          : <p className="text-muted">Add the vial amount, water and dose.</p>)}
        {mode === 'units' && (
          <>
            <p className="text-sm font-medium">Units on the syringe</p>
            <Stepper label="Units on the syringe" value={units} onChange={setUnits} step={1} min={0} suffix="units" />
            {ok && units > 0 ? <>
              <p aria-live="polite"><span className="text-2xl font-semibold tnum">{fmtDose(doseForUnits(units, vialAmt, st.water, st.syringe), st.doseUnit)}</span> <span className="text-muted tnum">· {fmtMl(units / unitsPerMl(st.syringe))}</span></p>
              <SyringeGauge units={units} capacity={st.capacity} />
            </> : <p className="text-muted">Add the vial amount and water.</p>}
          </>
        )}
        {mode === 'water' && (
          <>
            <ChipPicker label="Units you'd like each dose to be" value={String(target)} onChange={(v) => setTarget(Number(v))} options={[5, 10, 20, 25, 50].filter((u) => u <= st.capacity).map((u) => ({ value: String(u), label: `${u} units` }))} />
            {ok && dose > 0 && target > 0 ? (() => {
              const w = waterForUnits(dose, vialAmt, target, st.syringe);
              return <>
                <p aria-live="polite"><span className="text-sm text-muted block">Add</span><span className="text-2xl font-semibold tnum">{fmt(w, 2)} mL</span> <span className="text-muted">of water</span></p>
                <p className="text-sm text-muted tnum">Then {fmtDose(dose, st.doseUnit)} is {target} units{w > 3 ? '. That’s a lot of water for one vial: a smaller unit target needs less.' : '.'}</p>
                {w > 0 && w !== st.water && <Button variant="secondary" className="w-full min-h-[48px]" onClick={() => set('water', Math.round(w * 100) / 100)}>Use {fmt(w, 2)} mL above</Button>}
              </>;
            })() : <p className="text-muted">Add the vial amount and dose.</p>}
          </>
        )}
      </section>

      {g && <Button variant="secondary" className="w-full min-h-[52px]" onClick={() => go(`/meds/new/guide/${g.id}`)}>Set up {g.name} with the guide</Button>}
      {src.startsWith('med:') && <p className="text-sm text-muted">From your vial in use. Changes here don’t change your vial: logging a shot always uses your own vial and water.</p>}
    </div>
  );
}
