import { BellRing, Disc, Flame, Footprints, ListChecks, Nfc, Plus } from 'lucide-react';
import { MiniRing, Sparkline, Tile } from '../../components/ui/Visual';
// The Training tab (MedTap): start or continue a workout, readiness, the week, goals, personal bests, plateaus,
// strength against the peptide, lean mass, muscle balance, cardio and the history.
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  useBodyEntries, useCheckIns, useDaily, useDoses, useExercises, useFamily, useMeds, useRoutines, useScheduleSettings, useWorkouts,
} from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { allExercises } from '../../logic/exercises';
import {
  cardioBests, e1rmSeries, fitnessGoalStatus, newPBs, personalBests, plateau, readiness, timeText, trainingCalendar, weeklyBalance, working, paceText,
} from '../../logic/training';
import { useNow } from '../../app/useNow';
import { go, replace } from '../../app/router';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { GoalTimeline, PeptideTrainingCard, ReadinessBlock } from '../../components/Fitness';
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
import type { Workout } from '../../db/schema';
import { TrendChart } from '../../components/charts/TrendChart';
import { PathCard } from './Coach';
import { programById } from '../../logic/coach';

const DAY = 86_400_000;

/** `start`: opened from Today's Start a workout (#/training/start), so the start sheet is already open. */
export function Training({ start = false }: { start?: boolean }) {
  const workouts = useWorkouts(); const own = useExercises(); const routines = useRoutines(); const fam = useFamily(); const ss = useScheduleSettings();
  const daily = useDaily(); const checkIns = useCheckIns(); const body = useBodyEntries(); const meds = useMeds(); const doses = useDoses();
  const now = useNow(60_000);
  const toast = useToast();
  const [sheet, setSheet] = useState<'start' | 'cardio' | 'goal' | 'plates' | null>(start ? 'start' : null);
  const [editGoal, setEditGoal] = useState<string | null>(null);
  const [allLifts, setAllLifts] = useState(false);
  const [allWorkouts, setAllWorkouts] = useState(false);
  // Once the start sheet opened from Today closes, the address goes back to plain Training (so a reload doesn't reopen it).
  useEffect(() => { if (start && sheet === null) replace('/training'); }, [start, sheet]);
  if (!workouts || !own || !routines || !fam || !ss || !daily || !checkIns || !body || !meds || !doses) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => personOf(r) === fam.personId && !r.deletedAt;
  const ws = workouts.filter(mine).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const defs = allExercises(own);
  const person = fam.people.find((p) => p.id === fam.personId);
  const goals = person?.fitnessGoals ?? [];
  const open = ws.find((w) => !w.endedAt && w.sets.length >= 0 && now - Date.parse(w.startedAt) < 6 * 3_600_000 && !w.cardio);
  const ready = readiness(daily.filter(mine), checkIns.filter(mine), now, s);
  // The weekly sessions goal: one set by hand, or else the coach plan's days a week.
  const ownGoal = goals.find((g) => g.kind === 'sessions');
  const sessionsGoal = ownGoal ?? (person?.coach ? { perWeek: person.coach.days } : undefined);
  const cal = trainingCalendar(ws, now, s, sessionsGoal?.perWeek ?? 0, 8);
  const bal = weeklyBalance(ws, defs, now);
  const lifted = [...new Set(ws.flatMap((w) => working(w.sets).map((x) => x.exerciseId)))];
  const recentPBs = ws.filter((w) => Date.parse(w.startedAt) > now - 14 * DAY).flatMap((w) => newPBs(w, ws, defs, settings.units).map((p) => ({ ...p, t: Date.parse(w.startedAt) })));
  const flats = lifted.map((id) => plateau(id, ws, now)).filter(Boolean);
  const peptide = settings.peptideTools ? meds.find((m) => m.peptide && !m.archived && medIsFor(m, fam.personId)) : undefined;
  const cardio = ws.filter((w) => w.cardio);
  const habit = trainingHabit(ws, now, s);
  const lighter = lighterWeekDue(ws, defs, now, settings.lighterLast || undefined);
  const stalled = flats.map((f) => `${defs.find((d) => d.id === f!.exerciseId)?.name}${f!.harder ? ' (feeling harder)' : ''}`);
  // Programmes with their own lighter weeks (waves, blocks, volume) plan them; the app doesn't suggest another.
  const coachPlansLighter = !!person?.coach && ['wave', 'block', 'volume'].includes(programById(person.coach.programId)?.scheme ?? '');
  const pushable = lifted.map((id) => effortCheck(id, ws, now)).filter((e) => e.status === 'room');
  const recentLifts = lifted.slice(0, allLifts ? lifted.length : 3);
  const strength = ws.filter((w) => !w.cardio);
  const maxCal = Math.max(1, ...cal.weeks.map((x) => x.sessions), sessionsGoal?.perWeek ?? 0);

  return (
    <div className="space-y-2">
      <PersonSwitcher />
      <PathCard personId={fam.personId} person={person} workouts={ws} body={body.filter(mine)} defs={defs} units={settings.units} moveSnooze={settings.coachMoveSnooze} now={now} />
      <section className="border-t border-border pt-5 pb-3 space-y-2">
        {open ? <Button className="w-full min-h-[56px]" onClick={() => go(`/training/workout/${open.id}`)}>Continue workout ({Math.round((now - Date.parse(open.startedAt)) / 60_000)} min)</Button>
          : <Button className="w-full min-h-[56px]" onClick={() => setSheet('start')}>Start a workout</Button>}
        {ws.filter((w) => w.cardio && !w.endedAt && now - Date.parse(w.startedAt) < 6 * 3_600_000).map((w) => (
          <p key={w.id} className="text-[15px] rounded-btn bg-surface-2 p-3 tnum">
            {ACTIVITIES.find((a) => a.id === w.cardio!.activity)?.name} · {Math.round((now - Date.parse(w.startedAt)) / 60_000)} min
            <button type="button" className="block mt-1 underline min-h-[44px]" onClick={() => finishCardio(w)}>Finish now</button>
          </p>
        ))}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <Tile Icon={Footprints} label="Cardio" name="Log cardio" onClick={() => setSheet('cardio')} />
          <Tile Icon={ListChecks} label="Routines" onClick={() => go('/training/routines')} />
          <Tile Icon={Disc} label="Plates" onClick={() => setSheet('plates')} />
          <Tile Icon={Nfc} label="Tags" onClick={() => go('/tags')} />
        </div>
      </section>

      {habit && isNative && !settings.trainingReminders && !settings.trainingReminderAsked && (
        <section className="border-t border-border pt-4 pb-2" aria-label="Training reminders">
          <p className="text-[15px] flex items-center gap-2"><BellRing size={18} aria-hidden="true" /> You train {habitText(habit)}. Remind you?</p>
          <div className="flex gap-4">
            <button type="button" className="min-h-[44px] font-medium underline underline-offset-4" onClick={async () => { const on = await setTrainingReminders(true); toast(on ? 'Reminders on for your usual training days' : 'Notifications are off for this app. Turn them on in your phone’s settings.'); }}>Remind me</button>
            <button type="button" className="min-h-[44px] text-muted underline underline-offset-4" onClick={() => setSetting('trainingReminderAsked', true)}>No thanks</button>
          </div>
        </section>
      )}

      {ready && <section className="border-t border-border pt-5 pb-1"><ReadinessBlock r={ready} /></section>}

      <section className="border-t border-border pt-5 pb-1" aria-labelledby="wk-h">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="wk-h" className="text-sm font-medium text-muted">Sessions this week</h2>
            {cal.streak ? <p className="text-sm tnum flex items-center gap-1"><Flame size={14} aria-hidden="true" className="text-caution" />{cal.streak}-week streak</p> : null}
          </div>
          <MiniRing value={cal.thisWeek} max={sessionsGoal?.perWeek ?? Math.max(cal.thisWeek, 3)} size={52} tone={sessionsGoal && cal.thisWeek >= sessionsGoal.perWeek! ? 'good' : 'primary'}
            label={`${cal.thisWeek} this week${sessionsGoal ? ` of ${sessionsGoal.perWeek}` : ''}`}>{sessionsGoal ? `${cal.thisWeek}/${sessionsGoal.perWeek}` : cal.thisWeek}</MiniRing>
        </div>
        {cal.weeks.some((x) => x.sessions) && (
          <div className="mt-2" role="img" aria-label={`Sessions in each of the last ${cal.weeks.length} weeks: ${cal.weeks.map((x) => x.sessions).join(', ')}`}>
            <div className="relative flex items-end gap-1.5 h-16" aria-hidden="true">
              {sessionsGoal && <div className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${(sessionsGoal.perWeek! / maxCal) * 100 * 0.8}%`, borderColor: 'var(--border-strong)' }} />}
              {cal.weeks.map((x, i) => (
                <div key={x.start} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-[11px] tnum text-muted">{x.sessions || ''}</span>
                  <div className="w-full rounded-[3px]" style={{ height: `${(x.sessions / maxCal) * 80}%`, minHeight: x.sessions ? 3 : 0,
                    background: i === cal.weeks.length - 1 ? 'var(--text)' : 'var(--border-strong)' }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-muted mt-1" aria-hidden="true"><span>{cal.weeks.length} weeks ago</span><span>This week</span></div>
          </div>
        )}
        {person?.coach && !ownGoal && <p className="text-xs text-muted">Goal: {person.coach.days} a week, from your plan</p>}
        {!sessionsGoal && <button type="button" className="text-sm underline underline-offset-4 min-h-[44px]" onClick={() => { setEditGoal(null); setSheet('goal'); }}>Set a weekly goal</button>}
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
        <button type="button" className="flex items-center gap-2 text-sm font-medium min-h-[44px]" onClick={() => { setEditGoal(null); setSheet('goal'); }}><Plus size={16} aria-hidden="true" /> Add a goal</button>
      </section>

      {lifted.length > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="pb-h">
          <h2 id="pb-h" className="text-sm font-medium text-muted mb-1">Personal bests</h2>
          {recentPBs.length > 0 && <ul className="mb-2">{onePerLift(recentPBs).slice(0, 3).map((p, i) => <li key={i} className="text-[15px]"><span className="font-medium">{defs.find((d) => d.id === p.exerciseId)?.name}</span>: {p.text} <span className="text-xs text-muted">{format(p.t, 'd MMM')}</span></li>)}</ul>}
          <ul>
            {recentLifts.map((id) => {
              const pb = personalBests(id, ws);
              return (
                <li key={id} className="border-t border-border">
                  <a href={`#/training/exercise/${id}`} className="flex items-center justify-between gap-3 py-2.5 min-h-[48px]">
                    <span className="min-w-0 flex-1">{defs.find((d) => d.id === id)?.name ?? 'Exercise'}</span>
                    {!defs.find((d) => d.id === id)?.timed && <span className="w-[56px] shrink-0"><Sparkline points={e1rmSeries(id, ws).slice(-12)} height={24} label={`Estimated max over recent sessions`} /></span>}
                    <span className="text-sm tnum text-muted text-right shrink-0 whitespace-nowrap">{defs.find((d) => d.id === id)?.timed ? (pb.mostReps ? `${pb.mostReps.reps} s` : '') : pb.e1rm ? `max ~${fmtLoad(pb.e1rm.v, settings.units)}` : pb.mostReps ? `${pb.mostReps.reps} reps` : ''}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          {lifted.length > 3 && <ShowAll open={allLifts} n={lifted.length} what="lifts" onClick={() => setAllLifts((x) => !x)} />}
        </section>
      )}

      {settings.lighterUntil > now && (
        <section className="border-t border-border pt-4 pb-1" aria-label="Lighter week">
          <p className="text-[15px]"><span className="font-medium">Lighter week</span> until {format(settings.lighterUntil - 1, 'EEE d MMM')}: targets are about 10% lighter with a set fewer.</p>
          <button type="button" className="min-h-[44px] text-sm underline underline-offset-4" onClick={() => setSetting('lighterUntil', 0)}>End it now</button>
        </section>
      )}
      {settings.lighterUntil <= now && !coachPlansLighter && (lighter || flats.length > 0) && (
        <section className="border-t border-border pt-4 pb-1" aria-label="A lighter week is due">
          <p className="text-[15px] font-medium">Time for a lighter week?</p>
          <p className="text-[15px]">{lighter ? `${lighter.reason}${lighter.lifts.length ? ` (${lighter.lifts.join(', ')})` : ''} ` : ''}{stalled.length ? `No improvement for about 3 weeks: ${stalled.join(', ')}. ` : ''}A week at about 90% with a set fewer usually brings progress back.</p>
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
          <p className="text-xs text-muted mt-1">From RPE and your trend</p>
        </section>
      )}


      {peptide && <PeptideTrainingCard med={peptide} doses={doses} workouts={ws} tz={s.tz} />}

      {bal.sessions > 0 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="bal-h">
          <h2 id="bal-h" className="text-sm font-medium text-muted mb-2">Sets per muscle, last 7 days</h2>
          <ul className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[15px] tnum">
            {bal.byMuscle.map((m) => {
              const max = Math.max(1, ...bal.byMuscle.map((x) => x.sets));
              return (
                <li key={m.id} aria-label={`${m.name}: ${m.sets} sets`}>
                  <span className="flex justify-between" aria-hidden="true"><span className={m.sets ? '' : 'text-muted'}>{m.name}</span><span className={m.sets ? 'font-medium' : 'text-muted'}>{m.sets}</span></span>
                  <span className="block h-1.5 rounded-full bg-surface-2 mt-0.5" aria-hidden="true"><span className="block h-full rounded-full bg-text" style={{ width: `${(m.sets / max) * 100}%` }} /></span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 space-y-2">
            <SplitBar left="Push" right="Pull" a={bal.push} b={bal.pull} />
            <SplitBar left="Upper" right="Lower" a={bal.upper} b={bal.lower} />
          </div>
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
          <PaceChart cardio={cardio} now={now} />
          <ul className="mt-1">
            {cardio.slice(0, 3).map((w) => (
              <li key={w.id} className="border-t border-border py-2 text-[15px] tnum">
                {format(Date.parse(w.startedAt), 'EEE d MMM')} · {ACTIVITIES.find((a) => a.id === w.cardio!.activity)?.name} {!w.endedAt ? 'in progress' : ''}{w.cardio!.distanceKm ? `${w.cardio!.distanceKm} km · ` : ''}{w.endedAt ? timeText(w.cardio!.durationMin) : ''}{w.cardio!.distanceKm ? ` · ${paceText(w.cardio!.durationMin / w.cardio!.distanceKm)}` : ''}{w.source === 'health' ? ' · from Health' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border pt-5 pb-3" aria-labelledby="h-h">
        <h2 id="h-h" className="text-sm font-medium text-muted mb-1">Workouts</h2>
        {strength.length === 0 && <p className="text-muted">None yet. Start one above.</p>}
        <ul>
          {strength.slice(0, allWorkouts ? 60 : 5).map((w) => {
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
        {strength.length > 5 && <ShowAll open={allWorkouts} n={strength.length} what="workouts" onClick={() => setAllWorkouts((x) => !x)} />}
      </section>

      {sheet === 'start' && <StartSheet personId={fam.personId} routines={routines.filter(mine)} workouts={ws} own={own} onClose={() => setSheet(null)} />}
      {sheet === 'cardio' && <CardioSheet personId={fam.personId} onClose={() => setSheet(null)} />}
      {sheet === 'goal' && <GoalSheet personId={fam.personId} own={own} existing={goals.find((g) => g.id === editGoal)} onClose={() => setSheet(null)} />}
      {sheet === 'plates' && <PlatesSheet barKg={settings.barKg} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** Two sides of a whole (push against pull, upper against lower) as one bar split where they meet. */
function SplitBar({ left, right, a, b }: { left: string; right: string; a: number; b: number }) {
  const t = a + b;
  if (!t) return null;
  return (
    <div role="img" aria-label={`${left} ${a} sets, ${right.toLowerCase()} ${b}`}>
      <div className="flex justify-between text-sm tnum" aria-hidden="true"><span>{left} <span className="font-semibold">{a}</span></span><span><span className="font-semibold">{b}</span> {right.toLowerCase()}</span></div>
      <div className="flex h-2.5 rounded-full overflow-hidden mt-1 gap-[2px]" aria-hidden="true">
        <span className="h-full bg-text" style={{ width: `${(a / t) * 100}%` }} />
        <span className="h-full" style={{ width: `${(b / t) * 100}%`, background: 'var(--border-strong)' }} />
      </div>
    </div>
  );
}

/** Pace over time for the activity done most (lower is faster). */
function PaceChart({ cardio, now }: { cardio: Workout[]; now: number }) {
  const runs = cardio.filter((w) => w.endedAt && w.cardio?.distanceKm && w.cardio.durationMin);
  const counts = new Map<string, number>();
  for (const w of runs) counts.set(w.cardio!.activity, (counts.get(w.cardio!.activity) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 3) return null;
  const pts = runs.filter((w) => w.cardio!.activity === top[0]).map((w) => ({ t: Date.parse(w.startedAt), v: w.cardio!.durationMin / w.cardio!.distanceKm! })).sort((a, b) => a.t - b.t);
  const name = ACTIVITIES.find((a) => a.id === top[0])?.name ?? 'Cardio';
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{name} pace, minutes per km (lower is faster)</p>
      <TrendChart bare noLegend height={170} title={`${name} pace`} start={pts[0].t - 86_400_000} end={now} labelFmt={(v) => paceText(v).replace(' /km', '')}
        fmt={(v) => paceText(v)} series={[{ label: 'Pace', style: 'line', points: pts }]} />
    </div>
  );
}

/** The newest personal best of each lift (one session can set several for the same lift). */
const onePerLift = <T extends { exerciseId: string; t: number }>(pbs: T[]) =>
  [...pbs].sort((a, b) => b.t - a.t).filter((p, i, all) => all.findIndex((x) => x.exerciseId === p.exerciseId) === i);

function ShowAll({ open, n, what, onClick }: { open: boolean; n: number; what: string; onClick: () => void }) {
  return <button type="button" className="text-sm font-medium underline underline-offset-4 min-h-[44px]" aria-expanded={open} onClick={onClick}>{open ? 'Show fewer' : `Show all ${n} ${what}`}</button>;
}
