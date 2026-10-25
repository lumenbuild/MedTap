// A tap on a tag that isn't for a medication. Like a medication tag, it shows what it will do with one button to do it
// (nothing is logged by the tap alone), or opens the matching form: weight, measurements, blood pressure, a check-in,
// cardio.
import { useState } from 'react';
import { format } from 'date-fns';
import { Nfc } from 'lucide-react';
import { DEFAULT_PERSON, type Tag } from '../../db/schema';
import { useCheckIns, useDaily, useDoses, useExercises, useMeds, useRoutines, useScheduleSettings, useWorkouts } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { addExerciseNow, addIntake, finishCardio, startCardio, startWorkout, newSetId } from '../../db/repos/training';
import { setSetting } from '../../db/repos/settings';
import { allExercises } from '../../logic/exercises';
import { parseAmount } from '../../logic/intake';
import { actionTitle, openWorkout, plannedSets } from '../../logic/tagActions';
import { smartTarget } from '../../logic/progression';
import { useTrainingContext } from '../Training/useTrainingContext';
import { fmtLoad } from '../../logic/load';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go, replace } from '../../app/router';
import { HAS_TRAINING } from '../../edition';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { BodySheet } from '../../components/BodySheets';
import { VitalsSheet } from '../../components/VitalsSheet';
import { CheckInSheet } from '../../components/CheckInSheet';
import { ACTIVITIES, CardioSheet } from '../Training/TrainingSheets';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { logFood, removeFoodLog } from '../../db/repos/food';
import { dayKey } from '../../logic/stats';
import type { ScheduleSettings } from '../../logic/schedule';
import type { EnergyUnit } from '../../logic/nutrition';
import { macroLine } from '../../components/food/LogFoodSheet';

const TRAINING = ['exercise', 'routine', 'cardio', 'water', 'protein'];
// The sheets restart when their state changes, and this screen redraws every second, so each gets the same object every
// time (a new {} each render wiped what was being typed).
const WEIGHT = { kind: 'weight' } as const;
const MEASURE = { kind: 'measure' } as const;
const NEW_READING = {};
const NEW_CHECK_IN = {};

