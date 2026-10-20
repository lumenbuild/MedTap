import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { FlaskConical, TrendingUp } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import { shownName } from '../../logic/privacy';
import { addPlannedChanges, removePlannedChanges, setVialMixed } from '../../db/repos/meds';
import { useDoses } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { fmtAmount } from '../../logic/format';
import { medOn } from '../../logic/plans';
import { scheduleAtDose, titrationSteps, vialStatus } from '../../logic/peptide';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Segmented, TextInput } from '../../components/ui/Field';
import { DrawGuide } from '../../components/Syringe';
import { APP_NAME } from '../../config';

const fmtDay = (ms: number) => format(ms, 'EEE d MMM');
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

/** The vial in use: mixed when, what's left, use-by. */
export function VialCard({ med }: { med: Medication }) {
  const doses = useDoses();
  const now = useNow(60_000);
  const toast = useToast();
  if (!med.peptide || !doses) return null;
  const v = vialStatus(med, doses, now);
  const mixed = async () => {
    const before = await setVialMixed(med.id, new Date().toISOString());
    toast('New vial: counting from now', { onAction: () => setVialMixed(med.id, before) });
  };
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><FlaskConical size={20} className="text-primary" aria-hidden="true" /> Vial</h2>
      {v ? (
        <ul className="space-y-1 tnum">
          <li>Mixed {fmtDay(v.mixedAt)}</li>
          <li>About <strong>{fmtAmount(v.left, med.unit)}</strong> left{med.defaultAmount > 0 ? ` · ${v.dosesLeft} dose${v.dosesLeft === 1 ? '' : 's'} of ${fmtAmount(med.defaultAmount, med.unit)}` : ''}</li>
          {v.useBy && <li className={v.expired ? 'text-danger font-semibold' : ''}>{v.expired ? `Past its use-within date (${fmtDay(v.useBy)})` : `Use by ${fmtDay(v.useBy)}`}</li>}
        </ul>
      ) : (
        <p className="text-muted">Tap below when you mix a vial, and {APP_NAME} keeps count of what's left in it.</p>
      )}
      <DrawGuide med={med} amount={med.defaultAmount} />
      <Button variant="secondary" className="w-full" onClick={mixed}>I've mixed a new vial</Button>
      <a href="#/calc" className="block text-center min-h-[44px] leading-[44px] text-primary font-semibold">Open the peptide calculator</a>
    </Card>
  );
}

/** Build a titration (or taper) as planned changes, from the person's own numbers. */
export function TitrationCard({ med }: { med: Medication }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp size={20} className="text-primary" aria-hidden="true" /> Titration</h2>
      <p className="text-muted">Step the dose up (or down) on a schedule your prescriber gave you. Each step becomes a planned change that switches over on its day.</p>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>Plan a titration</Button>
      {open && <TitrationSheet med={med} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function TitrationSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const tomorrow = ymd(addDays(new Date(), 1));
  const [start, setStart] = useState(String(med.defaultAmount || ''));
  const [step, setStep] = useState('');
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [every, setEvery] = useState('4');
  const [unit, setUnit] = useState<'weeks' | 'days'>('weeks');
  const [until, setUntil] = useState('');
  const [from, setFrom] = useState(tomorrow);
  const n = (s: string) => Number(s);
  const steps = titrationSteps({
    start: n(start), from, step: (dir === 'up' ? 1 : -1) * n(step), everyDays: n(every) * (unit === 'weeks' ? 7 : 1), until: n(until),
  });
  const dateError = from < tomorrow ? 'Start from tomorrow on. To change today, edit the medication.' : undefined;
  const filled = n(start) > 0 && n(step) > 0 && n(every) >= 1 && n(until) > 0;
  const mismatch = filled && !steps.length ? `Stepping ${dir} from ${start} won't reach ${until}. Check the direction.` : undefined;

  const save = async () => {
    if (!steps.length || dateError) return;
    const changes = steps.map((x, i) => ({
      from: x.from, defaultAmount: x.dose, schedule: scheduleAtDose(medOn(med, x.from).schedule),
      note: `Titration step ${i + 1} of ${steps.length}`,
    }));
    const ids = await addPlannedChanges(med.id, changes);
    toast(`Planned ${ids.length} step${ids.length === 1 ? '' : 's'}`, { onAction: () => removePlannedChanges(med.id, ids) });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Plan a titration">
      <div className="space-y-4">
        <p className="text-sm text-muted">Enter the plan from your prescriber. {med.name}'s times and days stay the same; only the dose changes.</p>
        <TextInput label={`First dose (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={start} onChange={(e) => setStart(e.target.value)} />
        <Segmented label="Increase or decrease" value={dir} options={[{ value: 'up', label: 'Increase' }, { value: 'down', label: 'Decrease' }]} onChange={setDir} />
        <TextInput label={`By (${med.unit}) each step`} type="number" inputMode="decimal" min="0" step="any" value={step} onChange={(e) => setStep(e.target.value)} />
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <TextInput label="Every" type="number" inputMode="numeric" min="1" step="1" value={every} onChange={(e) => setEvery(e.target.value)} />
          <Segmented label="Weeks or days" value={unit} options={[{ value: 'weeks', label: 'Weeks' }, { value: 'days', label: 'Days' }]} onChange={setUnit} />
        </div>
        <TextInput label={`Until the dose is (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={until} onChange={(e) => setUntil(e.target.value)} error={mismatch} />
        <TextInput label="First step on" type="date" min={tomorrow} value={from} onChange={(e) => setFrom(e.target.value)} error={dateError} />
        {steps.length > 0 && (
          <div className="rounded-btn bg-surface-2 p-3">
            <p className="font-semibold mb-1">{steps.length} step{steps.length === 1 ? '' : 's'}</p>
            <ol className="text-sm space-y-0.5 tnum">
              {steps.map((x) => <li key={x.from}>{format(new Date(`${x.from}T12:00`), 'EEE d MMM yyyy')}: {fmtAmount(x.dose, med.unit)}</li>)}
            </ol>
          </div>
        )}
        <Button className="w-full min-h-[56px]" disabled={!steps.length || !!dateError} onClick={save}>Add {steps.length || ''} planned change{steps.length === 1 ? '' : 's'}</Button>
      </div>
    </Sheet>
  );
}

/** Today: a vial past its use-within date, or about to run out. */
export function VialAlerts({ meds, doses, now }: { meds: Medication[]; doses: Dose[]; now: number }) {
  const toast = useToast();
  const alerts = meds.filter((m) => m.peptide && !m.archived).map((m) => ({ m, v: vialStatus(m, doses, now) }))
    .filter((x): x is { m: Medication; v: NonNullable<typeof x.v> } => !!x.v && (x.v.expired || x.v.dosesLeft <= 1));
  if (!alerts.length) return null;
  return (
    <>
      {alerts.map(({ m, v }) => (
        <Card key={m.id} className="bg-caution-soft shadow-none flex gap-3">
          <FlaskConical className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p><strong>{shownName(m)} vial:</strong>{' '}
              {v.expired ? `past its use-within date (mixed ${fmtDay(v.mixedAt)}).`
                : v.dosesLeft === 0 ? 'probably empty.' : 'about 1 dose left.'}
            </p>
            <Button variant="secondary" onClick={async () => {
              const before = await setVialMixed(m.id, new Date().toISOString());
              toast('New vial: counting from now', { onAction: () => setVialMixed(m.id, before) });
            }}>I've mixed a new vial</Button>
          </div>
        </Card>
      ))}
    </>
  );
}
