// A workout in progress (or one to look back at): each exercise with what to aim for, its sets (weight, reps or seconds,
// how hard, done), a rest timer worked out for each set (and a notification when the phone's locked), supersets, swaps
// for a busy machine, form cues, and at the end the personal bests set. Weights in the person's units.
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Workout, WorkoutSet } from '../../db/schema';
import { useExercises, useFamily, useRoutines, useSettings, useWorkouts } from '../../app/data';
import { finishWorkout, newSetId, removeWorkout, restoreWorkout, saveRoutine, saveWorkout } from '../../db/repos/training';
import { allExercises, swapsFor, type ExerciseDef } from '../../logic/exercises';
import { newPBs, nextTarget, personalBests, restFor, working } from '../../logic/training';
import { adjustAfterSet, smartTarget, type SmartTarget } from '../../logic/progression';
import { useTrainingContext } from './useTrainingContext';
import { pbWithinReach, warmupSets } from '../../logic/trainingExtras';
import { plannedSets } from '../../logic/tagActions';
import { fmtLoad, fromLoad, loadUnit, showLoad } from '../../logic/load';
import type { Units } from '../../db/repos/settings';
import { cancelRestEnd, scheduleRestEnd } from '../../app/native';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { TextInput } from '../../components/ui/Field';
import { ExercisePicker, PlatesSheet } from './TrainingSheets';

