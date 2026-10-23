// One exercise: personal bests, the estimated max over time (with a goal and its forecast), reps at each weight, what
// to aim for next time, and every session.
import { lazy, Suspense, useState } from 'react';
import { format } from 'date-fns';
import { useExercises, useFamily, useWorkouts } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { allExercises, MUSCLES } from '../../logic/exercises';
import { e1rm, e1rmSeries, nextTarget, personalBests, plateau, sessionsOf, strengthForecast } from '../../logic/training';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/ui/Button';
import { GoalSheet } from './TrainingSheets';

const StrengthChart = lazy(() => import('../../components/charts/StrengthChart'));
const d = (t: number) => format(t, 'd MMM yyyy');

export function ExerciseScreen({ id }: { id: string }) {
  const workouts = useWorkouts();
  const own = useExercises();
  const fam = useFamily();
  const now = useNow(60_000);
  const [goal, setGoal] = useState(false);
  if (!workouts || !own || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const def = allExercises(own).find((x) => x.id === id);
  if (!def) return <p className="border-t border-border pt-5">Exercise not found.</p>;
  const mine = workouts.filter((w) => personOf(w) === fam.personId);
  const pb = personalBests(id, mine);
  const pts = e1rmSeries(id, mine);
  const t = nextTarget(def, mine);
  const flat = plateau(id, mine, now);
  const g = fam.people.find((p) => p.id === fam.personId)?.fitnessGoals?.find((x) => x.kind === 'lift' && x.exerciseId === id);
  const target = g?.targetKg ? e1rm(g.targetKg, g.reps ?? 1) : undefined;
  const f = target ? strengthForecast(id, mine, target, now) : undefined;
  const sessions = sessionsOf(id, mine).reverse();
  return (
    <div className="space-y-2">
      <h2 className="text-[26px] font-light">{def.name}</h2>
      <p className="text-sm text-muted">{def.muscles.map((m) => MUSCLES.find((x) => x.id === m)?.name).join(', ')}</p>
      <section className="border-t border-border pt-4 pb-2">
        <h3 className="text-sm font-medium text-muted mb-1">Personal bests</h3>
        {!pb.heaviest ? <p className="text-muted">None yet: log it in a workout.</p> : (
          <dl className="grid grid-cols-2 gap-y-2 tnum">
            <dt className="text-muted">Heaviest</dt><dd>{pb.heaviest.kg} kg × {pb.heaviest.reps} <span className="text-xs text-muted">{d(pb.heaviest.t)}</span></dd>
            {pb.e1rm && <><dt className="text-muted">Estimated max</dt><dd>{pb.e1rm.v} kg <span className="text-xs text-muted">({pb.e1rm.kg} × {pb.e1rm.reps})</span></dd></>}
            {pb.mostReps && <><dt className="text-muted">Most reps</dt><dd>{pb.mostReps.reps}{pb.mostReps.kg ? ` at ${pb.mostReps.kg} kg` : ''}</dd></>}
            {pb.volume && <><dt className="text-muted">Most volume</dt><dd>{pb.volume.kg.toLocaleString('en-AU')} kg <span className="text-xs text-muted">{d(pb.volume.t)}</span></dd></>}
          </dl>
        )}
      </section>
      {pts.length >= 2 && (
        <section className="border-t border-border pt-4 pb-2">
          <h3 className="text-sm font-medium text-muted mb-1">Estimated max</h3>
          <Suspense fallback={<div className="h-[170px]" />}><StrengthChart points={pts} target={target} f={f} now={now} /></Suspense>
          {g && f && <p className="text-[15px] mt-1 tnum">Goal {g.targetKg} kg{(g.reps ?? 1) > 1 ? ` × ${g.reps}` : ''}: {f.status === 'reached' ? 'reached' : f.eta ? `likely around ${format(f.eta, 'd MMM')}${f.etaEarly && f.etaLate ? ` (${format(f.etaEarly, 'd MMM')}–${format(f.etaLate, 'd MMM')})` : ''}` : f.status === 'need-data' ? 'a few more sessions for a date' : 'no date while it’s flat'}</p>}
          <p className="text-xs text-muted">Estimated max from your best set each session (weight × reps, Epley). A guide, not a test.</p>
        </section>
      )}
      <section className="border-t border-border pt-4 pb-2">
        <h3 className="text-sm font-medium text-muted mb-1">Next time</h3>
        <p className="text-[17px] tnum">{t.sets} × {t.reps}{t.weightKg ? ` at ${t.weightKg} kg` : ''}</p>
        {flat && <p className="text-[15px] mt-1">{flat.harder ? 'Feeling harder at the same weight lately.' : 'No improvement for about 3 weeks.'} A lighter week (about 10% less) and then building back up often helps.</p>}
        <Button variant="secondary" className="mt-2" onClick={() => setGoal(true)}>{g ? 'Edit goal' : 'Set a goal'}</Button>
      </section>
      {pb.repsAt.length > 0 && (
        <section className="border-t border-border pt-4 pb-2">
          <h3 className="text-sm font-medium text-muted mb-1">Best reps at each weight</h3>
          <p className="text-[15px] tnum">{pb.repsAt.slice(0, 10).map((x) => `${x.kg} kg × ${x.reps}`).join(' · ')}</p>
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
      {goal && <GoalSheet personId={fam.personId} own={own} existing={g} preset={{ kind: 'lift', exerciseId: id }} onClose={() => setGoal(false)} />}
    </div>
  );
}
