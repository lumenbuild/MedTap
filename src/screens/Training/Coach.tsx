// Training's path: the person's level (Beginner to Expert) and what the next one needs, the programme they're on and
// its next session (start it in one tap), when they're ready to move on, strength for body weight against the
// standards, and the bodyweight ladders. With the set-up and the programme library.
import { useState } from 'react';
import { ArrowUpCircle, Check, ChevronDown, GraduationCap, Library } from 'lucide-react';
import type { BodyEntry, CoachPlan, Person, Workout, WorkoutSet } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { setSetting } from '../../db/repos/settings';
import { newSetId, saveWorkout, setCoach, startCardio, startWorkout } from '../../db/repos/training';
import type { ExerciseDef } from '../../logic/exercises';
import {
  GOALS, KITS, LADDERS, LEVEL_NAMES, MAIN_LIFTS, PROGRAMS, assessLevel, levelName, nextSession, programById, readyToMoveOn, recommend,
  type Goal, type Kit, type Level, type PlannedItem, type Program,
} from '../../logic/coach';
import { e1rmSeries } from '../../logic/training';
import { plannedSets } from '../../logic/tagActions';
import { fmtLoad, roundLoad } from '../../logic/load';
import { go } from '../../app/router';
import { useToast } from '../../app/toast';
import { useTrainingContext } from './useTrainingContext';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Segmented, TextInput } from '../../components/ui/Field';

const DAY = 86_400_000;

/** The sets to log for a planned item: its prescribed weights, else the usual smart target for its sets and reps. */
function setsFor(it: PlannedItem, def: ExerciseDef, workouts: Workout[], units: Units, ctx: ReturnType<typeof useTrainingContext>, now: number): WorkoutSet[] {
  // A wave's or block's weights are set; on a low day (readiness under 50, or a usually weak day after a shot) they
  // come down about 10%, the same as the smart targets do.
  const ease = easeToday(ctx) ? 0.9 : 1;
  if (it.weights) return it.weights.map((w, i) => ({ id: newSetId(), exerciseId: def.id, weightKg: ease < 1 ? roundLoad(w * ease, def, units) : w, reps: it.repsBySet?.[i] ?? it.reps, done: false }));
  return plannedSets(def, workouts, { exerciseId: def.id, sets: it.sets, reps: it.reps, repsMax: it.repsMax }, newSetId, units, ctx ? { ...ctx, now } : undefined);
}

const easeToday = (ctx: ReturnType<typeof useTrainingContext>) => !!ctx && ((ctx.readiness !== null && ctx.readiness < 50) || ctx.weakDay);

