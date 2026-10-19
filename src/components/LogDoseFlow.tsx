import { useState } from 'react';
import { Clock, Info } from 'lucide-react';
import type { Dose, Medication } from '../db/schema';
import { logDose } from '../db/repos/doses';
import { FIXED_MATCH_MS, getContextNotes, getExpectedAmount, getFixedSlots, getLastDose, getRecentDose, type ContextNote, type ScheduleSettings } from '../logic/schedule';
import { stockUnitsFor } from '../logic/stock';
import { MedInstructions } from './MedInstructions';
import { fmtAgo, fmtAmount, fmtDuration, fmtHHmm, fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../logic/format';
import { canVibrate } from '../platform';
import { Button } from './ui/Button';
import { Stepper } from './ui/Stepper';

export const SKIP_REASONS = ['Felt unwell', 'Planned break', 'Too late in the day', 'Ran out', 'Prescriber said to', 'Other'];

function noteText(n: ContextNote, isNow: boolean, unit: string): string {
  switch (n.kind) {
    case 'not-scheduled-day':
      return "Today isn't one of your scheduled days for this medication.";
    case 'amount':
      return `Your schedule has ${fmtAmount(n.expected, unit)} for this dose.`;
    case 'interval':
      return `${isNow ? "It's been" : "That's"} ${fmtDuration(n.elapsedMs)} since your last dose. Your schedule is every ${n.intervalHours} hour${n.intervalHours === 1 ? '' : 's'}.`;
    case 'count':
      return `This would be dose ${n.doseNumber} of your ${n.target} per day.`;
    case 'past-latest':
      return `This is after your latest dose time of ${fmtHHmm(n.latestDoseTime)}.`;
  }
}

/** Amount, time and context notes, then Log dose. Shows the double-tap guard first when this med was just logged. */
export function LogDoseFlow({ med, doses, s, now, tagId, onLogged, onCancel }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; tagId?: string;
  onLogged: (d: Dose) => void; onCancel: () => void;
}) {
  // The amount follows the plan for this dose (e.g. 20, 20, then 10 mg) until the person changes it.
  const [amountEdit, setAmountEdit] = useState<number | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(now - 30 * 60_000));
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [skipNote, setSkipNote] = useState('');

  const recent = getRecentDose(doses, med.id, now, s.guardMinutes);
  if (recent && !override) {
    return (
      <div className="space-y-4">
        <div className="rounded-btn bg-caution-soft p-4 flex gap-3">
          <Info className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            You already logged this at <strong className="tnum">{fmtTime(Date.parse(recent.takenAt))}</strong>
            {' '}({fmtAgo(now - Date.parse(recent.takenAt))}). Log another dose?
          </p>
        </div>
        <Button className="w-full min-h-[56px]" onClick={onCancel} autoFocus>Don't log</Button>
        <Button variant="secondary" className="w-full" onClick={() => setOverride(true)}>Log another</Button>
      </div>
    );
  }

  const takenAt = earlier ? fromLocalInput(when) : now;
  const amount = amountEdit ?? (Number.isFinite(takenAt) ? getExpectedAmount(med, doses, takenAt, s) : med.defaultAmount);
  const units = med.strength > 0 && med.unit !== 'tablet' && amount > 0 ? stockUnitsFor(med, amount) : null;
  const timeError = earlier && (!Number.isFinite(takenAt) ? 'Choose a time.' : takenAt > now + 60_000 ? "That time hasn't happened yet." : undefined);
  const amountError = !(amount > 0) ? 'Enter an amount.' : undefined;
  const notes = Number.isFinite(takenAt) ? getContextNotes(med, doses, takenAt, s, amount > 0 ? amount : undefined) : [];
  const last = getLastDose(doses, med.id, now);

  const submit = async () => {
    if (timeError || amountError || saving) return;
    setSaving(true);
    try {
      const dose = await logDose({
        medicationId: med.id,
        takenAt: new Date(takenAt).toISOString(),
        amount,
        source: earlier && now - takenAt > 2 * 60_000 ? 'backdated' : tagId ? 'tag' : 'manual',
        tagId,
      });
      if (canVibrate) navigator.vibrate(30);
      navigator.storage?.persist?.().catch(() => {}); // ask the browser to keep data once there's something worth keeping
      onLogged(dose);
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    if (timeError || saving) return;
    setSaving(true);
    try {
      // A skip belongs to the set time it replaces (so the countdown moves on), otherwise to the chosen time.
      let at = takenAt;
      if (med.schedule.type === 'fixed') {
        const open = getFixedSlots(med, doses, takenAt, s).find((x) => !x.dose && x.at - FIXED_MATCH_MS <= takenAt);
        if (open) at = open.at;
      }
      const dose = await logDose({
        medicationId: med.id, takenAt: new Date(at).toISOString(), amount: amount > 0 ? amount : med.defaultAmount,
        source: earlier ? 'backdated' : 'manual', tagId, skipped: true,
        skipReason: [reason, skipNote.trim()].filter(Boolean).join(': ') || undefined,
      });
      onLogged(dose);
    } finally {
      setSaving(false);
    }
  };

  if (skipping) {
    return (
      <div className="space-y-4">
        <MedInstructions med={med} />
        <p>Record this dose as skipped. It won't count as taken and your stock won't change.</p>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Why? (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}
                className={`min-h-[44px] px-4 rounded-chip border text-sm font-medium ${reason === r ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border'}`}>
                {r}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Note (optional)</span>
          <input value={skipNote} onChange={(e) => setSkipNote(e.target.value)} className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3.5" />
        </label>
        <Button className="w-full min-h-[56px]" onClick={skip} disabled={saving}>Mark as skipped</Button>
        <Button variant="secondary" className="w-full" onClick={() => setSkipping(false)}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <MedInstructions med={med} />
      {last && (
        <p className="text-muted tnum">
          Last dose {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}
        </p>
      )}

      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Amount</span>
        <Stepper label="Amount" value={amount} onChange={setAmountEdit} step={med.strength > 0 && med.unit !== 'tablet' ? med.strength : 1} suffix={med.unit === 'tablet' ? 'tablets' : med.unit} />
        {units !== null && <p className="text-sm text-muted tnum">{units} {med.form === 'other' ? 'units' : `${med.form}${units === 1 ? '' : 's'}`} of {fmtAmount(med.strength, med.unit)}</p>}
        {amountError && <p className="text-sm text-danger" role="alert">{amountError}</p>}
      </div>

      <div className="space-y-2">
        <span className="block text-sm font-medium">Time</span>
        {!earlier ? (
          <div className="flex items-center justify-between gap-3 min-h-[48px]">
            <span className="tnum">Now · {fmtTime(now)}</span>
            <button type="button" onClick={() => setEarlier(true)} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold flex items-center gap-1.5">
              <Clock size={18} aria-hidden="true" /> Taken earlier?
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                type="datetime-local" aria-label="Time taken" value={when} max={toLocalInput(now)}
                onChange={(e) => setWhen(e.target.value)}
                className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum"
              />
              <button type="button" onClick={() => setEarlier(false)} className="min-h-[48px] px-3 rounded-btn bg-surface-2 font-semibold">Now</button>
            </div>
            {timeError && <p className="text-sm text-danger" role="alert">{timeError}</p>}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="space-y-2" aria-label="Notes from your settings">
          {notes.map((n) => (
            <li key={n.kind} className="rounded-btn bg-caution-soft px-4 py-3 flex gap-3 text-sm">
              <Info size={18} className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
              <span>{noteText(n, !earlier, med.unit)} You can still log it.</span>
            </li>
          ))}
        </ul>
      )}

      <Button className="w-full min-h-[56px] text-lg" onClick={submit} disabled={saving || !!timeError || !!amountError}>
        Log dose
      </Button>
      {med.schedule.type !== 'prn' && (
        <button type="button" onClick={() => setSkipping(true)} className="w-full min-h-[48px] text-primary font-semibold">Skip this dose</button>
      )}
    </div>
  );
}
