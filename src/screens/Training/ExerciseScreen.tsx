// One exercise: personal bests, the estimated max over time (with a goal and its forecast), reps at each weight, what
// to aim for next time, and every session.
import { lazy, Suspense, useState } from 'react';
import { ActionTagsCard } from '../Tags/ActionTagsCard';
import { format } from 'date-fns';
import { useBodyEntries, useExercises, useFamily, useSettings, useWorkouts } from '../../app/data';
import { relativeStrength } from '../../logic/trainingExtras';
import { fmtLoad, showLoad } from '../../logic/load';
import { swapsFor } from '../../logic/exercises';
import { personOf } from '../../db/repos/people';
import { allExercises, MUSCLES } from '../../logic/exercises';
import { e1rm, e1rmSeries, personalBests, plateau, sessionsOf, strengthForecast } from '../../logic/training';
import { effortCheck, progressionPlan, smartTarget } from '../../logic/progression';
import { useTrainingContext } from './useTrainingContext';
import { useNow } from '../../app/useNow';
import { HAS_BODY } from '../../edition';
import { Button } from '../../components/ui/Button';
import { GoalSheet } from './TrainingSheets';

const StrengthChart = lazy(() => import('../../components/charts/StrengthChart'));
const d = (t: number) => format(t, 'd MMM yyyy');

