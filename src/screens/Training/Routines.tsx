// Routines: named lists of exercises with sets and reps (e.g. Push, Pull, Legs). Starting one lays out its sets at the
// weights to aim for.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Routine, RoutineItem } from '../../db/schema';
import { useExercises, useFamily, useRoutines, useSettings } from '../../app/data';
import { fromLoad, loadUnit, showLoad } from '../../logic/load';
import { personOf } from '../../db/repos/people';
import { removeRoutine, restoreRoutine, saveRoutine } from '../../db/repos/training';
import { allExercises } from '../../logic/exercises';
import { useToast } from '../../app/toast';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { ExercisePicker } from './TrainingSheets';
import { ActionTagsCard } from '../Tags/ActionTagsCard';

export function Routines() {
  const routines = useRoutines();
  const own = useExercises();
  const fam = useFamily();
  const toast = useToast();
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  if (!routines || !own || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const defs = allExercises(own);
  const mine = routines.filter((r) => !r.deletedAt && personOf(r) === fam.personId);
  return (
    <div className="space-y-2">
      {mine.length === 0 && <p className="border-t border-border pt-5 text-muted">No routines yet. A routine is a list of exercises with sets and reps, like “Push” or “Legs”.</p>}
      <ul>
        {mine.map((r) => (
          <li key={r.id} className="border-t border-border flex items-center gap-2">
            <button type="button" className="flex-1 text-left py-3 min-h-[56px]" onClick={() => setEditing(r)}>
              <span className="block font-medium">{r.name}</span>
              <span className="block text-sm text-muted">{r.items.map((i) => `${defs.find((d) => d.id === i.exerciseId)?.name ?? '?'} ${i.sets}×${i.reps}${i.repsMax ? `–${i.repsMax}` : ""}`).join(', ')}</span>
            </button>
            <button type="button" aria-label={`Delete ${r.name}`} className="w-11 h-11 flex items-center justify-center text-muted" onClick={async () => { await removeRoutine(r.id); toast(`Deleted ${r.name}`, { onAction: () => restoreRoutine(r.id) }); }}><Trash2 size={18} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <Button className="w-full" onClick={() => setEditing('new')}>New routine</Button>
      {editing && <RoutineSheet routine={editing === 'new' ? undefined : editing} personId={fam.personId} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RoutineSheet({ routine, personId, onClose }: { routine?: Routine; personId: string; onClose: () => void }) {
  const own = useExercises() ?? [];
  const units = useSettings()?.units ?? 'metric';
  const toast = useToast();
  const defs = allExercises(own);
  const [name, setName] = useState(routine?.name ?? '');
  const [items, setItems] = useState<RoutineItem[]>(routine?.items ?? []);
  const [picking, setPicking] = useState(false);
  const set = (i: number, patch: Partial<RoutineItem>) => setItems((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Sheet open onClose={onClose} title={routine ? 'Edit routine' : 'New routine'}>
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push" />
        {items.map((it, i) => (
          <fieldset key={i} className="border-t border-border pt-3">
            <legend className="font-medium">{defs.find((d) => d.id === it.exerciseId)?.name ?? 'Exercise'}</legend>
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
              <TextInput label="Sets" type="number" inputMode="numeric" min="1" step="1" value={it.sets} onChange={(e) => set(i, { sets: Number(e.target.value) || 1 })} />
              {defs.find((d) => d.id === it.exerciseId)?.timed
                ? <TextInput label="Seconds" type="number" inputMode="numeric" min="1" step="1" value={it.reps} onChange={(e) => set(i, { reps: Number(e.target.value) || 1 })} />
                : <RepsInput item={it} onChange={(patch) => set(i, patch)} />}
              <TextInput label={`Start ${loadUnit(units)}`} type="number" inputMode="decimal" min="0" step="any" value={it.weightKg !== undefined ? showLoad(it.weightKg, units) : ''} onChange={(e) => set(i, { weightKg: e.target.value ? fromLoad(Number(e.target.value), units) : undefined })} />
              <button type="button" aria-label="Remove" className="w-11 h-11 flex items-center justify-center text-muted" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 size={18} aria-hidden="true" /></button>
            </div>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => setPicking(true)}>Add exercise</Button>
        <p className="text-xs text-muted">Reps: one number, or a range like 8-12</p>
        {routine && <ActionTagsCard action={{ kind: 'routine', routineId: routine.id }} name={routine.name} hint="A tag on your gym bag or locker starts this routine with one tap." />}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim() || !items.length} onClick={async () => { await saveRoutine(personId, { id: routine?.id, name, items }); toast(`Saved ${name.trim()}`); onClose(); }}>Save routine</Button>
        </SheetActions>
      </div>
      {picking && <ExercisePicker own={own} personId={personId} onClose={() => setPicking(false)} onPick={(d) => setItems((p) => [...p, { exerciseId: d.id, sets: 3, reps: d.timed ? 30 : d.bodyweight ? 10 : 8 }])} />}
    </Sheet>
  );
}

/** Reps, or a range like "8-12" (double progression). Typed text is kept while editing. */
function RepsInput({ item, onChange }: { item: RoutineItem; onChange: (p: Partial<RoutineItem>) => void }) {
  const [text, setText] = useState(item.repsMax ? `${item.reps}-${item.repsMax}` : String(item.reps));
  return (
    <TextInput label="Reps or range" inputMode="text" value={text} placeholder="8 or 8-12" onChange={(e) => {
      setText(e.target.value);
      const m = e.target.value.match(/^\s*(\d+)\s*(?:[-–to]+\s*(\d+))?\s*$/);
      if (!m) return;
      const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : undefined;
      if (lo >= 1) onChange({ reps: lo, repsMax: hi && hi > lo ? hi : undefined });
    }} />
  );
}

