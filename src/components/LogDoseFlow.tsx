import { useState } from 'react';
import { Clock, Info } from 'lucide-react';
import type { Dose, Medication } from '../db/schema';
import { logDose } from '../db/repos/doses';
import { getContextNotes, getLastDose, getRecentDose, type ContextNote, type ScheduleSettings } from '../logic/schedule';
import { fmtAgo, fmtDuration, fmtHHmm, fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../logic/format';
import { canVibrate } from '../platform';
import { Button } from './ui/Button';
import { Stepper } from './ui/Stepper';

function noteText(n: ContextNote, isNow: boolean): string {
  switch (n.kind) {
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
  const [amount, setAmount] = useState(med.defaultAmount);
  const [earlier, setEarlier] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(now - 30 * 60_000));
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);

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
  const timeError = earlier && (!Number.isFinite(takenAt) ? 'Choose a time.' : takenAt > now + 60_000 ? "That time hasn't happened yet." : undefined);
  const amountError = !(amount > 0) ? 'Enter an amount.' : undefined;
  const notes = Number.isFinite(takenAt) ? getContextNotes(med, doses, takenAt, s) : [];
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

  return (
    <div className="space-y-5">
      {last && (
        <p className="text-muted tnum">
          Last dose {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}
        </p>
      )}

      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Amount</span>
        <Stepper label="Amount" value={amount} onChange={setAmount} step={med.strength > 0 && med.unit !== 'tablet' ? med.strength : 1} suffix={med.unit === 'tablet' ? 'tablets' : med.unit} />
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
              <span>{noteText(n, !earlier)} You can still log it.</span>
            </li>
          ))}
        </ul>
      )}

      <Button className="w-full min-h-[56px] text-lg" onClick={submit} disabled={saving || !!timeError || !!amountError}>
        Log dose
      </Button>
    </div>
  );
}