export function ExerciseScreen({ id }: { id: string }) {
  const workouts = useWorkouts();
  const own = useExercises();
  const fam = useFamily();
  const settings = useSettings();
  const body = useBodyEntries();
  const now = useNow(60_000);
  const today = useTrainingContext(fam?.personId, now);
  const [goal, setGoal] = useState(false);
  if (!workouts || !own || !fam || !settings) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const def = allExercises(own).find((x) => x.id === id);
  if (!def) return <p className="border-t border-border pt-5">Exercise not found.</p>;
  const mine = workouts.filter((w) => personOf(w) === fam.personId);
  const pb = personalBests(id, mine);
  const pts = e1rmSeries(id, mine);
  const units = settings.units;
  const L = (kg: number) => fmtLoad(kg, units);
  const each = def.perHand ? ' each' : '';
  const t = smartTarget(def, mine, { units, readiness: today?.readiness, weakDay: today?.weakDay, lighter: today?.lighter, now });
  const plan = progressionPlan(def, mine, now, units, 4, t.why === 'start' ? undefined : t);
  const effort = effortCheck(id, mine, now);
  // No weight used (a plank, plain push-ups): progress is reps or seconds, not an estimated max.
  const noLoad = !!def.timed || (!!def.bodyweight && !mine.some((w) => w.sets.some((x) => x.exerciseId === id && x.weightKg > 0)));
  const swaps = swapsFor(def, allExercises(own), new Map(), 4);
  const flat = plateau(id, mine, now);
  const g = fam.people.find((p) => p.id === fam.personId)?.fitnessGoals?.find((x) => x.kind === 'lift' && x.exerciseId === id);
  const target = g?.targetKg ? e1rm(g.targetKg, g.reps ?? 1) : undefined;
  const f = target ? strengthForecast(id, mine, target, now) : undefined;
  const sessions = sessionsOf(id, mine).reverse();
  return (
    <div className="space-y-2">
      <h2 className="text-[26px] font-light">{def.name}</h2>
      <p className="text-sm text-muted">{def.muscles.map((m) => MUSCLES.find((x) => x.id === m)?.name).join(', ')}{def.perHand ? ' · weight is per dumbbell' : ''}{def.timed ? ' · held for time' : ''}</p>
      {def.cues && (
        <section className="border-t border-border pt-4 pb-2">
          <h3 className="text-sm font-medium text-muted mb-1">How to</h3>
          <ul className="list-disc pl-5 text-[15px]">{def.cues.map((c) => <li key={c}>{c}</li>)}</ul>
          {swaps.length > 0 && <p className="text-sm text-muted mt-2">Similar: {swaps.map((x, i) => <span key={x.id}>{i ? ', ' : ''}<a className="underline" href={`#/training/exercise/${x.id}`}>{x.name}</a></span>)}</p>}
        </section>
      )}
      <section className="border-t border-border pt-4 pb-2">
        <h3 className="text-sm font-medium text-muted mb-1">Personal bests</h3>
        {!pb.heaviest ? <p className="text-muted">None yet: log it in a workout.</p> : (
          <dl className="grid grid-cols-2 gap-y-2 tnum">
            <dt className="text-muted">Heaviest</dt><dd>{def.timed ? `${pb.heaviest.reps} s${pb.heaviest.kg ? ` at ${L(pb.heaviest.kg)}` : ''}` : pb.heaviest.kg ? `${L(pb.heaviest.kg)}${each} × ${pb.heaviest.reps}` : `${pb.heaviest.reps} reps`} <span className="text-xs text-muted">{d(pb.heaviest.t)}</span></dd>
            {pb.e1rm && !def.timed && <><dt className="text-muted">Estimated max</dt><dd>{L(pb.e1rm.v)} <span className="text-xs text-muted">({showLoad(pb.e1rm.kg, units)} × {pb.e1rm.reps})</span></dd></>}
            {(() => {
              const rs = HAS_BODY && body ? relativeStrength(id, mine, body.filter((b) => personOf(b) === fam.personId), now) : null;
              return rs && !noLoad ? <><dt className="text-muted">For your body weight</dt><dd>{rs.now}× <span className="text-xs text-muted">{rs.then !== undefined ? `(${rs.then}× 8 weeks ago)` : 'estimated max ÷ weight'}</span></dd></> : null;
            })()}
            {pb.mostReps && !def.timed && <><dt className="text-muted">Most reps</dt><dd>{pb.mostReps.reps}{pb.mostReps.kg ? ` at ${L(pb.mostReps.kg)}` : ''}</dd></>}
            {pb.volume && !def.timed && <><dt className="text-muted">Most volume</dt><dd>{Math.round(showLoad(pb.volume.kg * (def.perHand ? 2 : 1), units)).toLocaleString('en-AU')} {units === 'imperial' ? 'lb' : 'kg'} <span className="text-xs text-muted">{d(pb.volume.t)}</span></dd></>}
          </dl>
        )}
      </section>
      {pts.length >= 2 && (
        <section className="border-t border-border pt-4 pb-2">
          <h3 className="text-sm font-medium text-muted mb-1">{def.timed ? 'Longest hold' : noLoad ? 'Most reps' : 'Estimated max'}</h3>
          <Suspense fallback={<div className="h-[170px]" />}><StrengthChart points={pts} target={target} f={f} now={now} units={units} unitLabel={def.timed ? 's' : noLoad ? 'reps' : undefined} /></Suspense>
          {g && f && <p className="text-[15px] mt-1 tnum">Goal {L(g.targetKg!)}{(g.reps ?? 1) > 1 ? ` × ${g.reps}` : ''}: {f.status === 'reached' ? 'reached' : f.eta ? `likely around ${format(f.eta, 'd MMM')}${f.etaEarly && f.etaLate ? ` (${format(f.etaEarly, 'd MMM')}–${format(f.etaLate, 'd MMM')})` : ''}` : f.status === 'need-data' ? 'a few more sessions for a date' : 'no date while it’s flat'}</p>}
          <p className="text-xs text-muted">{noLoad ? 'Your best set each session.' : 'Estimated max from your best set each session (weight × reps, Epley). A guide, not a test.'}</p>
        </section>
      )}
      <section className="border-t border-border pt-4 pb-2">
        <h3 className="text-sm font-medium text-muted mb-1">Next time</h3>
        <p className="text-[17px] tnum">{t.why === 'push' ? 'Push: ' : t.why === 'hold' ? 'Hold: ' : ''}{t.sets} × {t.reps}{def.timed ? ' s' : ''}{t.weightKg ? ` at ${L(t.weightKg)}${each}` : ''}</p>
        <p className="text-[15px] text-muted">{t.reason}</p>
        {effort.text && <p className={`text-[15px] mt-1 ${effort.status === 'room' ? 'font-medium' : ''}`}>{effort.text}</p>}
        {flat && <p className="text-[15px] mt-1">{flat.harder ? 'Feeling harder at the same weight lately.' : 'No improvement for about 3 weeks.'} A lighter week (about 10% less) and then building back up often helps.</p>}
        {plan.steps.length > 0 && t.why !== 'start' && !noLoad && (
          <div className="mt-3">
            <p className="text-sm font-medium text-muted">If each session goes to plan</p>
            <ol className="text-[15px] tnum">
              {plan.steps.map((p) => <li key={p.n}>{p.at ? format(p.at, 'EEE d MMM') : `Session ${p.n}`}: {p.sets} × {p.reps}{p.weightKg ? ` at ${L(p.weightKg)}${each}` : ''}</li>)}
            </ol>
            <p className="text-xs text-muted">{plan.everyDays ? `You do this about every ${plan.everyDays} days. ` : ''}Each step needs every set to hit its reps first; a stall or a hard week resets it.{plan.perWeekPct !== undefined ? ` Your trend: ${plan.perWeekPct > 0 ? '+' : ''}${plan.perWeekPct}% a week.` : ''}</p>
          </div>
        )}
        <Button variant="secondary" className="mt-2" onClick={() => setGoal(true)}>{g ? 'Edit goal' : 'Set a goal'}</Button>
      </section>
      {pb.repsAt.length > 0 && !def.timed && pb.repsAt.some((x) => x.kg > 0) && (
        <section className="border-t border-border pt-4 pb-2">
          <h3 className="text-sm font-medium text-muted mb-1">Best reps at each weight</h3>
          <p className="text-[15px] tnum">{pb.repsAt.slice(0, 10).map((x) => `${L(x.kg)} × ${x.reps}`).join(' · ')}</p>
        </section>
      )}
      <section className="border-t border-border pt-4 pb-2">
        <h3 className="text-sm font-medium text-muted mb-1">Sessions</h3>
        <ul>
          {sessions.map((s) => (
            <li key={s.workoutId} className="border-t border-border py-2">
              <a href={`#/training/workout/${s.workoutId}`} className="block tnum">
                <span className="text-sm text-muted">{format(s.t, 'EEE d MMM')}</span>{' '}
                {s.sets.map((x) => `${x.weightKg ? `${x.weightKg}×` : ''}${x.reps}`).join(', ')}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <ActionTagsCard action={{ kind: 'exercise', exerciseId: id }} name={def.name} hint="Stick a tag on the machine or rack. Tapping it adds this exercise to your workout, with what to aim for." />
      {goal && <GoalSheet personId={fam.personId} own={own} existing={g} preset={{ kind: 'lift', exerciseId: id }} onClose={() => setGoal(false)} />}
    </div>
  );
}
