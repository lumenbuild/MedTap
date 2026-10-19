import { useState } from 'react';
import type { Dose, Medication } from '../../db/schema';
import { removeDose, restoreDose, updateDose } from '../../db/repos/doses';
import { fmtAmount, fmtMedName, fmtTime, fromLocalInput, toLocalInput } from '../../logic/format';
import { Sheet } from '../../components/ui/Sheet';
import { Stepper } from '../../components/ui/Stepper';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../app/toast';

export function DoseEditSheet({ dose, med, onClose }: { dose: Dose | null; med?: Medication; onClose: () => void }) {
  return dose ? <DoseEditForm key={dose.id} dose={dose} med={med} onClose={onClose} /> : null;
}

function DoseEditForm({ dose, med, onClose }: { dose: Dose; med?: Medication; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(dose.amount);
  const [when, setWhen] = useState(toLocalInput(Date.parse(dose.takenAt)));
  const takenAt = fromLocalInput(when);
  const error = !Number.isFinite(takenAt) ? 'Choose a time.' : takenAt > Date.now() + 60_000 ? "That time hasn't happened yet." : !(amount > 0) ? 'Enter an amount.' : undefined;
  const unit = med?.unit ?? '';

  const save = async () => {
    if (error) return;
    await updateDose(dose.id, { amount, takenAt: new Date(takenAt).toISOString() });
    toast(`Saved: ${fmtAmount(amount, unit)} at ${fmtTime(takenAt)}`);
    onClose();
  };
  const del = async () => {
    await removeDose(dose.id);
    toast(`Deleted ${fmtAmount(dose.amount, unit)} at ${fmtTime(Date.parse(dose.takenAt))}`, { onAction: () => restoreDose(dose.id) });
    onClose();
  };

  if (dose.skipped) {
    return (
      <Sheet open onClose={onClose} title={med ? `${med.name}: skipped` : 'Skipped dose'}>
        <div className="space-y-4">
          <p className="tnum">Marked as skipped for {fmtTime(Date.parse(dose.takenAt))}.{dose.skipReason ? ` ${dose.skipReason}.` : ''}</p>
          <Button variant="danger" className="w-full" onClick={async () => {
            await removeDose(dose.id);
            toast('Skip removed', { onAction: () => restoreDose(dose.id) });
            onClose();
          }}>Remove this skip</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={med ? `Edit ${fmtMedName(med)}` : 'Edit dose'}>
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Amount</span>
          <Stepper label="Amount" value={amount} onChange={setAmount} step={med && med.strength > 0 && med.unit !== 'tablet' ? med.strength : 1} suffix={unit === 'tablet' ? 'tablets' : unit} />
        </div>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Time taken</span>
          <input type="datetime-local" value={when} max={toLocalInput(Date.now())} onChange={(e) => setWhen(e.target.value)}
            className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
        </label>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button className="w-full min-h-[56px]" onClick={save} disabled={!!error}>Save changes</Button>
        <Button variant="danger" className="w-full" onClick={del}>Delete this dose</Button>
      </div>
    </Sheet>
  );
}