/** Training maxes for the main lifts (90% of the recent estimated max), for wave and block programmes. */
function startMaxes(prog: Program, workouts: Workout[]): Record<string, number> | undefined {
  if (prog.scheme !== 'wave' && prog.scheme !== 'block') return undefined;
  const out: Record<string, number> = {};
  for (const l of MAIN_LIFTS) { const pts = e1rmSeries(l.id, workouts); if (pts.length) out[l.id] = Math.round(Math.max(...pts.slice(-4).map((p) => p.v)) * 0.9 * 2) / 2; }
  return out;
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PathCard({ personId, person, workouts, body, defs, units, moveSnooze, now }: {
  personId: string; person?: Person; workouts: Workout[]; body: BodyEntry[]; defs: ExerciseDef[]; units: Units; moveSnooze: number; now: number;
}) {
  const toast = useToast();
  const ctx = useTrainingContext(personId, now);
  const [sheet, setSheet] = useState<'setup' | 'library' | null>(null);
  const [how, setHow] = useState(false);
  const plan = person?.coach;

  if (!plan) {
    return (
      <section className="rounded-card bg-surface-2 p-4 space-y-3" aria-labelledby="path-h">
        <div className="flex items-center gap-2"><GraduationCap size={22} aria-hidden="true" className="text-primary" /><h2 id="path-h" className="font-semibold text-[17px]">Your training path</h2></div>
        <p className="text-[15px]">Tell the app your goal, days and equipment, and it writes every session for your level, adjusts it from your logs, and moves you up from Beginner to Expert as your numbers say you're ready.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setSheet('setup')}>Set up my plan</Button>
          <Button variant="secondary" onClick={() => setSheet('library')}>Programmes</Button>
        </div>
        {sheet === 'setup' && <Setup personId={personId} workouts={workouts} body={body} now={now} onClose={() => setSheet(null)} />}
        {sheet === 'library' && <LibrarySheet personId={personId} plan={undefined} workouts={workouts} onClose={() => setSheet(null)} />}
      </section>
    );
  }

  const info = assessLevel(plan, workouts, body, now);
  const s = nextSession(plan, workouts, body, defs, now);
  const move = moveSnooze > now ? null : readyToMoveOn(plan, info, workouts, defs, now);
  if (!s) return null;
  const prog = s.program;
  const preview = s.items.map((it) => {
    const def = defs.find((d) => d.id === it.exerciseId)!;
    const sets = setsFor(it, def, workouts, units, ctx, now);
    const ws = [...new Set(sets.map((x) => x.weightKg))];
    const reps = it.repsBySet ? it.repsBySet.join('/') : `${sets[0]?.reps ?? it.reps}${it.repsMax ? `–${it.repsMax}` : ''}`;
    return { it, def, sets, text: `${sets.length} × ${reps}${def.timed ? ' s' : ''}${ws.some((w) => w > 0) ? ` · ${ws.filter((w) => w > 0).map((w) => fmtLoad(w, units)).join(', ')}` : ''}` };
  });
  const begin = async () => {
    if (!preview.length && s.cardio) {
      const w = await startCardio(personId, 'run');
      await saveWorkout({ ...w, name: s.title });
      toast(`${s.title} started: ${s.cardio.text}`);
      return;
    }
    const w = await startWorkout(personId, { name: s.title, sets: preview.flatMap((p) => p.sets) });
    go(`/training/workout/${w.id}`);
  };
  const moveTo = async (to: Program) => {
    const before = await setCoach(personId, { ...plan, programId: to.id, startedAt: new Date().toISOString(), maxes: startMaxes(to, workouts) ?? plan.maxes });
    toast(`Now on ${to.name}`, { onAction: () => setCoach(personId, before) });
  };
  const lvl = info.level;

  return (
    <section className="space-y-4" aria-labelledby="path-h">
      <div className="rounded-card bg-surface-2 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <GraduationCap size={22} aria-hidden="true" className="text-primary shrink-0" />
          <h2 id="path-h" className="font-semibold text-[17px] flex-1">{levelName(lvl)}</h2>
          <span className="text-sm text-muted tnum">Level {lvl} of 5</span>
        </div>
        <ol className="grid grid-cols-5 gap-1" aria-label={`Level ${lvl} of 5: ${levelName(lvl)}`}>
          {LEVEL_NAMES.map((n, i) => <li key={n} className={`h-2 rounded-full ${i < lvl ? 'bg-primary' : 'bg-border'}`} title={n} />)}
        </ol>
        {info.next && info.next.needs.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">For {levelName(info.next.level)}</p>
            <ul className="space-y-2">
              {info.next.needs.slice(0, 4).map((n) => (
                <li key={n.text} className="space-y-1">
                  <p className="text-sm">{n.text}</p>
                  <div className="h-1.5 rounded-full bg-border overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round(n.progress * 100))}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {lvl === 5 && <p className="text-sm text-muted">Expert: from here it's about long blocks, peaking and keeping it going.</p>}
      </div>

      {move && (
        <div className="rounded-card bg-success-soft p-4 space-y-2" role="status">
          <p className="flex items-center gap-2 font-semibold"><ArrowUpCircle size={20} aria-hidden="true" className="text-success" /> Ready for {move.to.name}</p>
          <ul className="list-disc pl-5 text-[15px] space-y-1">{move.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="text-sm text-muted">{move.to.summary}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => moveTo(move.to)}>Move up</Button>
            <Button variant="secondary" onClick={() => setSetting('coachMoveSnooze', now + 28 * DAY)}>Not yet</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium text-muted flex-1">Next: {prog.name}</h3>
          <button type="button" className="text-sm font-medium underline underline-offset-4 min-h-[44px]" onClick={() => setSheet('library')}>Change</button>
        </div>
        {easeToday(ctx) && <p className="text-sm rounded-btn bg-caution-soft px-3 py-2">{ctx!.weakDay ? 'Usually one of your weaker days after a shot' : `Readiness ${ctx!.readiness} today`}: weights about 10% lighter. Same sets and reps.</p>}
        {ctx?.strongest && <p className="text-sm text-muted">Your strongest sessions are usually on {ctx.strongest.weekday}s ({ctx.strongest.day === 0 ? 'shot day' : `day ${ctx.strongest.day} after your shot`}){plan.weekdays?.length && !plan.weekdays.some((w) => WEEKDAY_LONG[w] === ctx.strongest!.weekday) ? '. It isn’t one of your training days: worth moving one there' : ': put the heaviest session there'}.</p>}
        <p className="font-semibold text-[17px]">{s.day.name}{s.phase ? <span className="font-normal text-muted"> · {s.phase}</span> : null}<span className="font-normal text-muted tnum"> · about {s.minutes} min</span></p>
        {s.cut && <p className="text-sm text-muted">{s.cut}</p>}
        <ul className="divide-y divide-border">
          {preview.map((p) => (
            <li key={p.it.exerciseId + p.it.reps} className="py-2">
              <div className="flex items-baseline gap-2">
                <span className={`flex-1 min-w-0 ${p.it.main ? 'font-medium' : ''}`}>{p.def.name}</span>
                <span className="text-sm text-muted tnum shrink-0">{p.text}</span>
              </div>
              {p.it.note && <p className="text-xs text-muted mt-0.5">{p.it.note}</p>}
            </li>
          ))}
          {s.cardio && <li className="py-2 flex items-baseline gap-2"><span className="flex-1">{s.cardio.kind === 'intervals' ? 'Intervals' : 'Cardio'}</span><span className="text-sm text-muted">{s.cardio.text}</span></li>}
        </ul>
        <Button className="w-full min-h-[56px]" onClick={begin}>Start this session</Button>
        <button type="button" className="w-full min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-medium" aria-expanded={how} onClick={() => setHow((x) => !x)}>
          How this programme works <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${how ? 'rotate-180' : ''}`} />
        </button>
        {how && (
          <div className="rounded-btn bg-surface-2 p-3 space-y-2 text-[15px]">
            <p>{prog.summary}</p>
            <ul className="list-disc pl-5 space-y-1">{prog.how.map((h) => <li key={h}>{h}</li>)}</ul>
            <p className="text-sm text-muted">Session {s.n + 1} since you started it{prog.next ? `. Next programme: ${programById(prog.next)!.name}.` : '.'}</p>
            <button type="button" className="text-sm underline underline-offset-4 min-h-[44px]" onClick={() => setSheet('setup')}>Change goal, days or equipment</button>
          </div>
        )}
      </div>

      {info.lifts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted mb-2">Strength for body weight</h3>
          <ul className="space-y-3">
            {info.lifts.map((l) => (
              <li key={l.id} className="space-y-1">
                <div className="flex items-baseline gap-2 text-sm"><span className="font-medium flex-1">{l.name}</span><span className="tnum">{l.ratio}× · {levelName(l.level)}</span></div>
                <div className="relative h-2 rounded-full bg-border" role="img" aria-label={`${l.name}: ${l.ratio} times body weight, ${levelName(l.level)}`}>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.min(100, (l.level - 1) * 20 + 20 * Math.min(1, l.nextRatio ? (l.ratio / l.nextRatio) : 1))}%` }} />
                  {[1, 2, 3, 4].map((i) => <span key={i} aria-hidden="true" className="absolute top-[-2px] bottom-[-2px] w-px bg-text/40" style={{ left: `${i * 20}%` }} />)}
                </div>
                {l.nextKg && <p className="text-xs text-muted tnum">{levelName((l.level + 1) as Level)} at about {fmtLoad(l.nextKg, units)}{l.eta ? `, likely around ${new Date(l.eta).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}</p>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-2">Rough guides from widely shared strength tables, against your estimated max and latest weigh-in.</p>
        </div>
      )}

      {info.ladders && (
        <div>
          <h3 className="text-sm font-medium text-muted mb-2">Bodyweight ladders</h3>
          <ul className="space-y-3">
            {info.ladders.map((x) => (
              <li key={x.ladder.id}>
                <div className="flex items-baseline gap-2 text-sm"><span className="font-medium flex-1">{x.ladder.name}</span><span className="text-muted">{defs.find((d) => d.id === x.ladder.steps[x.step])?.name}</span></div>
                <ol className="flex gap-1 mt-1" aria-label={`${x.ladder.name}: step ${x.step + 1} of ${x.ladder.steps.length}`}>
                  {x.ladder.steps.map((id, i) => <li key={id} title={defs.find((d) => d.id === id)?.name} className={`h-2 flex-1 rounded-full ${i <= x.step ? 'bg-primary' : 'bg-border'}`} />)}
                </ol>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-2">Each step takes over once you hit its target ({LADDERS[0].target.sets} × {LADDERS[0].target.reps} for pushing) in two sessions.</p>
        </div>
      )}

      {sheet === 'setup' && <Setup personId={personId} plan={plan} workouts={workouts} body={body} now={now} onClose={() => setSheet(null)} />}
      {sheet === 'library' && <LibrarySheet personId={personId} plan={plan} workouts={workouts} onClose={() => setSheet(null)} />}
    </section>
  );
}

/** Goal, days, time, equipment, experience and whether to compare with strength standards; then the programme picked. */
function Setup({ personId, plan, workouts, body, now, onClose }: { personId: string; plan?: CoachPlan; workouts: Workout[]; body: BodyEntry[]; now: number; onClose: () => void }) {
  const toast = useToast();
  const [goal, setGoal] = useState<Goal>(plan?.goal ?? 'strength');
  const [days, setDays] = useState(plan?.days ?? 3);
  const [weekdays, setWeekdays] = useState<number[]>(plan?.weekdays ?? []);
  const [minutes, setMinutes] = useState(plan?.minutes ?? 60);
  const [ownTime, setOwnTime] = useState(![30, 45, 60, 90].includes(plan?.minutes ?? 60));
  const [timeText, setTimeText] = useState(String(plan?.minutes ?? 60));
  const [kit, setKit] = useState<Kit>(plan?.kit ?? 'gym');
  const [experience, setExperience] = useState<CoachPlan['experience']>(plan?.experience ?? 0);
  const [standards, setStandards] = useState<CoachPlan['standards']>(plan?.standards ?? null);
  const draft = { goal, kit, experience, standards };
  const level = assessLevel(draft, workouts, body, now).level;
  const rec = recommend(goal, level, kit, days);
  const save = async () => {
    const same = plan?.programId === rec.id;
    const before = await setCoach(personId, { goal, days, minutes, kit, experience, standards, programId: rec.id, weekdays: weekdays.length === days ? weekdays : undefined,
      startedAt: same ? plan!.startedAt : new Date().toISOString(), maxes: same ? plan!.maxes : startMaxes(rec, workouts) });
    toast(same ? 'Plan updated' : `Your plan: ${rec.name}`, { onAction: () => setCoach(personId, before) });
    onClose();
  };
  const Pick = <T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; name: string; what?: string }[]; onChange: (v: T) => void }) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium mb-1">{label}</legend>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`w-full text-left rounded-btn border p-3 min-h-[52px] ${value === o.v ? 'border-primary bg-primary-soft' : 'border-border'}`}>
          <span className="block font-medium">{o.name}</span>
          {o.what && <span className="block text-sm text-muted">{o.what}</span>}
        </button>
      ))}
    </fieldset>
  );
  return (
    <Sheet open onClose={onClose} title={plan ? 'Your plan' : 'Set up your plan'}>
      <div className="space-y-5">
        <Pick label="What it's for" value={goal} onChange={setGoal} options={GOALS.map((g) => ({ v: g.id, name: g.name, what: g.what }))} />
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Days a week</span>
          <Segmented label="Days a week" value={String(days)} onChange={(v) => { setDays(Number(v)); if (weekdays.length && weekdays.length !== Number(v)) setWeekdays([]); }} options={[2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }))} />
          <fieldset>
            <legend className="text-sm text-muted mt-2 mb-1">Which days (optional: reminders come on these)</legend>
            <div className="grid grid-cols-7 gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((w) => {
                const on = weekdays.includes(w);
                return <button key={w} type="button" role="checkbox" aria-checked={on} aria-label={WEEKDAY_LONG[w]}
                  onClick={() => { const next = on ? weekdays.filter((x) => x !== w) : [...weekdays, w].sort(); setWeekdays(next); if (next.length >= 2 && next.length <= 6) setDays(next.length); }}
                  className={`min-h-[44px] rounded-btn text-sm font-medium ${on ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>{WEEKDAY_LONG[w].slice(0, 2)}</button>;
              })}
            </div>
          </fieldset>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">About how long</span>
          <Segmented label="Minutes a session" value={ownTime ? 'other' : String(minutes)} onChange={(v) => { if (v === 'other') setOwnTime(true); else { setOwnTime(false); setMinutes(Number(v)); } }}
            options={[...[30, 45, 60, 90].map((m) => ({ value: String(m), label: `${m} min` })), { value: 'other', label: 'Other' }]} />
          {ownTime && <TextInput label="Minutes a session" type="number" inputMode="numeric" min="15" max="240" step="5" value={timeText} onChange={(e) => {
            setTimeText(e.target.value); const n = Math.round(Number(e.target.value)); if (n >= 15 && n <= 240) setMinutes(n); }} help="15 to 240. Sessions are cut to fit, extras first." />}
        </div>
        <Pick label="Where" value={kit} onChange={setKit} options={KITS.map((k) => ({ v: k.id, name: k.name, what: k.what }))} />
        <Pick label="Training before now" value={experience} onChange={setExperience} options={[
          { v: 0 as const, name: 'New to it', what: 'Never, or not for years' }, { v: 1 as const, name: 'Some', what: 'A few months, on and off' }, { v: 2 as const, name: 'A lot', what: 'A year or more, regularly' }]} />
        <Pick label="Compare strength with" value={standards ?? 'none'} onChange={(v) => setStandards(v === 'none' ? null : v as 'f' | 'm')} options={[
          { v: 'f', name: 'Women’s standards' }, { v: 'm', name: 'Men’s standards' }, { v: 'none', name: 'Don’t compare', what: 'Levels come from training time and progress only' }]} />
        <div className="rounded-btn bg-surface-2 p-3">
          <p className="text-sm text-muted">Your level from what you've logged: {levelName(level)}. The programme for that:</p>
          <p className="font-semibold mt-1">{rec.name}</p>
          <p className="text-[15px]">{rec.summary}</p>
          {!rec.days.includes(days) && <p className="text-sm text-muted mt-1">It runs best on {rec.days.join(' or ')} days a week.</p>}
        </div>
        <SheetActions><Button className="w-full min-h-[56px]" onClick={save}>{plan ? 'Save' : 'Start this plan'}</Button></SheetActions>
      </div>
    </Sheet>
  );
}

/** Every programme by goal and level, to choose one by name. */
function LibrarySheet({ personId, plan, workouts, onClose }: { personId: string; plan?: CoachPlan; workouts: Workout[]; onClose: () => void }) {
  const toast = useToast();
  const use = async (p: Program) => {
    const base: CoachPlan = plan ?? { goal: p.goal, days: p.days[0], minutes: 60, kit: p.kits[0], experience: p.levels[0] >= 3 ? 2 : p.levels[0] === 2 ? 1 : 0, standards: null, programId: p.id, startedAt: '' };
    const before = await setCoach(personId, { ...base, goal: p.goal, programId: p.id, days: p.days.includes(base.days) ? base.days : p.days[0], kit: p.kits.includes(base.kit) ? base.kit : p.kits[0],
      startedAt: new Date().toISOString(), maxes: startMaxes(p, workouts) });
    toast(`Now on ${p.name}`, { onAction: () => setCoach(personId, before) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Programmes">
      <div className="space-y-6">
        {GOALS.map((g) => (
          <div key={g.id}>
            <h3 className="text-sm font-medium text-muted mb-2 flex items-center gap-1.5"><Library size={16} aria-hidden="true" /> {g.name}</h3>
            <ul className="space-y-2">
              {PROGRAMS.filter((p) => p.goal === g.id).map((p) => (
                <li key={p.id} className="rounded-btn border border-border p-3 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium flex-1">{p.name}</span>
                    {plan?.programId === p.id && <span className="text-sm text-success flex items-center gap-1"><Check size={14} aria-hidden="true" /> Yours</span>}
                  </div>
                  <p className="text-sm text-muted">{p.levels[0] === p.levels[1] ? levelName(p.levels[0]) : `${levelName(p.levels[0])} to ${levelName(p.levels[1])}`} · {p.days.join(', ')} days a week · {p.kits.map((k) => KITS.find((x) => x.id === k)!.name.toLowerCase()).join(', ')}</p>
                  <p className="text-[15px]">{p.summary}</p>
                  {plan?.programId !== p.id && <Button variant="secondary" className="mt-1" onClick={() => use(p)}>Use this</Button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
