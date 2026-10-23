// Sheets for the Training tab: start a workout, pick an exercise (or add your own), log cardio, set a fitness goal,
// and the plate calculator.
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { CardioActivity, Exercise, FitnessGoal, MuscleGroup, Routine, Workout } from '../../db/schema';
import { addExercise, logCardio, newSetId, setFitnessGoal, startWorkout, restoreFitnessGoals } from '../../db/repos/training';
import { allExercises, EQUIPMENT, MUSCLES, type Equipment, type ExerciseDef } from '../../logic/exercises';
import { useSettings } from '../../app/data';
import { fromLoad, loadUnit, showLoad } from '../../logic/load';
import { platesFor, platesForUnits, working } from '../../logic/training';
import { plannedSets } from '../../logic/tagActions';
import { useTrainingContext } from './useTrainingContext';
import { go } from '../../app/router';
import { useToast } from '../../app/toast';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Select, TextInput } from '../../components/ui/Field';

export const ACTIVITIES: { id: CardioActivity; name: string }[] = [
  { id: 'run', name: 'Run' }, { id: 'walk', name: 'Walk' }, { id: 'ride', name: 'Ride' }, { id: 'swim', name: 'Swim' }, { id: 'row', name: 'Row' }, { id: 'other', name: 'Other' },
];