export function ActionTag({ tag, personName }: { tag: Tag; personName?: string }) {
  const a = tag.action!;
  const personId = tag.personId ?? DEFAULT_PERSON;
  const workouts = useWorkouts(); const own = useExercises(); const routines = useRoutines(); const daily = useDaily();
  const ss = useScheduleSettings(); const checkIns = useCheckIns(); const doses = useDoses(); const meds = useMeds();
  const foods = useLive(() => db.foods.toArray(), []);
  const now = useNow(1000);
  const today = useTrainingContext(tag.personId ?? DEFAULT_PERSON, now);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [km, setKm] = useState('');
  const [amt, setAmt] = useState('');
  const close = () => replace('/today');
  if (!workouts || !own || !routines || !daily || !ss || !checkIns || !doses || !meds) return <div className="h-[420px] rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === personId && !r.deletedAt;
  const ws = workouts.filter(mine);
  const defs = allExercises(own);
  const title = actionTitle(a, defs, routines, foods ?? []);
  const who = personName ? <p className="text-sm font-medium text-muted">For {personName}</p> : null;
  const head = (sub?: string) => (
    <div className="mb-5">
      <p className="flex items-center gap-2 text-sm font-medium text-muted"><Nfc size={18} aria-hidden="true" /> {tag.label || 'Tag'}</p>
      {who}
      <h1 className="font-light text-[44px] leading-[48px] tracking-[-0.04em] break-words mt-2">{title}</h1>
      {sub && <p className="mt-2 text-[17px]">{sub}</p>}
    </div>
  );
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };

  if (TRAINING.includes(a.kind) && (!HAS_TRAINING || !settings.trainingTools)) {
    return (
      <section>
        {head('This tag is for training, which is turned off.')}
        <Button className="w-full min-h-[56px]" onClick={() => setSetting('trainingTools', true)}>Turn on Training</Button>
        <Button variant="secondary" className="w-full mt-3" onClick={close}>Not now</Button>
      </section>
    );
  }

  switch (a.kind) {
    case 'exercise': {
      const def = defs.find((d) => d.id === a.exerciseId);
      if (!def) return <Missing what="exercise" close={close} />;
      const open = openWorkout(ws, now);
      const inIt = open?.sets.some((x) => x.exerciseId === def.id);
      const t = smartTarget(def, ws, { units: settings.units, readiness: today?.readiness, weakDay: today?.weakDay, lighter: today?.lighter, now });
      const aim = t.why === 'start' ? t.reason : `${t.reason} Aim: ${t.sets} × ${t.reps}${def.timed ? ' s' : ''}${t.weightKg ? ` at ${fmtLoad(t.weightKg, settings.units)}${def.perHand ? ' each' : ''}` : ''}`;
      const label = !open ? 'Start a workout with it' : inIt ? 'Open the workout' : 'Add to my workout';
      return (
        <section>
          {head(open ? `${inIt ? 'Already in' : 'Adds it to'} your workout (started ${Math.round((now - Date.parse(open.startedAt)) / 60_000)} min ago).` : 'No workout in progress, so this starts one.')}
          <p className="text-[15px] tnum mb-5">{aim}</p>
          <Button className="w-full min-h-[56px]" disabled={busy} onClick={() => run(async () => {
            const r = await addExerciseNow(personId, def, ws, Date.now(), settings.units, today ?? undefined);
            if (r.added) toast(r.started ? `Workout started with ${def.name}` : `${def.name} added`);
            try { sessionStorage.setItem('medtap.scrollTo', def.id); } catch { /* not available */ }
            replace(`/training/workout/${r.workout.id}`);
          })}>{label}</Button>
          <Button variant="secondary" className="w-full mt-3" onClick={() => replace(`/training/exercise/${def.id}`)}>See its history</Button>
          <Button variant="secondary" className="w-full mt-3" onClick={close}>Cancel</Button>
        </section>
      );
    }
    case 'routine': {
      const r = routines.find((x) => x.id === a.routineId && !x.deletedAt);
      if (!r) return <Missing what="routine" close={close} />;
      const open = openWorkout(ws, now);
      const begin = () => run(async () => {
        const sets = r.items.flatMap((it) => { const def = defs.find((d) => d.id === it.exerciseId); return def ? plannedSets(def, ws, it, newSetId, settings.units, today ? { ...today, now } : undefined) : []; });
        const w = await startWorkout(personId, { routine: r, sets });
        toast(`${r.name} started`);
        replace(`/training/workout/${w.id}`);
      });
      return (
        <section>
          {head(r.items.map((i) => defs.find((d) => d.id === i.exerciseId)?.name).filter(Boolean).join(', '))}
          {open && <p className="text-[15px] rounded-btn bg-surface-2 p-3 mb-4">A workout is already in progress (started {Math.round((now - Date.parse(open.startedAt)) / 60_000)} min ago).</p>}
          {open && <Button className="w-full min-h-[56px] mb-3" onClick={() => replace(`/training/workout/${open.id}`)}>Continue that workout</Button>}
          <Button variant={open ? 'secondary' : 'primary'} className="w-full min-h-[56px]" disabled={busy} onClick={begin}>Start {r.name}{open ? ' as well' : ''}</Button>
          <Button variant="secondary" className="w-full mt-3" onClick={close}>Cancel</Button>
        </section>
      );
    }
    case 'water':
    case 'protein': {
      const field = a.kind === 'water' ? 'waterMl' : 'proteinG';
      const amount = a.kind === 'water' ? a.ml : a.g;
      const unit = a.kind === 'water' ? 'mL' : 'g';
      const today = format(now, 'yyyy-MM-dd');
      const total = daily.filter(mine).find((d) => d.date === today)?.[field] ?? 0;
      const target = a.kind === 'water' ? settings.waterTargetMl : settings.proteinTargetG;
      const logIntake = (n: number) => run(async () => {
        const t = await addIntake(personId, today, field, n);
        toast(`+${n} ${unit} · ${t} ${unit} today`, { duration: 10_000, onAction: () => addIntake(personId, today, field, -n) });
        close();
      });
      return (
        <section>
          {head(`${total}${target ? ` of ${target}` : ''} ${unit} so far today`)}
          <Button className="w-full min-h-[64px] text-lg" disabled={busy} onClick={() => logIntake(amount)}>Add {amount} {unit}</Button>
          {/* Half the bottle, or a refill of a different size: any amount, just this once. */}
          <div className="flex gap-2 items-end mt-4">
            <div className="flex-1"><TextInput label={`Or a different amount (${unit})`} type="number" inputMode="numeric" min="1" step="1" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
            <Button variant="secondary" className="min-h-[48px]" disabled={busy || parseAmount(amt, field) === null} onClick={() => { const n = parseAmount(amt, field); if (n !== null) logIntake(n); }}>Add</Button>
          </div>
          <Button variant="secondary" className="w-full mt-3" onClick={close}>Cancel</Button>
        </section>
      );
    }
    case 'cardio': {
      const name = ACTIVITIES.find((x) => x.id === a.activity)?.name ?? 'Cardio';
      const running = ws.filter((w) => w.cardio?.activity === a.activity && !w.endedAt && now - Date.parse(w.startedAt) < 6 * 3_600_000).sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
      if (running) {
        const min = Math.round((now - Date.parse(running.startedAt)) / 60_000);
        return (
          <section>
            {head(`Started ${format(Date.parse(running.startedAt), 'h:mm a')} · ${min} min so far`)}
            <TextInput label="Distance (km, optional)" type="number" inputMode="decimal" min="0" step="any" value={km} onChange={(e) => setKm(e.target.value)} />
            <Button className="w-full min-h-[56px] mt-4" disabled={busy} onClick={() => run(async () => {
              await finishCardio(running, Number(km) > 0 ? Number(km) : undefined);
              toast(`${name} saved: ${Math.max(1, min)} min`); replace('/training');
            })}>Finish {name.toLowerCase()}</Button>
            <Button variant="secondary" className="w-full mt-3" onClick={close}>Keep going</Button>
          </section>
        );
      }
      return <CardioStart name={name} head={head('Tap the tag again when you finish, and the time is filled in.')} busy={busy}
        onStart={() => run(async () => { await startCardio(personId, a.activity); toast(`${name} started. Tap the tag again to finish.`); close(); })}
        onClose={close} personId={personId} activity={a.activity} />;
    }
    case 'weight': return <><section>{head()}</section><BodySheet state={WEIGHT} onClose={close} units={settings.units} personId={personId} /></>;
    case 'bp': return <><section>{head()}</section><VitalsSheet state={NEW_READING} onClose={close} personId={personId} /></>;
    case 'measure': return <><section>{head()}</section><BodySheet state={MEASURE} onClose={close} units={settings.units} personId={personId} /></>;
    case 'food': return <FoodTag foodId={a.foodId} personId={personId} head={head} s={s} energy={settings.energyUnit} close={close} />;
    case 'checkin': return (
      <>
        <section>{head()}</section>
        <CheckInSheet seed={NEW_CHECK_IN} onClose={close} doses={doses} checkIns={checkIns.filter(mine)} meds={meds} chips={settings.chips} s={s} personId={personId} soreness={HAS_TRAINING && settings.trainingTools} />
      </>
    );
  }
}

