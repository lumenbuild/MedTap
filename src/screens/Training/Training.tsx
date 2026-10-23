// The Training tab (MedTap): start or continue a workout, readiness, the week, goals, personal bests, plateaus,
// strength against the peptide, lean mass, muscle balance, cardio and the history.
import { useState } from 'react';
import { format } from 'date-fns';
import {
  useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useFamily, useMeds, useRoutines, useScheduleSettings, useWorkouts,
} from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { allExercises } from '../../logic/exercises';
import {
  cardioBests, fitnessGoalStatus, newPBs, personalBests, plateau, readiness, timeText, trainingCalendar, weeklyBalance, working, paceText,
} from '../../logic/training';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { GoalTimeline, MuscleWatchCard, PeptideTrainingCard, ReadinessBlock } from '../../components/Fitness';
import { ACTIVITIES, CardioSheet, GoalSheet, PlatesSheet, StartSheet } from './TrainingSheets';
import { finishCardio } from '../../db/repos/training';
import { fmtLoad } from '../../logic/load';
import { habitText, trainingHabit } from '../../logic/trainingPlan';
import { effortCheck } from '../../logic/progression';
import { lighterWeekDue } from '../../logic/trainingExtras';
import { setTrainingReminders } from '../../app/native';
import { setSetting } from '../../db/repos/settings';
import { useToast } from '../../app/toast';
import { isNative } from '../../platform';

const DAY = 86_400_000;

