import { useEffect, useState } from 'react';
import type { Vital } from '../db/schema';
import { addVital, removeVital, restoreVital, updateVital } from '../db/repos/vitals';
import { storedPerson } from '../db/repos/people';
import { fmtTime, fmtWhen, fromLocalInput, toLocalInput } from '../logic/format';
import { useToast } from '../app/toast';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';

/** "120/80 mmHg · 72 bpm" */
export function fmtVital(v: Pick<Vital, 'systolic' | 'diastolic' | 'heartRate'>): string {
  return [v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic} mmHg` : '', v.heartRate ? `${v.heartRate} bpm` : ''].filter(Boolean).join(' · ');
}

export type VitalsSheetState = { editing?: Vital } | null;

const numCls = 'w-full min-h-[64px] rounded-btn bg-surface-2 border border-border px-3 text-[28px] font-semibold tnum text-center';

/** Log a blood pressure and/or heart rate reading. */
export function VitalsSheet({ state, onClose, personId }: { state: VitalsSheetState; onClose: () => void; personId: string }) {
  const [n, setN] = useState(0);
  useEffect(() => { if (state) setN((x) => x + 1); }, [state]);
  return state ? <VitalsForm key={n} editing={state.editing} onClose={onClose} personId={personId} /> : null;
}

function VitalsForm({ editing, onClose, personId }: { editing?: Vital; onClose: () => void; personId: string }) {
  const toast = useToast();
  const [sys, setSys] = useState(editing?.systolic ? String(editing.systolic) : '');
  const [dia, setDia] = useState(editing?.diastolic ? String(editing.diastolic) : '');
  const [hr, setHr] = useState(editing?.heartRate ? String(editing.heartRate) : '');
  const [when, setWhen] = useState(toLocalInput(editing ? Date.parse(editing.at) : Date.now()));
  const [changeTime, setChangeTime] = useState(!!editing);

  const v = (s: string) => (s.trim() ? Number(s) : undefined);
  const s1 = v(sys), d1 = v(dia), h1 = v(hr);
  const at = changeTime ? fromLocalInput(when) : Date.now();
  let error = '';
  if (s1 === undefined && d1 === undefined && h1 === undefined) error = 'Enter blood pressure, heart rate, or both.';
  else if ((s1 === undefined) !== (d1 === undefined)) error = 'Enter both blood pressure numbers (top and bottom).';
  else if (s1 !== undefined && !(s1 >= 50 && s1 <= 260)) error = 'Check the top number. It’s usually between 70 and 200.';
  else if (d1 !== undefined && !(d1 >= 30 && d1 <= 160)) error = 'Check the bottom number. It’s usually between 40 and 120.';
  else if (s1 !== undefined && d1 !== undefined && s1 <= d1) error = 'The top number is usually the bigger one. Check they’re the right way round.';
  else if (h1 !== undefined && !(h1 >= 20 && h1 <= 250)) error = 'Check the heart rate. It’s usually between 40 and 180.';
  else if (!Number.isFinite(at) || at > Date.now() + 60_000) error = 'Choose a time that has already happened.';

  const save = async () => {
    if (error) return;
    const input = { at: new Date(at).toISOString(), systolic: s1, diastolic: d1, heartRate: h1, personId: editing ? editing.personId : storedPerson(personId) };
    if (editing) { await updateVital(editing.id, input); toast('Reading updated'); }
    else {
      const r = await addVital(input);
      toast(`Saved ${fmtVital(r)} at ${fmtTime(at)}`, { onAction: () => removeVital(r.id) });
    }
    onClose();
  };
  const del = async () => {
    if (!editing) return;
    await removeVital(editing.id);
    toast('Reading deleted', { onAction: () => restoreVital(editing.id) });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={editing ? 'Edit reading' : 'Blood pressure and heart rate'}>
      <div className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium mb-1.5">Blood pressure (mmHg)</legend>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <label><span className="sr-only">Top number (systolic)</span>
              <input type="number" inputMode="numeric" placeholder="120" value={sys} onChange={(e) => setSys(e.target.value)} className={numCls} autoFocus={!editing} /></label>
            <span className="text-3xl text-muted" aria-hidden="true">/</span>
            <label><span className="sr-only">Bottom number (diastolic)</span>
              <input type="number" inputMode="numeric" placeholder="80" value={dia} onChange={(e) => setDia(e.target.value)} className={numCls} /></label>
          </div>
        </fieldset>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">Heart rate (beats per minute)</span>
          <input type="number" inputMode="numeric" placeholder="72" value={hr} onChange={(e) => setHr(e.target.value)} className={numCls} />
        </label>
        <div className="flex items-center justify-between gap-3 min-h-[48px]">
          {!changeTime ? (
            <>
              <span className="tnum text-muted">Now · {fmtTime(Date.now())}</span>
              <button type="button" onClick={() => setChangeTime(true)} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold">Change time</button>
            </>
          ) : (
            <input type="datetime-local" aria-label="Time of reading" value={when} max={toLocalInput(Date.now())} onChange={(e) => setWhen(e.target.value)}
              className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
          )}
        </div>
        {(sys || dia || hr) && error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <p className="text-sm text-muted">For comparable readings, measure seated and rested, at a similar time of day.</p>
        <Button className="w-full min-h-[56px]" onClick={save} disabled={!!error}>{editing ? 'Save changes' : 'Save reading'}</Button>
        {editing && <Button variant="danger" className="w-full" onClick={del}>Delete this reading</Button>}
        {editing && <p className="text-xs text-muted text-center tnum">Recorded {fmtWhen(Date.parse(editing.at), Date.now())}</p>}
      </div>
    </Sheet>
  );
}