function CardioStart({ name, head, busy, onStart, onClose, personId, activity }: { name: string; head: React.ReactNode; busy: boolean; onStart: () => void; onClose: () => void; personId: string; activity: Parameters<typeof startCardio>[1] }) {
  const [logging, setLogging] = useState(false);
  return (
    <section>
      {head}
      <Button className="w-full min-h-[56px]" disabled={busy} onClick={onStart}>Start {name.toLowerCase()} now</Button>
      <Button variant="secondary" className="w-full mt-3" onClick={() => setLogging(true)}>Log one I’ve done</Button>
      <Button variant="secondary" className="w-full mt-3" onClick={onClose}>Cancel</Button>
      {logging && <CardioSheet personId={personId} initial={activity} onClose={onClose} />}
    </section>
  );
}

function Missing({ what, close }: { what: string; close: () => void }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">This tag’s {what} was deleted</h1>
      <p className="text-muted mt-2">Choose something else for it to do.</p>
      <Button className="w-full min-h-[56px] mt-5" onClick={() => go('/tags')}>Change what it does</Button>
      <Button variant="secondary" className="w-full mt-3" onClick={close}>Go to Today</Button>
    </section>
  );
}

/** A food or drink tag: what one serving has, and Log it. */
function FoodTag({ foodId, personId, head, s, energy, close }: { foodId: string; personId: string; head: (sub?: string) => React.ReactNode; s: ScheduleSettings; energy: EnergyUnit; close: () => void }) {
  const food = useLive(() => db.foods.get(foodId), [foodId]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (food === undefined) return <div className="h-[420px] rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  if (!food || food.deletedAt) return <Missing what="food" close={close} />;
  return (
    <section>
      {head([food.serving, macroLine(food.nutrients, energy)].filter(Boolean).join(' · '))}
      <Button className="w-full min-h-[64px] text-lg" disabled={busy} onClick={async () => {
        setBusy(true);
        const now = Date.now();
        const log = await logFood({ name: food.name, foodId: food.id, servings: 1, nutrients: food.nutrients, at: new Date(now).toISOString(), date: dayKey(now, s), personId });
        toast(`Logged ${food.name}`, { duration: 10_000, onAction: () => removeFoodLog(log, dayKey(now, s)) });
        close();
      }}>Log one serving</Button>
      <Button variant="secondary" className="w-full mt-3" onClick={() => replace('/food')}>Log a different amount</Button>
      <Button variant="secondary" className="w-full mt-3" onClick={close}>Cancel</Button>
    </section>
  );
}
