import { useState } from 'react';
import { Clock, Info } from 'lucide-react';
import type { Dose, Medication, Person } from '../db/schema';
import { doseOwner, personOf, storedPerson } from '../db/repos/people';
import { useMeds } from '../app/data';
import { combinedTotals } from '../logic/ingredients';
import { PersonBadge } from './PersonSwitcher';
import { logDose } from '../db/repos/doses';
import { FIXED_MATCH_MS, getContextNotes, getExpectedAmount, getFixedSlots, getLastDose, getRecentDose, type ContextNote, type ScheduleSettings } from '../logic/schedule';
import { stockUnitsFor } from '../logic/stock';
import { currentVial, doseForUnits, drawFor, vialForTag } from '../logic/peptide';
import { DrawGuide } from './Syringe';
import { MedInstructions } from './MedInstructions';
import { fmtAgo, fmtAmount, fmtDuration, fmtHHmm, fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../logic/format';
import { canVibrate } from '../platform';
import { Button } from './ui/Button';
import { Bar } from './ui/Visual';
import { Stepper } from './ui/Stepper';
import { SheetActions } from './ui/Sheet';

export const SKIP_REASONS = ['Felt unwell', 'Planned break', 'Too late in the day', 'Ran out', 'Prescriber said to', 'Other'];

function noteText(n: ContextNote, isNow: boolean, unit: string): string {
  switch (n.kind) {
    case 'not-scheduled-day':
      return "Today isn't one of your scheduled days for this medication.";
    case 'amount':
      return `Your schedule has ${fmtAmount(n.expected, unit)} for this dose.`;
    case 'rolling-count':
      return `This would be dose ${n.doseNumber} in 24 hours. Your limit is ${n.max}.`;
    case 'rolling-amount':
      return `This would make ${fmtAmount(n.total, unit)} in 24 hours. Your limit is ${fmtAmount(n.max, unit)}.`;
    case 'min-gap':
      return `${isNow ? "It's been" : "That's"} ${fmtDuration(n.elapsedMs)} since the last dose. Your limit is at least ${n.minHours} hour${n.minHours === 1 ? '' : 's'} apart.`;
    case 'interval':
      return `${isNow ? "It's been" : "That's"} ${fmtDuration(n.elapsedMs)} since your last dose. Your schedule is every ${n.intervalHours} hour${n.intervalHours === 1 ? '' : 's'}.`;
    case 'count':
      return `This would be dose ${n.doseNumber} of your ${n.target} per day.`;
    case 'past-latest':
      return `This is after your latest dose time of ${fmtHHmm(n.latestDoseTime)}.`;
  }
}

/** Amount, time and context notes, then Log dose. Shows the double-tap guard first when this med was just logged. */
export function LogDoseFlow({ med, doses: allDoses, s, now, tagId, vialId, onLogged, onCancel, people, defaultPersonId = null }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; tagId?: string;
  /** A vial tag was tapped: log from that vial (or the one in use, if the tag's vial is finished). */
  vialId?: string;
  onLogged: (d: Dose) => void; onCancel: () => void;
  /** Family members to choose from when the medication is shared (2+ people). */
  people?: Pick<Person, 'id' | 'name'>[];
  /** Who's preselected for a shared medication; null = they must choose (e.g. after a tag tap). */
  defaultPersonId?: string | null;
}) {
  const choosing = !!med.shared && !!people && people.length > 1;
  const allMeds = useMeds() ?? [med];
  const [who, setWho] = useState<string | null>(choosing ? defaultPersonId : null);
  // For a shared medication, everything below (guard, plan, notes, last dose) looks only at this person's doses.
  const doses = choosing && who ? allDoses.filter((d) => d.medicationId !== med.id || personOf(d) === who) : allDoses;
  // The amount follows the plan for this dose (e.g. 20, 20, then 10 mg) until the person changes it.
  const [amountEdit, setAmountEdit] = useState<number | null>(null);
  // Peptide tools: syringe units for mixed vials.
  // Units come from the vial in use (its own amount and water); pens are dialled, not drawn.
  const inUse = med.peptide ? vialForTag(med, vialId).vial ?? currentVial(med) : undefined;
  const vialAmount = inUse?.amount ?? med.strength;
  const vialWater = inUse?.waterMl ?? med.peptide?.waterMl ?? 0;
  const vial = med.peptide && med.peptide.kind !== 'pen' && vialAmount > 0 && vialWater > 0 ? { ...med.peptide, waterMl: vialWater } : undefined;
  const [inUnits, setInUnits] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(now - 30 * 60_000));
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [skipNote, setSkipNote] = useState('');

  const whoPicker = choosing && (
    <fieldset>
      <legend className="text-sm font-medium mb-2">Who's taking it?</legend>
      <div role="radiogroup" aria-label="Who's taking it?" className="flex flex-wrap gap-2">
        {people!.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={who === p.id} onClick={() => { setWho(p.id); setOverride(false); setAmountEdit(null); }}
            className={`min-h-[48px] pl-1.5 pr-4 rounded-chip flex items-center gap-2 font-medium border ${who === p.id ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border'}`}>
            <PersonBadge name={p.name} size={34} /> {p.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
  if (choosing && !who) {
    return (
      <div className="space-y-4">
        <MedInstructions med={med} />
        {whoPicker}
        <p className="text-sm text-muted">This medication is shared. Choose who's taking it so it's logged for the right person.</p>
      </div>
    );
  }

  const recent = getRecentDose(doses, med.id, now, s.guardMinutes);
  if (recent && !override) {
    return (
      <div className="space-y-4">
        {whoPicker}
        <div className="rounded-btn bg-surface-2 p-4 flex gap-3">
          <Info className="shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            You already logged this at <strong className="tnum">{fmtTime(Date.parse(recent.takenAt))}</strong>
            {' '}({fmtAgo(now - Date.parse(recent.takenAt))}). Log another dose?
          </p>
        </div>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={onCancel} autoFocus>Don't log</Button>
          <Button variant="secondary" className="w-full" onClick={() => setOverride(true)}>Log another</Button>
        </SheetActions>
      </div>
    );
  }

  const takenAt = earlier ? fromLocalInput(when) : now;
  const amount = amountEdit ?? (Number.isFinite(takenAt) ? getExpectedAmount(med, doses, takenAt, s) : med.defaultAmount);
  const units = med.strength > 0 && med.unit !== 'tablet' && amount > 0 ? stockUnitsFor(med, amount) : null;
  const timeError = earlier && (!Number.isFinite(takenAt) ? 'Choose a time.' : takenAt > now + 60_000 ? "That time hasn't happened yet." : undefined);
  const amountError = !(amount > 0) ? 'Enter an amount.' : undefined;
  const notes = Number.isFinite(takenAt) ? getContextNotes(med, doses, takenAt, s, amount > 0 ? amount : undefined) : [];
  // The same ingredient in other medicines (e.g. paracetamol in Panadol and a cold-and-flu tablet), added up.
  const owner = choosing && who ? who : doseOwner({}, med);
  const medById = new Map(allMeds.map((m) => [m.id, m]));
  const combined = Number.isFinite(takenAt) && amount > 0
    ? combinedTotals(med, amount, allMeds.filter((m) => !m.archived), allDoses, takenAt, (d) => doseOwner(d, medById.get(d.medicationId)) === owner) : [];
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
        personId: choosing && who ? storedPerson(who) : undefined,
        vialId: inUse && inUse.id !== 'legacy' ? inUse.id : undefined,
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
        source: earlier ? 'backdated' : 'manual', tagId, skipped: true, personId: choosing && who ? storedPerson(who) : undefined,
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
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={skip} disabled={saving}>Mark as skipped</Button>
          <Button variant="secondary" className="w-full" onClick={() => setSkipping(false)}>Go back</Button>
        </SheetActions>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <MedInstructions med={med} />
      {whoPicker}
      {last && (
        <p className="text-muted tnum">
          Last dose {fmtAgo(now - Date.parse(last.takenAt))} · {fmtWhen(Date.parse(last.takenAt), now)}
        </p>
      )}

      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Amount</span>
        {vial && inUnits ? (
          <Stepper label="Syringe units" value={drawFor(amount, vialAmount, vial.waterMl, vial.syringe).units}
            onChange={(u) => setAmountEdit(Number.isFinite(u) ? doseForUnits(u, vialAmount, vial.waterMl, vial.syringe) : NaN)} step={1} suffix="units" />
        ) : (
          <Stepper label="Amount" value={amount} onChange={setAmountEdit}
            step={vial ? doseForUnits(1, vialAmount, vial.waterMl, vial.syringe) : med.strength > 0 && med.unit !== 'tablet' ? med.strength : 1}
            suffix={med.unit === 'tablet' ? 'tablets' : med.unit} />
        )}
        {vial && (
          <button type="button" onClick={() => setInUnits(!inUnits)} className="min-h-[44px] text-sm text-primary font-semibold">
            {inUnits ? `Enter in ${med.unit}` : 'Enter in syringe units'}
          </button>
        )}
        {vial ? <p className="text-sm tnum">{inUnits && amount > 0 ? `= ${fmtAmount(amount, med.unit)}` : ''}</p>
          : !med.peptide && units !== null && <p className="text-sm text-muted tnum">{units} {med.form === 'other' ? 'units' : `${med.form}${units === 1 ? '' : 's'}`} of {fmtAmount(med.strength, med.unit)}</p>}
        {med.peptide && amount > 0 && <DrawGuide med={med} amount={amount} />}
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

      {combined.map((c) => (
        <div key={c.ingredient} className="rounded-btn bg-surface-2 px-4 py-3 space-y-2" role="alert">
          <p className="text-sm flex justify-between gap-3"><span className="first-letter:uppercase">{c.ingredient} in 24 h (with {c.others.join(', ')})</span><span className="tnum font-semibold">{c.totalMg.toLocaleString('en-AU')} / {c.limitMg.toLocaleString('en-AU')} mg</span></p>
          <Bar value={c.totalMg} max={c.totalMg} marker={c.limitMg} tone="bad" label={`${c.totalMg} mg of ${c.ingredient}, your limit is ${c.limitMg} mg`} />
        </div>
      ))}
      {notes.length > 0 && (
        <ul className="space-y-2" aria-label="Notes from your settings">
          {notes.map((n) => (
            <li key={n.kind} className="rounded-btn bg-surface-2 px-4 py-3 flex gap-3 text-sm">
              <Info size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{noteText(n, !earlier, med.unit)}</span>
            </li>
          ))}
        </ul>
      )}

      <SheetActions>
        <Button className="w-full min-h-[56px] text-lg" onClick={submit} disabled={saving || !!timeError || !!amountError}>
          Log dose
        </Button>
        {med.schedule.type !== 'prn' && (
          <button type="button" onClick={() => setSkipping(true)} className="w-full min-h-[48px] text-primary font-semibold">Skip this dose</button>
        )}
      </SheetActions>
    </div>
  );
}