const loadedPerson = (ws: Workout[] | undefined, id: string) => { const w = ws?.find((x) => x.id === id); return w ? (w.personId ?? 'me') : undefined; };
const FALLBACK = (id: string): ExerciseDef => ({ id, name: 'Exercise', muscles: [], pattern: 'push', increment: 2.5 });
const LETTERS = 'ABCDEFGH';

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
  const [rest, setRest] = useState<{ until: number; why: string; next?: string } | null>(null);
  const [cues, setCues] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const today = useTrainingContext(loadedPerson(workouts, id), Date.now());
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
    if (rest && now >= rest.until) { setRest(null); void cancelRestEnd(); try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ } }
  }, [now, rest]);
  if (!workouts || !own || !settings || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  if (!loaded || !w) return <p className="border-t border-border pt-5">This workout doesn't exist any more. <a className="underline" href="#/training">Back to Training</a></p>;
  const units = settings.units;
  const u = loadUnit(units);
  const defs = allExercises(own);
  const defOf = (exId: string) => defs.find((d) => d.id === exId) ?? FALLBACK(exId);
  const others = workouts.filter((x) => x.id !== w.id && (x.personId ?? 'me') === (w.personId ?? 'me'));
  const update = (next: Workout) => { setW(next); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { void saveWorkout(next); }, 300); };
  const setSet = (sid: string, patch: Partial<WorkoutSet>) => update({ ...w, sets: w.sets.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const order = [...new Set(w.sets.map((s) => s.exerciseId))];
  const groups = [...new Set(w.sets.map((s) => s.group).filter(Boolean))] as string[];
  const groupOf = (exId: string) => w.sets.find((s) => s.exerciseId === exId)?.group;
  const finished = !!w.endedAt;
  const mins = Math.round(((w.endedAt ? Date.parse(w.endedAt) : now) - Date.parse(w.startedAt)) / 60_000);
  const pbs = newPBs(w, [...others, w], defs, units);
  const routineItem = (exId: string) => routines?.find((r) => r.id === w.routineId)?.items.find((i) => i.exerciseId === exId);
  // Today's aim for each exercise: the smart target, judged as at the start of this workout.
  const aimFor = (def: ExerciseDef): SmartTarget => smartTarget(def, others, { item: routineItem(def.id), units, readiness: today?.readiness, weakDay: today?.weakDay, lighter: today?.lighter, now: Date.parse(w.startedAt) });

  /** Clearly too easy or too hard: change the weight of this exercise's remaining sets at that weight (with Undo). */
  const adjustFrom = (cur: Workout, s: WorkoutSet, def: ExerciseDef): Workout => {
    if (finished || !settings.autoAdjust) return cur;
    const adj = adjustAfterSet(def, s, aimFor(def).reps, units);
    const later = cur.sets.filter((x) => x.exerciseId === s.exerciseId && !x.done && !x.warmup && Math.abs(x.weightKg - s.weightKg) < 0.01);
    if (!adj || !later.length) return cur;
    const ids = new Set(later.map((x) => x.id));
    toast(`${adj.text}: next ${later.length === 1 ? 'set' : `${later.length} sets`} ${adj.weightKg > s.weightKg ? 'up' : 'down'} to ${fmtLoad(adj.weightKg, units)}`, { onAction: () => update(cur) });
    return { ...cur, sets: cur.sets.map((x) => (ids.has(x.id) ? { ...x, weightKg: adj.weightKg } : x)) };
  };

  /** Tick a set: start the rest worked out for it, or (in a superset) go straight to the partner's next set. */
  const tick = (s: WorkoutSet, def: ExerciseDef) => {
    const nowDone = !s.done;
    let next = { ...w, sets: w.sets.map((x) => (x.id === s.id ? { ...x, done: nowDone } : x)) };
    if (nowDone) next = adjustFrom(next, { ...s, done: true }, def);
    update(next);
    if (!nowDone || finished || settings.restSeconds <= 0) return;
    const partner = s.group ? next.sets.find((x) => x.group === s.group && x.exerciseId !== s.exerciseId && !x.done) : undefined;
    const r = s.warmup ? { seconds: Math.min(60, settings.restSeconds), why: 'warm-up' } : settings.smartRest ? restFor(def, s, settings.restSeconds, !!partner) : { seconds: settings.restSeconds, why: '' };
    const upcoming = partner ?? next.sets.find((x) => !x.done && (x.exerciseId === s.exerciseId || (s.group && x.group === s.group))) ?? next.sets.find((x) => !x.done);
    const nd = upcoming ? defOf(upcoming.exerciseId) : undefined;
    const nextText = upcoming && nd ? `Next: ${nd.name}${upcoming.weightKg ? `, ${fmtLoad(upcoming.weightKg, units)}${nd.perHand ? ' each' : ''}` : ''} × ${upcoming.reps}${nd.timed ? ' s' : ''}` : undefined;
    const until = Date.now() + r.seconds * 1000;
    setRest({ until, why: r.why, next: nextText });
    void scheduleRestEnd(until, nextText ?? 'Time for your next set');
  };
  const skipRest = () => { setRest(null); void cancelRestEnd(); };

  const superset = (exId: string) => {
    const i = order.indexOf(exId);
    const partner = order[i + 1];
    if (!partner) return;
    const g = groupOf(exId) ?? crypto.randomUUID().slice(0, 8);
    update({ ...w, sets: w.sets.map((x) => (x.exerciseId === exId || x.exerciseId === partner ? { ...x, group: g } : x)) });
    toast(`${defOf(exId).name} and ${defOf(partner).name} are a superset: rest after each round`);
  };
  const unsuperset = (g: string) => update({ ...w, sets: w.sets.map((x) => (x.group === g ? { ...x, group: undefined } : x)) });

  const swap = (from: string, to: ExerciseDef) => {
    const left = w.sets.filter((x) => x.exerciseId === from && !x.done);
    const g = groupOf(from);
    const fresh = plannedSets(to, others, undefined, newSetId, units).slice(0, Math.max(1, left.length)).map((x) => ({ ...x, group: g }));
    const keep = w.sets.filter((x) => !(x.exerciseId === from && !x.done));
    const at = w.sets.findIndex((x) => x.exerciseId === from);
    update({ ...w, sets: [...keep.slice(0, at), ...fresh, ...keep.slice(at)] });
    toast(`Swapped to ${to.name}`);
  };

  return (
    <div className="space-y-2 pb-44">
      <p className="text-sm text-muted tnum">{w.name ? `${w.name} · ` : ''}{format(Date.parse(w.startedAt), 'EEE d MMM, h:mm a')} · {mins} min{finished ? '' : ' so far'}</p>
      {order.map((exId) => {
        const def = defOf(exId);
        const sets = w.sets.filter((s) => s.exerciseId === exId);
        // The same aim the sets were laid out from: the routine's sets and reps when started from one.
        const t = aimFor(def);
        const pb = personalBests(exId, others);
        const g = groupOf(exId);
        const gi = g ? groups.indexOf(g) : -1;
        const inGroup = g ? order.filter((x) => groupOf(x) === g) : [];
        const repsLabel = def.timed ? 'Seconds' : 'Reps';
        const best = def.timed ? (pb.mostReps ? `Longest ${pb.mostReps.reps} s` : '') : pb.e1rm ? `Best est. max ${fmtLoad(pb.e1rm.v, units)}` : pb.mostReps ? `Most reps ${pb.mostReps.reps}` : '';
        const aimLoad = t.weightKg ? ` at ${fmtLoad(t.weightKg, units)}${def.perHand ? ' each' : ''}` : '';
        return (
          <section key={exId} id={`ex-${exId}`} className="border-t border-border pt-4 pb-2 scroll-mt-16" aria-label={def.name}>
            {g && <p className="text-xs font-medium text-muted uppercase tracking-wide">Superset {LETTERS[gi]}{inGroup.indexOf(exId) + 1}</p>}
            <div className="flex items-baseline justify-between gap-3">
              <a href={`#/training/exercise/${exId}`} className="text-[19px] font-medium">{def.name}</a>
              {best && <span className="text-xs text-muted tnum">{best}</span>}
            </div>
            {!finished && t.why !== 'start' && <p className={`text-sm tnum ${t.why === 'push' ? 'font-medium' : 'text-muted'}`}>{t.why === 'push' ? 'Push: ' : t.why === 'hold' ? 'Hold: ' : 'Aim: '}{t.sets} × {t.reps}{def.timed ? ' s' : ''}{aimLoad}</p>}
            {!finished && <p className="text-sm text-muted">{t.reason}{t.plain && t.plain.weightKg !== t.weightKg ? ` (Usual step: ${fmtLoad(t.plain.weightKg, units)}.)` : ''}</p>}
            {!finished && (() => {
              const nextSet = sets.find((x) => !x.done && !x.warmup);
              const pbText = nextSet && !def.timed ? pbWithinReach(exId, others, nextSet.weightKg, nextSet.reps, units) : null;
              return pbText ? <p className="text-sm font-medium">Personal best in reach: {pbText}</p> : null;
            })()}
            {cues === exId && def.cues && <ul className="text-sm list-disc pl-5 mt-1">{def.cues.map((c) => <li key={c}>{c}</li>)}</ul>}
            <div className="grid grid-cols-[2rem_1fr_1fr_4.5rem_3rem] gap-2 items-center mt-2 text-xs text-muted">
              <span>Set</span><span>{def.bodyweight ? `+${u}` : def.perHand ? `${u} each` : u}</span><span>{repsLabel}</span><span>RPE</span><span className="sr-only">Done</span>
            </div>
            {sets.map((s, i) => (
              <SetRow key={s.id} s={s} n={i + 1 - sets.slice(0, i).filter((x) => x.warmup).length} units={units} repsLabel={repsLabel}
                onChange={(patch) => {
                  // How hard it felt, logged after ticking: adjust the remaining sets then.
                  if (patch.rpe !== undefined && s.done) { const cur = { ...w, sets: w.sets.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }; update(adjustFrom(cur, { ...s, ...patch }, def)); }
                  else setSet(s.id, patch);
                }} onTick={() => tick(s, def)} onPlates={() => setPlates(s.weightKg)} />
            ))}
            {!finished && t.lastSetMax && sets.length > 1 && !sets[sets.length - 1].done && <p className="text-xs text-muted mt-1">Last set: as many good reps as you can, stopping 1 short. Log how hard it felt (RPE).</p>}
            <div className="flex flex-wrap gap-x-4 mt-2">
              <button type="button" className="min-h-[44px] text-sm font-medium underline underline-offset-4" onClick={() => {
                const last = sets[sets.length - 1];
                update({ ...w, sets: [...w.sets, { id: newSetId(), exerciseId: exId, weightKg: last?.weightKg ?? t.weightKg, reps: last?.reps ?? t.reps, done: false, group: g }] });
              }}>Add set</button>
              {!def.bodyweight && !def.perHand && def.equipment !== 'machine' && def.equipment !== 'cable' && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => setPlates(sets.find((x) => !x.done)?.weightKg ?? sets[0]?.weightKg ?? 0)}>Plates</button>}
              {!finished && !sets.some((x) => x.warmup) && (() => {
                const first = sets.find((x) => !x.done);
                const ups = first ? warmupSets(def, first.weightKg, settings.barKg, units, newSetId) : [];
                return ups.length ? <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => {
                  const at = w.sets.findIndex((x) => x.id === first!.id);
                  update({ ...w, sets: [...w.sets.slice(0, at), ...ups.map((x) => ({ ...x, group: first!.group })), ...w.sets.slice(at)] });
                  toast(`${ups.length} warm-up sets added: ${ups.map((x) => `${showLoad(x.weightKg, units)}×${x.reps}`).join(', ')}`);
                }}>Warm-ups</button> : null;
              })()}
              {def.cues && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" aria-expanded={cues === exId} onClick={() => setCues(cues === exId ? null : exId)}>How to</button>}
              {!finished && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => setSwapping(exId)}>Swap</button>}
              {!finished && !g && order.indexOf(exId) < order.length - 1 && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => superset(exId)}>Superset with next</button>}
              {!finished && g && inGroup[0] === exId && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={() => unsuperset(g)}>Undo superset</button>}
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
              <span className="flex-1">
                <span className="block text-lg tnum">Rest {Math.floor(Math.max(0, Math.ceil((rest.until - now) / 1000)) / 60)}:{String(Math.max(0, Math.ceil((rest.until - now) / 1000)) % 60).padStart(2, '0')}{rest.why ? <span className="text-sm opacity-80"> · {rest.why}</span> : null}</span>
                {rest.next && <span className="block text-sm opacity-80 tnum">{rest.next}</span>}
              </span>
              <button type="button" className="min-h-[44px] px-3 font-medium" onClick={() => { const until = rest.until + 30_000; setRest({ ...rest, until }); void scheduleRestEnd(until, rest.next ?? 'Time for your next set'); }}>+30 s</button>
              <button type="button" className="min-h-[44px] px-3 font-medium underline" onClick={skipRest}>Skip</button>
            </div>
          </div>
        )}
          <div className="mx-auto max-w-[560px] px-6 py-3 flex gap-2">
            {finished ? <Button variant="secondary" className="flex-1" onClick={() => go('/training')}>Done</Button> : (
              <Button className="flex-1 min-h-[52px]" onClick={async () => { skipRest(); await saveWorkout(w); await finishWorkout(w.id); setW({ ...w, endedAt: new Date().toISOString() }); setDone(true); }}>Finish workout</Button>
            )}
            <button type="button" aria-label="Delete workout" className="w-12 h-12 flex items-center justify-center text-muted" onClick={async () => {
              skipRest(); await removeWorkout(w.id); toast('Workout deleted', { onAction: () => restoreWorkout(w.id) }); replace('/training');
            }}><Trash2 size={20} aria-hidden="true" /></button>
          </div>
      </div>

      {picking && <ExercisePicker own={own} personId={fam.personId} onClose={() => setPicking(false)} onPick={(d: ExerciseDef) => {
        update({ ...w, sets: [...w.sets, ...plannedSets(d, others, undefined, newSetId, units)] });
      }} />}
      {swapping && <SwapSheet def={defOf(swapping)} defs={defs} others={others} units={units} onClose={() => setSwapping(null)} onPick={(d) => { swap(swapping, d); setSwapping(null); }} />}
      {plates !== null && <PlatesSheet initial={plates} barKg={settings.barKg} onClose={() => setPlates(null)} />}
      {done && <SummarySheet w={w} defs={defs} units={units} pbs={pbs.map((p) => `${defOf(p.exerciseId).name}: ${p.text}`)} personId={fam.personId} onClose={() => { setDone(false); go('/training'); }} />}
    </div>
  );
}

