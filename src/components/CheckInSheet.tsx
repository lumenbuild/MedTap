import { useEffect, useState } from 'react';
import { shownColour, shownMedName, shownName } from '../logic/privacy';
import { Plus } from 'lucide-react';
import type { CheckIn, Dose, Medication } from '../db/schema';
import { addCheckIn, removeCheckIn, restoreCheckIn, updateCheckIn, type CheckInInput } from '../db/repos/checkIns';
import { setSetting } from '../db/repos/settings';
import { storedPerson } from '../db/repos/people';
import { getDayBounds, type ScheduleSettings } from '../logic/schedule';
import { fmtAmount, fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../logic/format';
import { useToast } from '../app/toast';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { Stepper } from './ui/Stepper';
import { MoodPicker, Rating } from './ui/Rating';

const SIX_HOURS = 6 * 3_600_000;

export interface CheckInSeed { editing?: CheckIn; mood?: number; relatedDoseId?: string }

type Props = { onClose: () => void; doses: Dose[]; checkIns: CheckIn[]; meds: Medication[]; chips: string[]; s: ScheduleSettings; personId: string };

/** A check-in in under 20 seconds. Everything is optional. */
export function CheckInSheet({ seed, ...rest }: Props & { seed: CheckInSeed | null }) {
  // Remount per opening so the form starts from the seed on its very first render.
  const [n, setN] = useState(0);
  useEffect(() => { if (seed) setN((x) => x + 1); }, [seed]);
  return seed ? <CheckInForm key={n} seed={seed} {...rest} /> : null;
}

function CheckInForm({ seed, onClose, doses, checkIns, meds, chips, s, personId }: Props & { seed: CheckInSeed }) {
  const toast = useToast();
  const [f, setF] = useState<CheckInInput>(() => seed.editing ? { ...seed.editing }
    : { at: new Date().toISOString(), chips: [], mood: seed.mood, relatedDoseId: seed.relatedDoseId });
  const [changeTime, setChangeTime] = useState(false);
  const [newChip, setNewChip] = useState('');
  const [doseTouched, setDoseTouched] = useState(!!seed.editing || !!seed.relatedDoseId);
  const at = Date.parse(f.at);
  const set = <K extends keyof CheckInInput>(k: K, v: CheckInInput[K]) => setF((p) => ({ ...p, [k]: v }));

  // Doses in the 6 hours before this check-in; the newest is linked unless the person changes it.
  const nearby = doses.filter((d) => !d.deletedAt && Date.parse(d.takenAt) <= at && at - Date.parse(d.takenAt) <= SIX_HOURS)
    .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  const relatedDoseId = doseTouched ? f.relatedDoseId : nearby[0]?.id;
  const medName = (d: Dose) => meds.find((m) => m.id === d.medicationId);

  const { start, end } = getDayBounds(at, s.dayStartsAt, s.tz);
  const firstToday = !checkIns.some((c) => !c.deletedAt && c.id !== seed.editing?.id && Date.parse(c.at) >= start && Date.parse(c.at) < end && Date.parse(c.at) < at);
  const showSleep = firstToday || f.sleepHours !== undefined || f.sleepQuality !== undefined;

  const allChips = [...new Set([...chips, ...f.chips])];
  const toggle = (c: string) => set('chips', f.chips.includes(c) ? f.chips.filter((x) => x !== c) : [...f.chips, c]);
  const addChip = async () => {
    const c = newChip.trim();
    if (!c) return;
    if (!chips.includes(c)) await setSetting('chips', [...chips, c]);
    if (!f.chips.includes(c)) set('chips', [...f.chips, c]);
    setNewChip('');
  };

  const save = async () => {
    const input: CheckInInput = { ...f, relatedDoseId, note: f.note?.trim() || undefined, personId: storedPerson(personId) };
    if (!showSleep) { delete input.sleepHours; delete input.sleepQuality; }
    if (seed.editing) {
      await updateCheckIn(seed.editing.id, input);
      toast('Check-in updated');
    } else {
      const c = await addCheckIn(input);
      toast(`Check-in saved at ${fmtTime(at)}`, { onAction: () => removeCheckIn(c.id) });
    }
    onClose();
  };
  const del = async () => {
    if (!seed.editing) return;
    const id = seed.editing.id;
    await removeCheckIn(id);
    toast('Check-in deleted', { onAction: () => restoreCheckIn(id) });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={seed.editing ? 'Edit check-in' : 'How are you feeling?'}>
      <div className="space-y-5">
        <MoodPicker value={f.mood} onChange={(v) => set('mood', v)} />
        <Rating label="Energy" low="Drained" high="Energised" value={f.energy} onChange={(v) => set('energy', v)} />
        <Rating label="Focus" low="Scattered" high="Sharp" value={f.focus} onChange={(v) => set('focus', v)} />
        <Rating label="Appetite" low="None" high="Very hungry" value={f.appetite} onChange={(v) => set('appetite', v)} />

        {showSleep && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Sleep last night (optional)</span>
              <Stepper label="Hours of sleep" value={f.sleepHours ?? NaN} step={0.5}
                onChange={(v) => set('sleepHours', Number.isFinite(v) ? v : undefined)} suffix="hours" />
            </div>
            <Rating label="Sleep quality" low="Poor" high="Great" value={f.sleepQuality} onChange={(v) => set('sleepQuality', v)} />
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium mb-2">What are you noticing?</legend>
          <div className="flex flex-wrap gap-2">
            {allChips.map((c) => {
              const on = f.chips.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => toggle(c)}
                  className={`min-h-[44px] px-4 rounded-chip border text-sm font-medium transition-colors ${on ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border'}`}>
                  {on && <span aria-hidden="true">✓ </span>}{c}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <label className="flex-1">
              <span className="sr-only">Add your own</span>
              <input value={newChip} onChange={(e) => setNewChip(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } }}
                placeholder="Add your own" className="w-full min-h-[44px] rounded-chip bg-surface-2 border border-border px-4 text-sm" />
            </label>
            <button type="button" onClick={addChip} disabled={!newChip.trim()} aria-label="Add"
              className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center disabled:opacity-40"><Plus size={20} aria-hidden="true" /></button>
          </div>
        </fieldset>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Note (optional)</span>
          <textarea value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} rows={2}
            className="w-full rounded-btn bg-surface-2 border border-border px-3.5 py-3" />
        </label>

        <div className="space-y-1.5">
          <label htmlFor="ci-dose" className="block text-sm font-medium">Linked dose</label>
          <select id="ci-dose" value={relatedDoseId ?? ''} onChange={(e) => { setDoseTouched(true); set('relatedDoseId', e.target.value || undefined); }}
            className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3">
            <option value="">None</option>
            {nearby.map((d) => {
              const m = medName(d);
              return <option key={d.id} value={d.id}>{m ? shownName(m) : 'Dose'} {m ? fmtAmount(d.amount, m.unit) : ''} · {fmtWhen(Date.parse(d.takenAt), at)}</option>;
            })}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 min-h-[48px]">
          {!changeTime ? (
            <>
              <span className="tnum text-muted">{fmtWhen(at, Date.now())}</span>
              <button type="button" onClick={() => setChangeTime(true)} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold">Change time</button>
            </>
          ) : (
            <input type="datetime-local" aria-label="Check-in time" value={toLocalInput(at)} max={toLocalInput(Date.now())}
              onChange={(e) => { const t = fromLocalInput(e.target.value); if (Number.isFinite(t)) set('at', new Date(t).toISOString()); }}
              className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
          )}
        </div>

        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save}>{seed.editing ? 'Save changes' : 'Save check-in'}</Button>
        </SheetActions>
        {seed.editing && <Button variant="danger" className="w-full" onClick={del}>Delete this check-in</Button>}
      </div>
    </Sheet>
  );
}
