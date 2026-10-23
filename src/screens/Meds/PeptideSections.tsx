import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { TrendingUp } from 'lucide-react';
import type { Medication } from '../../db/schema';
import { addPlannedChanges, removePlannedChanges } from '../../db/repos/meds';
import { useToast } from '../../app/toast';
import { fmtAmount, fmtYmdDay } from '../../logic/format';
import { medOn } from '../../logic/plans';
import { scheduleAtDose, titrationSteps } from '../../logic/peptide';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Segmented, TextInput } from '../../components/ui/Field';

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

/** Build a titration (or taper) as planned changes, from the person's own numbers. */
export function TitrationCard({ med }: { med: Medication }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><TrendingUp size={20} className="text-primary" aria-hidden="true" /> Titration</h2>
      <p className="text-muted">Step the dose up or down on a schedule.</p>
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
        <p className="text-sm text-muted">Times and days stay the same; only the dose changes.</p>
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
              {steps.map((x) => <li key={x.from}>{fmtYmdDay(x.from)}: {fmtAmount(x.dose, med.unit)}</li>)}
            </ol>
          </div>
        )}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!steps.length || !!dateError} onClick={save}>Add {steps.length || ''} planned change{steps.length === 1 ? '' : 's'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