/** Start from a routine (sets laid out at the weights to aim for) or an empty workout. */
export function StartSheet({ personId, routines, workouts, own, onClose }: { personId: string; routines: Routine[]; workouts: Workout[]; own: Exercise[]; onClose: () => void }) {
  const units = useSettings()?.units ?? 'metric';
  const now = Date.now();
  const ctx = useTrainingContext(personId, now);
  const defs = allExercises(own);
  // The last 3 different sessions (by name and lifts), each repeatable like a routine.
  const recent: Routine[] = [];
  const seen = new Set<string>();
  for (const w of workouts.filter((x) => !x.deletedAt && !x.cardio && x.endedAt && working(x.sets).length).sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const ids = [...new Set(working(w.sets).map((x) => x.exerciseId))];
    const key = `${w.name ?? ''}|${ids.join(',')}`;
    if (seen.has(key) || recent.length >= 3) continue;
    seen.add(key);
    recent.push({ id: '', name: w.name ?? 'Workout', createdAt: w.startedAt, updatedAt: w.startedAt, items: ids.map((id) => {
      // As done at the top weight (lighter sets are taken as warm-ups).
      const ss = working(w.sets).filter((x) => x.exerciseId === id);
      const top = Math.max(...ss.map((x) => x.weightKg));
      const atTop = ss.filter((x) => x.weightKg === top);
      return { exerciseId: id, sets: atTop.length, reps: Math.max(...atTop.map((x) => x.reps)), weightKg: top };
    }) });
  }
  const begin = async (r?: Routine) => {
    const sets = r ? r.items.flatMap((it) => {
      const def = defs.find((d) => d.id === it.exerciseId) ?? { id: it.exerciseId, name: '', muscles: [], pattern: 'push' as const, increment: 2.5 };
      return plannedSets(def, workouts, it, newSetId, units, ctx ? { ...ctx, now } : undefined);
    }) : [];
    const w = await startWorkout(personId, { routine: r?.id ? r : undefined, name: r?.name, sets });
    onClose();
    go(`/training/workout/${w.id}`);
  };
  return (
    <Sheet open onClose={onClose} title="Start a workout">
      <ul>
        {routines.map((r) => (
          <li key={r.id} className="border-t border-border">
            <button type="button" className="w-full text-left py-3 min-h-[56px]" onClick={() => begin(r)}>
              <span className="block font-medium">{r.name}</span>
              <span className="block text-sm text-muted">{r.items.map((i) => defs.find((d) => d.id === i.exerciseId)?.name).filter(Boolean).join(', ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {routines.length === 0 && <p className="text-sm text-muted">No routines yet. Start an empty workout, then save it as a routine at the end.</p>}
      {recent.length > 0 && <h3 className="text-sm font-medium text-muted mt-4 mb-1">Repeat a recent session</h3>}
      <ul>
        {recent.map((r) => (
          <li key={r.createdAt} className="border-t border-border">
            <button type="button" className="w-full text-left py-3 min-h-[56px]" onClick={() => begin(r)}>
              <span className="block font-medium">{r.name} <span className="text-sm text-muted font-normal">{format(Date.parse(r.createdAt), 'EEE d MMM')}</span></span>
              <span className="block text-sm text-muted">{r.items.map((i) => defs.find((d) => d.id === i.exerciseId)?.name).filter(Boolean).join(', ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {(routines.length > 0 || recent.length > 0) && <p className="text-xs text-muted mt-2">Sets are laid out at the weights to aim for: from last time, how hard it felt{ctx?.readiness != null ? ` and today’s readiness (${ctx.readiness})` : ''}.</p>}
      <SheetActions>
        <Button className="w-full min-h-[56px]" onClick={() => begin()}>Empty workout</Button>
        <Button variant="secondary" className="w-full" onClick={() => { onClose(); go('/training/routines'); }}>Routines</Button>
      </SheetActions>
    </Sheet>
  );
}

/** Search the exercises, or add one of your own. */
export function ExercisePicker({ own, personId, onPick, onClose, title = 'Add an exercise' }: { own: Exercise[]; personId: string; onPick: (d: ExerciseDef) => void; onClose: () => void; title?: string }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const defs = useMemo(() => allExercises(own).sort((a, b) => a.name.localeCompare(b.name)), [own]);
  const shown = defs.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase()));
  if (adding) return <NewExerciseSheet personId={personId} name={q} onDone={(d) => { onPick(d); onClose(); }} onClose={() => setAdding(false)} />;
  return (
    <Sheet open onClose={onClose} title={title}>
      <TextInput label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. squat" />
      <ul className="mt-2">
        {shown.map((d) => (
          <li key={d.id} className="border-t border-border">
            <button type="button" className="w-full text-left py-3 min-h-[48px]" onClick={() => { onPick(d); onClose(); }}>
              <span className="block">{d.name}</span>
              <span className="block text-xs text-muted">{d.muscles.map((m) => MUSCLES.find((x) => x.id === m)?.name).join(', ')}</span>
            </button>
          </li>
        ))}
      </ul>
      <SheetActions><Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>{q.trim() ? `Add “${q.trim()}”` : 'Add your own exercise'}</Button></SheetActions>
    </Sheet>
  );
}

function NewExerciseSheet({ personId, name: initial, onDone, onClose }: { personId: string; name: string; onDone: (d: ExerciseDef) => void; onClose: () => void }) {
  const units = useSettings()?.units ?? 'metric';
  const [name, setName] = useState(initial);
  const [muscle, setMuscle] = useState<MuscleGroup>('chest');
  const [pattern, setPattern] = useState<'push' | 'pull' | 'legs' | 'core'>('push');
  const [equipment, setEquipment] = useState<Equipment>('machine');
  const [timed, setTimed] = useState(false);
  const [inc, setInc] = useState(units === 'imperial' ? '5' : '2.5');
  const bodyweight = equipment === 'bodyweight';
  return (
    <Sheet open onClose={onClose} title="Your own exercise">
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Main muscle" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup)}>
            {MUSCLES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Select label="Movement" value={pattern} onChange={(e) => setPattern(e.target.value as typeof pattern)}>
            <option value="push">Push</option><option value="pull">Pull</option><option value="legs">Legs</option><option value="core">Core</option>
          </Select>
        </div>
        <Select label="Equipment" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
          {EQUIPMENT.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        {equipment === 'dumbbell' && <p className="text-sm text-muted -mt-2">Log the weight of one dumbbell.</p>}
        <TextInput label={`Go up by (${loadUnit(units)}) when it's time`} type="number" inputMode="decimal" min="0" step="any" value={inc} onChange={(e) => setInc(e.target.value)} help={timed ? 'Held for time: 5 seconds more instead.' : '0 to add a rep instead.'} />
        <label className="flex items-center gap-3 min-h-[48px]"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" /> Held for time (log seconds, not reps)</label>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim()} onClick={async () => {
            const increment = Number(inc) > 0 ? fromLoad(Number(inc), units) : 0;
            const e = await addExercise(personId, { name, muscles: [muscle], pattern, bodyweight, increment, equipment, perHand: equipment === 'dumbbell', timed });
            onDone({ id: e.id, name: e.name, muscles: e.muscles, pattern, bodyweight, increment, equipment, perHand: equipment === 'dumbbell', timed });
          }}>Add exercise</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

export function CardioSheet({ personId, onClose, initial = 'run' }: { personId: string; onClose: () => void; initial?: CardioActivity }) {
  const toast = useToast();
  const [activity, setActivity] = useState<CardioActivity>(initial);
  const [km, setKm] = useState('');
  const [min, setMin] = useState('');
  const [when, setWhen] = useState(format(Date.now(), "yyyy-MM-dd'T'HH:mm"));
  const ok = Number(min) > 0 && (km === '' || Number(km) > 0);
  return (
    <Sheet open onClose={onClose} title="Log cardio">
      <div className="space-y-4">
        <Select label="Activity" value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>{ACTIVITIES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Distance (km)" type="number" inputMode="decimal" min="0" step="any" value={km} onChange={(e) => setKm(e.target.value)} />
          <TextInput label="Time (minutes)" type="number" inputMode="decimal" min="0" step="any" value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
        <TextInput label="When" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!ok} onClick={async () => {
            await logCardio(personId, new Date(when).toISOString(), { activity, distanceKm: km ? Number(km) : undefined, durationMin: Number(min) });
            toast(`${ACTIVITIES.find((a) => a.id === activity)!.name} logged`);
            onClose();
          }}>Save</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

export function GoalSheet({ personId, own, existing, preset, onClose }: { personId: string; own: Exercise[]; existing?: FitnessGoal; preset?: Partial<FitnessGoal>; onClose: () => void }) {
  const toast = useToast();
  const units = useSettings()?.units ?? 'metric';
  const defs = allExercises(own).sort((a, b) => a.name.localeCompare(b.name));
  const init = existing ?? preset;
  const [kind, setKind] = useState<FitnessGoal['kind']>(init?.kind ?? 'lift');
  const [exerciseId, setExerciseId] = useState(init?.exerciseId ?? 'squat');
  const [kg, setKg] = useState(existing?.targetKg ? String(showLoad(existing.targetKg, units)) : '');
  const [reps, setReps] = useState(String(existing?.reps ?? 1));
  const [activity, setActivity] = useState<CardioActivity>(existing?.activity ?? 'run');
  const [km, setKm] = useState(existing?.distanceKm ? String(existing.distanceKm) : '5');
  const [min, setMin] = useState(existing?.targetMin ? String(existing.targetMin) : '');
  const [perWeek, setPerWeek] = useState(String(existing?.perWeek ?? 3));
  const [date, setDate] = useState(existing?.targetDate ?? '');
  const valid = kind === 'lift' ? Number(kg) > 0 && Number(reps) >= 1 : kind === 'cardio' ? Number(km) > 0 && Number(min) > 0 : Number(perWeek) >= 1;
  const save = async () => {
    const g: FitnessGoal = { id: existing?.id ?? crypto.randomUUID(), kind, setAt: existing?.setAt ?? new Date().toISOString(), targetDate: date || undefined,
      ...(kind === 'lift' ? { exerciseId, targetKg: fromLoad(Number(kg), units), reps: Number(reps) } : kind === 'cardio' ? { activity, distanceKm: Number(km), targetMin: Number(min) } : { perWeek: Number(perWeek) }) };
    const before = await setFitnessGoal(personId, g);
    toast('Goal saved', { onAction: () => restoreFitnessGoals(personId, before) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={existing ? 'Edit goal' : 'New training goal'}>
      <div className="space-y-4">
        <Select label="Goal" value={kind} onChange={(e) => setKind(e.target.value as FitnessGoal['kind'])}>
          <option value="lift">A lift</option><option value="cardio">A cardio time</option><option value="sessions">Sessions a week</option>
        </Select>
        {kind === 'lift' && (
          <>
            <Select label="Exercise" value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>{defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={`Weight (${loadUnit(units)})`} type="number" inputMode="decimal" min="0" step="any" value={kg} onChange={(e) => setKg(e.target.value)} />
              <TextInput label="For reps" type="number" inputMode="numeric" min="1" step="1" value={reps} onChange={(e) => setReps(e.target.value)} help="1 = a one-rep max" />
            </div>
          </>
        )}
        {kind === 'cardio' && (
          <>
            <Select label="Activity" value={activity} onChange={(e) => setActivity(e.target.value as CardioActivity)}>{ACTIVITIES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <div className="grid grid-cols-2 gap-3">
              <TextInput label="Distance (km)" type="number" inputMode="decimal" min="0" step="any" value={km} onChange={(e) => setKm(e.target.value)} />
              <TextInput label="In (minutes)" type="number" inputMode="decimal" min="0" step="any" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
          </>
        )}
        {kind === 'sessions' && <TextInput label="Workouts a week" type="number" inputMode="numeric" min="1" max="14" step="1" value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />}
        {kind !== 'sessions' && <TextInput label="By (optional)" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!valid} onClick={save}>Save goal</Button>
          {existing && <Button variant="secondary" className="w-full" onClick={async () => { const before = await setFitnessGoal(personId, existing, true); toast('Goal removed', { onAction: () => restoreFitnessGoals(personId, before) }); onClose(); }}>Remove goal</Button>}
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** Which plates go on each side of the bar for a weight, in the person's units. `initial` and `barKg` are kg. */
export function PlatesSheet({ initial, barKg, onClose }: { initial?: number; barKg: number; onClose: () => void }) {
  const units = useSettings()?.units ?? 'metric';
  const u = loadUnit(units);
  const plates = platesForUnits(units);
  const [total, setTotal] = useState(initial ? String(showLoad(initial, units)) : '');
  // The bar in the person's unit, snapped to a standard one (20 kg ↔ 45 lb).
  const [bar, setBar] = useState(String(units === 'imperial' ? Math.round(showLoad(barKg, units) / 5) * 5 : barKg));
  const r = Number(total) > 0 ? platesFor(Number(total), Number(bar) || 0, plates) : null;
  return (
    <Sheet open onClose={onClose} title="Plates">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TextInput label={`Total (${u})`} type="number" inputMode="decimal" min="0" step="any" value={total} onChange={(e) => setTotal(e.target.value)} />
          <TextInput label={`Bar (${u})`} type="number" inputMode="decimal" min="0" step="any" value={bar} onChange={(e) => setBar(e.target.value)} />
        </div>
        {r && (Number(total) < Number(bar) ? <p>Less than the bar.</p> : (
          <div>
            <p className="text-sm text-muted">Each side</p>
            <p className="text-2xl font-medium tnum">{r.perSide.length ? r.perSide.join(' + ') : 'Just the bar'}</p>
            {r.leftover > 0 && <p className="text-sm text-caution">{r.leftover} {u} can't be made with {plates.join(', ')} {u} plates. Nearest: {Number(total) - r.leftover} {u}.</p>}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
