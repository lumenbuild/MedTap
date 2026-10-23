// Routines: named lists of exercises with sets and reps (e.g. Push, Pull, Legs). Starting one lays out its sets at the
// weights to aim for.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Routine, RoutineItem } from '../../db/schema';
import { useExercises, useFamily, useRoutines } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { removeRoutine, restoreRoutine, saveRoutine } from '../../db/repos/training';
import { allExercises } from '../../logic/exercises';
import { useToast } from '../../app/toast';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { ExercisePicker } from './TrainingSheets';

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
              <span className="block text-sm text-muted">{r.items.map((i) => `${defs.find((d) => d.id === i.exerciseId)?.name ?? '?'} ${i.sets}×${i.reps}`).join(', ')}</span>
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
              <TextInput label="Reps" type="number" inputMode="numeric" min="1" step="1" value={it.reps} onChange={(e) => set(i, { reps: Number(e.target.value) || 1 })} />
              <TextInput label="Start kg" type="number" inputMode="decimal" min="0" step="any" value={it.weightKg ?? ''} onChange={(e) => set(i, { weightKg: e.target.value ? Number(e.target.value) : undefined })} />
              <button type="button" aria-label="Remove" className="w-11 h-11 flex items-center justify-center text-muted" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 size={18} aria-hidden="true" /></button>
            </div>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => setPicking(true)}>Add exercise</Button>
        <p className="text-xs text-muted">After the first time, each session aims from what you did last: up when every set hits its reps.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim() || !items.length} onClick={async () => { await saveRoutine(personId, { id: routine?.id, name, items }); toast(`Saved ${name.trim()}`); onClose(); }}>Save routine</Button>
        </SheetActions>
      </div>
      {picking && <ExercisePicker own={own} personId={personId} onClose={() => setPicking(false)} onPick={(d) => setItems((p) => [...p, { exerciseId: d.id, sets: 3, reps: d.bodyweight ? 10 : 8 }])} />}
    </Sheet>
  );
}