export function Training() {
  const workouts = useWorkouts(); const own = useExercises(); const routines = useRoutines(); const fam = useFamily(); const ss = useScheduleSettings();
  const daily = useDaily(); const checkIns = useCheckIns(); const body = useBodyEntries(); const meds = useMeds(); const doses = useDoses();
  const now = useNow(60_000);
  const toast = useToast();
  const [sheet, setSheet] = useState<'start' | 'cardio' | 'goal' | 'plates' | null>(null);
  const [editGoal, setEditGoal] = useState<string | null>(null);
  if (!workouts || !own || !routines || !fam || !ss || !daily || !checkIns || !body || !meds || !doses) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === fam.personId && !r.deletedAt;
  const ws = workouts.filter(mine).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const defs = allExercises(own);
  const person = fam.people.find((p) => p.id === fam.personId);
  const goals = person?.fitnessGoals ?? [];
  const open = ws.find((w) => !w.endedAt && w.sets.length >= 0 && now - Date.parse(w.startedAt) < 6 * 3_600_000 && !w.cardio);
  const ready = readiness(daily.filter(mine), checkIns.filter(mine), now, s);
  const sessionsGoal = goals.find((g) => g.kind === 'sessions');
  const cal = trainingCalendar(ws, now, s, sessionsGoal?.perWeek ?? 0, 8);
  const bal = weeklyBalance(ws, defs, now);
  const lifted = [...new Set(ws.flatMap((w) => working(w.sets).map((x) => x.exerciseId)))];
  const recentPBs = ws.filter((w) => Date.parse(w.startedAt) > now - 14 * DAY).flatMap((w) => newPBs(w, ws, defs, settings.units).map((p) => ({ ...p, t: Date.parse(w.startedAt) })));
  const flats = lifted.map((id) => plateau(id, ws, now)).filter(Boolean);
  const peptide = settings.peptideTools ? meds.find((m) => m.peptide && !m.archived && medIsFor(m, fam.personId)) : undefined;
  const cardio = ws.filter((w) => w.cardio);
  const habit = trainingHabit(ws, now, s);
  const lighter = lighterWeekDue(ws, defs, now, settings.lighterLast || undefined);
  const pushable = lifted.map((id) => effortCheck(id, ws, now)).filter((e) => e.status === 'room');
  const maxCal = Math.max(1, ...cal.weeks.map((x) => x.sessions), sessionsGoal?.perWeek ?? 0);

  return (
    <div className="space-y-2">
      <PersonSwitcher />
      <section className="border-t border-border pt-5 pb-3 space-y-2">
        {open ? <Button className="w-full min-h-[56px]" onClick={() => go(`/training/workout/${open.id}`)}>Continue workout ({Math.round((now - Date.parse(open.startedAt)) / 60_000)} min)</Button>
          : <Button className="w-full min-h-[56px]" onClick={() => setSheet('start')}>Start a workout</Button>}
        {ws.filter((w) => w.cardio && !w.endedAt && now - Date.parse(w.startedAt) < 6 * 3_600_000).map((w) => (
          <p key={w.id} className="text-[15px] rounded-btn bg-surface-2 p-3 tnum">
            {ACTIVITIES.find((a) => a.id === w.cardio!.activity)?.name} in progress · {Math.round((now - Date.parse(w.startedAt)) / 60_000)} min. Tap its tag again to finish.
            <button type="button" className="block mt-1 underline min-h-[44px]" onClick={() => finishCardio(w)}>Finish now</button>
          </p>
        ))}
        <div className="flex flex-wrap gap-x-6">
          {[['Log cardio', () => setSheet('cardio')], ['Routines', () => go('/training/routines')], ['Plates', () => setSheet('plates')], ['Tags', () => go('/tags')]].map(([l, f]) => (
            <button key={l as string} type="button" onClick={f as () => void} className="min-h-[44px] text-[15px] font-medium underline underline-offset-4 decoration-border-strong">{l as string}</button>
          ))}
        </div>
      </section>

      {habit && isNative && !settings.trainingReminders && !settings.trainingReminderAsked && (
        <section className="border-t border-border pt-4 pb-2" aria-label="Training reminders">
          <p className="text-[15px]">You usually train {habitText(habit)}. Remind you on those days?</p>
          <div className="flex gap-4">
            <button type="button" className="min-h-[44px] font-medium underline underline-offset-4" onClick={async () => { const on = await setTrainingReminders(true); toast(on ? 'Reminders on for your usual training days' : 'Notifications are off for this app. Turn them on in your phone’s settings.'); }}>Remind me</button>
            <button type="button" className="min-h-[44px] text-muted underline underline-offset-4" onClick={() => setSetting('trainingReminderAsked', true)}>No thanks</button>
          </div>
        </section>
      )}

      {ready && <section className="border-t border-border pt-5 pb-1"><ReadinessBlock r={ready} /></section>}

      <section className="border-t border-border pt-5 pb-1" aria-labelledby="wk-h">
        <div className="flex items-baseline justify-between">
          <h2 id="wk-h" className="text-sm font-medium text-muted">Sessions a week</h2>
          <span className="text-sm tnum">{cal.thisWeek} this week{sessionsGoal ? ` of ${sessionsGoal.perWeek}` : ''}{cal.streak ? ` · ${cal.streak}-week streak` : ''}</span>
        </div>
        <div className="flex items-end gap-1.5 h-14 mt-2" role="img" aria-label={`Sessions in each of the last 8 weeks: ${cal.weeks.map((x) => x.sessions).join(', ')}`}>
          {cal.weeks.map((x, i) => <div key={x.start} className="flex-1 rounded-[3px]" style={{ height: `${(x.sessions / maxCal) * 100}%`, minHeight: x.sessions ? 3 : 0, background: i === cal.weeks.length - 1 ? 'var(--text)' : sessionsGoal && x.sessions >= sessionsGoal.perWeek! ? 'var(--border-strong)' : 'var(--border)' }} />)}
        </div>
        {!sessionsGoal && <button type="button" className="text-sm underline underline-offset-4 min-h-[44px]" onClick={() => { setEditGoal(null); setSheet('goal'); }}>Set a sessions-a-week goal</button>}
      </section>

      <GoalTimeline bodyGoals={person?.goals ?? []} fitnessGoals={goals} body={body.filter(mine)} workouts={ws} defs={defs} units={settings.units} now={now} s={s} />
      <section className="border-t border-border pt-4 pb-1" aria-labelledby="g-h">
        <h2 id="g-h" className="text-sm font-medium text-muted mb-1">Training goals</h2>
        <ul>
          {goals.map((g) => (
            <li key={g.id} className="border-t border-border">
              <button type="button" className="w-full text-left py-2.5 min-h-[48px] text-[15px] tnum" onClick={() => { setEditGoal(g.id); setSheet('goal'); }}>{fitnessGoalStatus(g, ws, now, s, defs, settings.units).text}</button>
            </li>
          ))}
        </ul>
        <button type="button" className="text-sm font-medium underline underline-offset-4 min-h-[44px]" onClick={() => { setEditGoal(null); setSheet('goal'); }}>Add a goal</button>
        <p className="text-xs text-muted">Weight, body fat and lean mass goals are on Progress → Body.</p>
      </section>

      {lifted.length > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="pb-h">
          <h2 id="pb-h" className="text-sm font-medium text-muted mb-1">Personal bests</h2>
          {recentPBs.length > 0 && <ul className="mb-2">{recentPBs.slice(0, 5).map((p, i) => <li key={i} className="text-[15px]"><span className="font-medium">{defs.find((d) => d.id === p.exerciseId)?.name}</span>: {p.text} <span className="text-xs text-muted">{format(p.t, 'd MMM')}</span></li>)}</ul>}
          <ul>
            {lifted.map((id) => {
              const pb = personalBests(id, ws);
              return (
                <li key={id} className="border-t border-border">
                  <a href={`#/training/exercise/${id}`} className="flex justify-between gap-3 py-2.5 min-h-[48px]">
                    <span>{defs.find((d) => d.id === id)?.name ?? 'Exercise'}</span>
                    <span className="text-sm tnum text-muted">{defs.find((d) => d.id === id)?.timed ? (pb.mostReps ? `${pb.mostReps.reps} s` : '') : pb.e1rm ? `max ~${fmtLoad(pb.e1rm.v, settings.units)}` : pb.mostReps ? `${pb.mostReps.reps} reps` : ''}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {settings.lighterUntil > now && (
        <section className="border-t border-border pt-4 pb-1" aria-label="Lighter week">
          <p className="text-[15px]"><span className="font-medium">Lighter week</span> until {format(settings.lighterUntil - 1, 'EEE d MMM')}: targets are about 10% lighter with a set fewer.</p>
          <button type="button" className="min-h-[44px] text-sm underline underline-offset-4" onClick={() => setSetting('lighterUntil', 0)}>End it now</button>
        </section>
      )}
      {settings.lighterUntil <= now && lighter && (
        <section className="border-t border-border pt-4 pb-1" aria-label="A lighter week is due">
          <p className="text-[15px] font-medium">Time for a lighter week?</p>
          <p className="text-[15px]">{lighter.reason}{lighter.lifts.length ? ` (${lighter.lifts.join(', ')})` : ''} A week at about 90% with a set fewer usually brings progress back.</p>
          <div className="flex gap-5">
            <button type="button" className="min-h-[44px] font-medium underline underline-offset-4" onClick={async () => { await setSetting('lighterUntil', now + 7 * 86_400_000); await setSetting('lighterLast', now); toast('Lighter week planned: targets adjusted for 7 days'); }}>Plan it for this week</button>
            <button type="button" className="min-h-[44px] text-muted underline underline-offset-4" onClick={() => setSetting('lighterLast', now - 21 * 86_400_000)}>Not now</button>
          </div>
        </section>
      )}

      {pushable.length > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="push-h">
          <h2 id="push-h" className="text-sm font-medium text-muted mb-1">Room to push</h2>
          <ul className="text-[15px] space-y-1">{pushable.map((e) => <li key={e.exerciseId}><a className="font-medium underline underline-offset-4" href={`#/training/exercise/${e.exerciseId}`}>{defs.find((d) => d.id === e.exerciseId)?.name}</a>: {e.text}</li>)}</ul>
          <p className="text-xs text-muted mt-1">From how hard your sets felt (RPE) and your trend. Next session’s targets already allow for it.</p>
        </section>
      )}

      {flats.length > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="pl-h">
          <h2 id="pl-h" className="text-sm font-medium text-muted mb-1">Worth a lighter week</h2>
          <ul className="text-[15px] space-y-1">{flats.map((f) => <li key={f!.exerciseId}><span className="font-medium">{defs.find((d) => d.id === f!.exerciseId)?.name}</span>: {f!.harder ? 'feeling harder at the same weight' : 'no improvement for about 3 weeks'}. About 10% less for a week, then build back up.</li>)}</ul>
        </section>
      )}

      {peptide && <PeptideTrainingCard med={peptide} doses={doses} workouts={ws} tz={s.tz} />}
      <MuscleWatchCard body={body.filter(mine)} units={settings.units} med={peptide} doses={doses} now={now} />

      {bal.sessions > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="bal-h">
          <h2 id="bal-h" className="text-sm font-medium text-muted mb-2">Sets per muscle, last 7 days</h2>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[15px] tnum">
            {bal.byMuscle.map((m) => <li key={m.id} className="flex justify-between"><span className={m.sets ? '' : 'text-muted'}>{m.name}</span><span>{m.sets}</span></li>)}
          </ul>
          <p className="text-[15px] mt-2 tnum">Push {bal.push} · pull {bal.pull} sets{bal.push && bal.pull && (bal.push / bal.pull > 1.5 || bal.pull / bal.push > 1.5) ? ` (${bal.push > bal.pull ? 'more pushing' : 'more pulling'})` : ''} · upper {bal.upper} · lower {bal.lower}</p>
          <p className="text-xs text-muted mt-1">Working sets: 1 for the main muscle, ½ for the others.</p>
        </section>
      )}

      {cardio.length > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="c-h">
          <h2 id="c-h" className="text-sm font-medium text-muted mb-1">Cardio</h2>
          {ACTIVITIES.filter((a) => cardio.some((w) => w.cardio!.activity === a.id && w.cardio!.distanceKm)).map((a) => {
            const bests = cardioBests(cardio, a.id).filter((b) => b.best);
            return bests.length ? <p key={a.id} className="text-[15px] tnum"><span className="font-medium">{a.name} bests</span>: {bests.map((b) => `${b.name} ${timeText(b.best!.min)}`).join(' · ')}</p> : null;
          })}
          <ul className="mt-1">
            {cardio.slice(0, 5).map((w) => (
              <li key={w.id} className="border-t border-border py-2 text-[15px] tnum">
                {format(Date.parse(w.startedAt), 'EEE d MMM')} · {ACTIVITIES.find((a) => a.id === w.cardio!.activity)?.name} {!w.endedAt ? 'in progress' : ''}{w.cardio!.distanceKm ? `${w.cardio!.distanceKm} km · ` : ''}{w.endedAt ? timeText(w.cardio!.durationMin) : ''}{w.cardio!.distanceKm ? ` · ${paceText(w.cardio!.durationMin / w.cardio!.distanceKm)}` : ''}{w.source === 'health' ? ' · from Health' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border pt-5 pb-3" aria-labelledby="h-h">
        <h2 id="h-h" className="text-sm font-medium text-muted mb-1">Workouts</h2>
        {ws.filter((w) => !w.cardio).length === 0 && <p className="text-muted">None yet. Start one above.</p>}
        <ul>
          {ws.filter((w) => !w.cardio).slice(0, 12).map((w) => {
            const sets = working(w.sets);
            return (
              <li key={w.id} className="border-t border-border">
                <a href={`#/training/workout/${w.id}`} className="block py-2.5 min-h-[48px]">
                  <span className="block">{w.name ?? 'Workout'} <span className="text-sm text-muted tnum">{format(Date.parse(w.startedAt), 'EEE d MMM')}</span></span>
                  <span className="block text-sm text-muted tnum">{[...new Set(sets.map((x) => x.exerciseId))].map((id) => defs.find((d) => d.id === id)?.name).join(', ') || 'No sets yet'}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {sheet === 'start' && <StartSheet personId={fam.personId} routines={routines.filter(mine)} workouts={ws} own={own} onClose={() => setSheet(null)} />}
      {sheet === 'cardio' && <CardioSheet personId={fam.personId} onClose={() => setSheet(null)} />}
      {sheet === 'goal' && <GoalSheet personId={fam.personId} own={own} existing={goals.find((g) => g.id === editGoal)} onClose={() => setSheet(null)} />}
      {sheet === 'plates' && <PlatesSheet barKg={settings.barKg} onClose={() => setSheet(null)} />}
    </div>
  );
}