function SetRow({ s, n, units, repsLabel, onChange, onTick, onPlates }: { s: WorkoutSet; n: number; units: Units; repsLabel: string; onChange: (p: Partial<WorkoutSet>) => void; onTick: () => void; onPlates: () => void }) {
  // Typed text is kept while editing, so "62." or an empty box don't jump; the stored kg updates as it parses.
  const [text, setText] = useState(s.weightKg ? String(showLoad(s.weightKg, units)) : '');
  useEffect(() => { const shown = s.weightKg ? String(showLoad(s.weightKg, units)) : ''; if (Number(text || 0) !== Number(shown || 0)) setText(shown); }, [s.weightKg, units]);
  return (
    <div className="grid grid-cols-[2rem_1fr_1fr_4.5rem_3rem] gap-2 items-center mt-1.5">
      <button type="button" className={`text-sm tnum min-h-[44px] ${s.warmup ? 'text-muted' : ''}`} aria-label={s.warmup ? 'Warm-up set; tap to make it a working set' : `Set ${n}; tap to mark as warm-up`} onClick={() => onChange({ warmup: !s.warmup })}>{s.warmup ? 'W' : n}</button>
      <input aria-label={`Set ${n} weight (${loadUnit(units)})`} type="number" inputMode="decimal" min="0" step="any" value={text} placeholder="0"
        onChange={(e) => { setText(e.target.value); onChange({ weightKg: Number(e.target.value) > 0 ? fromLoad(Number(e.target.value), units) : 0 }); }} onDoubleClick={onPlates}
        className="min-h-[44px] w-full rounded-btn border border-border-strong bg-transparent px-2 tnum text-center" />
      <input aria-label={`Set ${n} ${repsLabel.toLowerCase()}`} type="number" inputMode="numeric" min="0" step="1" value={s.reps || ''} placeholder="0" onChange={(e) => onChange({ reps: Number(e.target.value) || 0 })} className="min-h-[44px] w-full rounded-btn border border-border-strong bg-transparent px-2 tnum text-center" />
      <select aria-label={`Set ${n} how hard (RPE)`} value={s.rpe ?? ''} onChange={(e) => onChange({ rpe: e.target.value ? Number(e.target.value) : undefined })} className="min-h-[44px] rounded-btn border border-border-strong bg-transparent px-1 text-sm">
        <option value="">–</option>{[6, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <button type="button" aria-label={s.done ? `Set ${n} done; tap to undo` : `Mark set ${n} done`} aria-pressed={s.done} onClick={onTick}
        className={`w-11 h-11 rounded-full flex items-center justify-center border ${s.done ? 'bg-text text-bg border-text' : 'border-border-strong'}`}><Check size={18} aria-hidden="true" /></button>
    </div>
  );
}

/** Something else for the same muscle, for a busy machine: ones you've done before first, with what you did last. */
function SwapSheet({ def, defs, others, units, onPick, onClose }: { def: ExerciseDef; defs: ExerciseDef[]; others: Workout[]; units: Units; onPick: (d: ExerciseDef) => void; onClose: () => void }) {
  const last = new Map<string, number>();
  for (const w of others) for (const s of working(w.sets)) last.set(s.exerciseId, Math.max(last.get(s.exerciseId) ?? 0, Date.parse(w.startedAt)));
  const list = swapsFor(def, defs, last, 6);
  return (
    <Sheet open onClose={onClose} title={`Instead of ${def.name}`}>
      {list.length === 0 ? <p className="text-muted">Nothing similar in the list. Add your own from Add exercise.</p> : (
        <ul>
          {list.map((d) => {
            const t = nextTarget(d, others, undefined, units);
            return (
              <li key={d.id} className="border-t border-border">
                <button type="button" className="w-full text-left py-3 min-h-[56px]" onClick={() => onPick(d)}>
                  <span className="block font-medium">{d.name}</span>
                  <span className="block text-sm text-muted tnum">{t.why === 'start' ? 'Not done before' : `Aim ${t.sets} × ${t.reps}${d.timed ? ' s' : ''}${t.weightKg ? ` at ${fmtLoad(t.weightKg, units)}` : ''}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-muted mt-2">Swaps the sets you haven’t done yet. Same main muscle; ones you’ve done before come first.</p>
    </Sheet>
  );
}

function SummarySheet({ w, defs, units, pbs, personId, onClose }: { w: Workout; defs: ExerciseDef[]; units: Units; pbs: string[]; personId: string; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(w.name ?? 'My routine');
  const ws = working(w.sets);
  const perHand = (exId: string) => (defs.find((d) => d.id === exId)?.perHand ? 2 : 1);
  const timed = (exId: string) => !!defs.find((d) => d.id === exId)?.timed;
  const vol = ws.filter((s) => !timed(s.exerciseId)).reduce((n, s) => n + s.weightKg * s.reps * perHand(s.exerciseId), 0);
  const mins = Math.round(((w.endedAt ? Date.parse(w.endedAt) : Date.now()) - Date.parse(w.startedAt)) / 60_000);
  const items = [...new Set(ws.map((s) => s.exerciseId))].map((exerciseId) => {
    const sets = ws.filter((s) => s.exerciseId === exerciseId);
    return { exerciseId, sets: sets.length, reps: Math.max(...sets.map((s) => s.reps)), weightKg: Math.max(...sets.map((s) => s.weightKg)) };
  });
  return (
    <Sheet open onClose={onClose} title="Workout done">
      <div className="space-y-4">
        <p className="text-[17px] tnum">{mins} min · {ws.length} set{ws.length === 1 ? '' : 's'} · {Math.round(showLoad(vol, units)).toLocaleString('en-AU')} {loadUnit(units)} moved</p>
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
