// A workout in progress (or one to look back at): each exercise with what to aim for, its sets (weight, reps, how hard,
// done), a rest timer after each set, and at the end the personal bests set.
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Workout, WorkoutSet } from '../../db/schema';
import { useExercises, useFamily, useRoutines, useSettings, useWorkouts } from '../../app/data';
import { finishWorkout, newSetId, removeWorkout, restoreWorkout, saveRoutine, saveWorkout } from '../../db/repos/training';
import { allExercises, type ExerciseDef } from '../../logic/exercises';
import { newPBs, nextTarget, personalBests, working, type Target } from '../../logic/training';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { TextInput } from '../../components/ui/Field';
import { ExercisePicker, PlatesSheet } from './TrainingSheets';

const WHY: Record<Target['why'], string> = {
  up: 'up from last time: every set hit its reps', reps: 'one rep more than last time', same: 'same as last time: build up to every set hitting its reps',
  deload: 'about 10% lighter: two sessions in a row were well short, so build back up', start: 'first time: pick a weight you can do with a couple of reps to spare',
};

export function WorkoutScreen({ id }: { id: string }) {
  const workouts = useWorkouts();
  const own = useExercises();
  const routines = useRoutines();
  const settings = useSettings();
  const fam = useFamily();
  const now = useNow(1000);
  const toast = useToast();
  const [w, setW] = useState<Workout | null>(null);
  const [picking, setPicking] = useState(false);
  const [plates, setPlates] = useState<number | null>(null);
  const [rest, setRest] = useState<{ until: number } | null>(null);
  const [done, setDone] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const loaded = workouts?.find((x) => x.id === id);
  useEffect(() => { if (loaded && !w) setW(loaded); }, [loaded, w]);
  // Opened from an exercise's tag: scroll to that exercise.
  useEffect(() => {
    if (!w) return;
    let target: string | null = null;
    try { target = sessionStorage.getItem('medtap.scrollTo'); sessionStorage.removeItem('medtap.scrollTo'); } catch { /* not available */ }
    if (target) requestAnimationFrame(() => document.getElementById(`ex-${target}`)?.scrollIntoView({ block: 'start' }));
  }, [!!w]);
  useEffect(() => {
    if (rest && now >= rest.until) { setRest(null); try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ } }
  }, [now, rest]);
  if (!workouts || !own || !settings || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  if (!loaded || !w) return <p className="border-t border-border pt-5">This workout doesn't exist any more. <a className="underline" href="#/training">Back to Training</a></p>;
  const defs = allExercises(own);
  const others = workouts.filter((x) => x.id !== w.id && (x.personId ?? 'me') === (w.personId ?? 'me'));
  const update = (next: Workout) => { setW(next); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { void saveWorkout(next); }, 300); };
  const setSet = (sid: string, patch: Partial<WorkoutSet>) => update({ ...w, sets: w.sets.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const order = [...new Set(w.sets.map((s) => s.exerciseId))];
  const finished = !!w.endedAt;
  const mins = Math.round(((w.endedAt ? Date.parse(w.endedAt) : now) - Date.parse(w.startedAt)) / 60_000);
  const pbs = newPBs(w, [...others, w], defs);

  return (
    <div className="space-y-2 pb-40">
      <p className="text-sm text-muted tnum">{w.name ? `${w.name} · ` : ''}{format(Date.parse(w.startedAt), 'EEE d MMM, h:mm a')} · {mins} min{finished ? '' : ' so far'}</p>
      {order.map((exId) => {
        const def = defs.find((d) => d.id === exId) ?? { id: exId, name: 'Exercise', muscles: [], pattern: 'push' as const, increment: 2.5 };
        const sets = w.sets.filter((s) => s.exerciseId === exId);
        // The same aim the sets were laid out from: the routine's sets and reps when started from one.
        const t = nextTarget(def, others, routines?.find((r) => r.id === w.routineId)?.items.find((i) => i.exerciseId === exId));
        const pb = personalBests(exId, others);
        return (
          <section key={exId} id={`ex-${exId}`} className="border-t border-border pt-4 pb-2 scroll-mt-16" aria-label={def.name}>
            <div className="flex items-baseline justify-between gap-3">
              <a href={`#/training/exercise/${exId}`} className="text-[19px] font-medium">{def.name}</a>
              {pb.e1rm && <span className="text-xs text-muted tnum">Best est. max {pb.e1rm.v} kg</span>}
            </div>
            {!finished && t.why !== 'start' && <p className="text-sm text-muted tnum">Aim: {t.sets} × {t.reps}{t.weightKg ? ` at ${t.weightKg} kg` : ''} ({WHY[t.why]})</p>}
            {!finished && t.why === 'start' && <p className="text-sm text-muted">{WHY.start}</p>}
            <div className="grid grid-cols-[2rem_1fr_1fr_4.5rem_3rem] gap-2 items-center mt-2 text-xs text-muted">
              <span>Set</span><span>kg</span><span>Reps</span><span>RPE</span><span className="sr-only">Done</span>
            </div>
            {sets.map((s, i) => (
              <div key={s.id} className="grid grid-cols-[2rem_1fr_1fr_4.5rem_3rem] gap-2 items-center mt-1.5">
                <button type="button" className={`text-sm tnum ${s.warmup ? 'text-muted' : ''}`} aria-label={s.warmup ? 'Warm-up set; tap to make it a working set' : `Set ${i + 1}; tap to mark as warm-up`} onClick={() => setSet(s.id, { warmup: !s.warmup })}>{s.warmup ? 'W' : i + 1 - sets.slice(0, i).filter((x) => x.warmup).length}</button>
                <input aria-label={`Set ${i + 1} weight`} type="number" inputMode="decimal" min="0" step="any" value={s.weightKg || ''} placeholder="0" onChange={(e) => setSet(s.id, { weightKg: Number(e.target.value) || 0 })} onDoubleClick={() => setPlates(s.weightKg)} className="min-h-[44px] rounded-btn border border-border-strong bg-transparent px-2 tnum text-center" />
                <input aria-label={`Set ${i + 1} reps`} type="number" inputMode="numeric" min="0" step="1" value={s.reps || ''} placeholder="0" onChange={(e) => setSet(s.id, { reps: Number(e.target.value) || 0 })} className="min-h-[44px] rounded-btn border border-border-strong bg-transparent px-2 tnum text-center" />
                <select aria-label={`Set ${i + 1} how hard (RPE)`} value={s.rpe ?? ''} onChange={(e) => setSet(s.id, { rpe: e.target.value ? Number(e.target.value) : undefined })} className="min-h-[44px] rounded-btn border border-border-strong bg-transparent px-1 text-sm">
                  <option value="">–</option>{[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <button type="button" aria-label={s.done ? `Set ${i + 1} done; tap to undo` : `Mark set ${i + 1} done`} aria-pressed={s.done}
                  onClick={() => { setSet(s.id, { done: !s.done }); if (!s.done && settings.restSeconds > 0 && !finished) setRest({ until: Date.now() + settings.restSeconds * 1000 }); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center border ${s.done ? 'bg-text text-bg border-text' : 'border-border-strong'}`}><Check size={18} aria-hidden="true" /></button>
              </div>
            ))}
            <div className="flex gap-4 mt-2">
              <button type="button" className="min-h-[44px] text-sm font-medium underline underline-offset-4" onClick={() => {
                const last = sets[sets.length - 1];
                update({ ...w, sets: [...w.sets, { id: newSetId(), exerciseId: exId, weightKg: last?.weightKg ?? t.weightKg, reps: last?.reps ?? t.reps, done: false }] });
              }}>Add set</button>
              <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => setPlates(sets.find((x) => !x.done)?.weightKg ?? sets[0]?.weightKg ?? 0)}>Plates</button>
              {sets.length > 0 && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => update({ ...w, sets: w.sets.filter((x) => x.exerciseId !== exId) })}>Remove</button>}
            </div>
          </section>
        );
      })}
      <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => setPicking(true)}><Plus size={18} aria-hidden="true" /> Add exercise</Button>
      <label className="block border-t border-border pt-4 space-y-1.5">
        <span className="block text-sm font-medium">Note (optional)</span>
        <textarea value={w.note ?? ''} rows={2} onChange={(e) => update({ ...w, note: e.target.value || undefined })} className="w-full rounded-btn border border-border-strong bg-transparent px-3.5 py-3" />
      </label>

      {/* The rest timer sits above Finish, so finishing never waits for the timer. */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-bg border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {rest && (
          <div className="bg-text text-bg" role="timer" aria-live="off">
            <div className="mx-auto max-w-[560px] px-6 py-2 flex items-center gap-3">
              <span className="flex-1 text-lg tnum">Rest {Math.max(0, Math.ceil((rest.until - now) / 1000))} s</span>
              <button type="button" className="min-h-[44px] px-3 font-medium" onClick={() => setRest({ until: rest.until + 30_000 })}>+30 s</button>
              <button type="button" className="min-h-[44px] px-3 font-medium underline" onClick={() => setRest(null)}>Skip</button>
            </div>
          </div>
        )}
          <div className="mx-auto max-w-[560px] px-6 py-3 flex gap-2">
            {finished ? <Button variant="secondary" className="flex-1" onClick={() => go('/training')}>Done</Button> : (
              <Button className="flex-1 min-h-[52px]" onClick={async () => { await saveWorkout(w); await finishWorkout(w.id); setW({ ...w, endedAt: new Date().toISOString() }); setDone(true); }}>Finish workout</Button>
            )}
            <button type="button" aria-label="Delete workout" className="w-12 h-12 flex items-center justify-center text-muted" onClick={async () => {
              await removeWorkout(w.id); toast('Workout deleted', { onAction: () => restoreWorkout(w.id) }); replace('/training');
            }}><Trash2 size={20} aria-hidden="true" /></button>
          </div>
      </div>

      {picking && <ExercisePicker own={own} personId={fam.personId} onClose={() => setPicking(false)} onPick={(d: ExerciseDef) => {
        const t = nextTarget(d, others);
        update({ ...w, sets: [...w.sets, ...Array.from({ length: t.sets }, () => ({ id: newSetId(), exerciseId: d.id, weightKg: t.weightKg, reps: t.reps, done: false }))] });
      }} />}
      {plates !== null && <PlatesSheet initial={plates} barKg={settings.barKg} onClose={() => setPlates(null)} />}
      {done && <SummarySheet w={w} pbs={pbs.map((p) => `${defs.find((d) => d.id === p.exerciseId)?.name}: ${p.text}`)} personId={fam.personId} onClose={() => { setDone(false); go('/training'); }} />}
    </div>
  );
}

function SummarySheet({ w, pbs, personId, onClose }: { w: Workout; pbs: string[]; personId: string; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(w.name ?? 'My routine');
  const ws = working(w.sets);
  const vol = Math.round(ws.reduce((n, s) => n + s.weightKg * s.reps, 0));
  const mins = Math.round(((w.endedAt ? Date.parse(w.endedAt) : Date.now()) - Date.parse(w.startedAt)) / 60_000);
  const items = [...new Set(ws.map((s) => s.exerciseId))].map((exerciseId) => {
    const sets = ws.filter((s) => s.exerciseId === exerciseId);
    return { exerciseId, sets: sets.length, reps: Math.max(...sets.map((s) => s.reps)), weightKg: Math.max(...sets.map((s) => s.weightKg)) };
  });
  return (
    <Sheet open onClose={onClose} title="Workout done">
      <div className="space-y-4">
        <p className="text-[17px] tnum">{mins} min · {ws.length} set{ws.length === 1 ? '' : 's'} · {vol.toLocaleString('en-AU')} kg moved</p>
        {pbs.length > 0 ? (
          <div><p className="font-medium">Personal bests</p><ul className="text-[15px] space-y-0.5">{pbs.map((p) => <li key={p}>{p}</li>)}</ul></div>
        ) : <p className="text-[15px] text-muted">No new personal bests this time.</p>}
        {!w.routineId && items.length > 0 && (
          <div className="border-t border-border pt-3 space-y-2">
            <TextInput label="Save as a routine (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="secondary" onClick={async () => { await saveRoutine(personId, { name, items }); toast(`Saved “${name}”`); }}>Save routine</Button>
          </div>
        )}
        <SheetActions><Button className="w-full min-h-[56px]" onClick={onClose}>Done</Button></SheetActions>
      </div>
    </Sheet>
  );
}
