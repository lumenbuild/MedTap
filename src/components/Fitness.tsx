// Fitness cards used on Training, Body, Protocol and Today: readiness, lean mass while losing weight, strength against
// the peptide, and one timeline for every goal.
import { format } from 'date-fns';
import type { BodyEntry, BodyGoal, DailyHealth, Dose, FitnessGoal, Medication, Workout } from '../db/schema';
import { addIntake } from '../db/repos/training';
import { useToast } from '../app/toast';
import type { Units } from '../db/repos/settings';
import type { ScheduleSettings } from '../logic/schedule';
import { muscleWatch, trainingVsPeptide, fitnessGoalStatus, type Readiness } from '../logic/training';
import type { ExerciseDef } from '../logic/exercises';
import { goalView, valueFmt } from '../screens/Body/Goals';
import { kgTo, weightUnit } from '../logic/units';
import { shownName } from '../logic/privacy';
import { fmtAmount } from '../logic/format';

const DAY = 86_400_000;
const andList = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const LONG = ['shot day', 'day 1', 'day 2', 'day 3', 'day 4', 'day 5', 'day 6'];

export function ReadinessBlock({ r, compact = false }: { r: Readiness; compact?: boolean }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted">Ready to train</p>
      <p className={compact ? 'text-[17px]' : 'text-[28px] font-light'}><span className="tnum">{r.score}</span> · {r.label}</p>
      {!compact && <ul className="text-[15px] tnum mt-1">{r.parts.map((p) => <li key={p.what} className={p.good ? '' : 'text-caution'}>{p.what}: {p.text}</li>)}</ul>}
      {!compact && <p className="text-xs text-muted mt-1">Against your own last 4 weeks. On a low day, a lighter session or rest may suit you better.</p>}
    </div>
  );
}

/** How much of the weight lost was lean mass, overall and per dose step. */
export function MuscleWatchCard({ body, units, med, doses, now }: { body: BodyEntry[]; units: Units; med?: Medication; doses: Dose[]; now: number }) {
  const w = muscleWatch(body, med, doses, now);
  const u = weightUnit(units);
  const k = (v: number) => `${kgTo(v, units)} ${u}`;
  const line = (x: NonNullable<typeof w.overall>) => `${k(x.weightLost)} lost, about ${k(Math.max(0, x.leanLost))} of it lean mass (${Math.round(Math.max(0, x.share) * 100)}%)`;
  const high = (s: number) => s > 0.35;
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="lean-h">
      <h2 id="lean-h" className="text-sm font-medium text-muted mb-1">Lean mass while losing weight</h2>
      {!w.overall ? (
        <p className="text-[15px] text-muted">{w.points < 2 ? 'Log body fat % or lean mass with your weight (from a smart scale or a scan) at least twice to see how much of what you lose is lean mass.' : 'Shows once you\'ve lost 2+ kg between two body composition entries.'}</p>
      ) : (
        <>
          <p className={`text-[17px] tnum ${high(w.overall.share) ? 'text-caution' : ''}`}>{line(w.overall)}</p>
          <p className="text-sm text-muted tnum">{format(w.overall.from, 'd MMM')} – {format(w.overall.to, 'd MMM yyyy')}</p>
          {w.steps.length > 0 && <ul className="text-[15px] tnum mt-2">{w.steps.map((s) => <li key={s.dose}>{med ? fmtAmount(s.dose, med.unit) : s.dose}: {line(s)}</li>)}</ul>}
          {(high(w.overall.share) || w.steps.some((s) => high(s.share))) && <p className="text-[15px] mt-2">More than about a third of the loss as lean mass is worth raising with your prescriber. Strength training and protein are the usual ways to hold on to muscle.</p>}
        </>
      )}
      <p className="text-xs text-muted mt-1">Lean mass from your entries (or weight × (1 − body fat %)). Scales estimate it; scans are more accurate.</p>
    </section>
  );
}

/** Strength by days since the shot and by dose. */
export function PeptideTrainingCard({ med, doses, workouts }: { med: Medication; doses: Dose[]; workouts: Workout[] }) {
  const r = trainingVsPeptide(med, doses, workouts);
  if (!r) return null;
  const known = r.byDay.filter((d) => d.pct !== undefined);
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="pt-h">
      <h2 id="pt-h" className="text-sm font-medium text-muted mb-2">Strength and {shownName(med)}</h2>
      <div className="grid grid-cols-7 gap-1 text-center" role="img" aria-label={known.map((d) => `${LONG[d.day]} ${d.pct}%`).join(', ')}>
        {r.byDay.map((d) => (
          <div key={d.day} className="flex flex-col items-center gap-1">
            <span className={`text-sm tnum ${d.pct !== undefined && d.pct < -3 ? 'text-caution' : ''}`}>{d.pct === undefined ? '–' : `${d.pct > 0 ? '+' : ''}${d.pct}%`}</span>
            <span className="text-xs text-muted">{d.day === 0 ? 'Shot' : `D${d.day}`}</span>
          </div>
        ))}
      </div>
      {r.bestDays.length > 0 && <p className="text-[15px] mt-2">Your strongest {r.bestDays.length === 1 ? 'day' : 'days'}: {andList(r.bestDays.map((d) => d === 0 ? 'shot day' : `${LONG[d]} after it`))}.</p>}
      {r.byDose.filter((d) => d.pct !== undefined).length > 1 && <p className="text-[15px] tnum">By dose: {r.byDose.filter((d) => d.pct !== undefined).map((d) => `${fmtAmount(d.dose, med.unit)} ${d.pct! > 0 ? '+' : ''}${d.pct}%`).join(' · ')}</p>}
      <p className="text-xs text-muted mt-1">Each session's lifts against your own recent level for those lifts. Based on {r.sessions} sessions.</p>
    </section>
  );
}

/** Every goal on one timeline: body goals and training goals, each with its likely date and range. */
export function GoalTimeline({ bodyGoals, fitnessGoals, body, workouts, defs, units, now, s }: {
  bodyGoals: BodyGoal[]; fitnessGoals: FitnessGoal[]; body: BodyEntry[]; workouts: Workout[]; defs: ExerciseDef[]; units: Units; now: number; s: ScheduleSettings;
}) {
  const rows: { label: string; eta?: number; early?: number; late?: number; text: string }[] = [];
  for (const g of bodyGoals) {
    const v = goalView(g, body, now);
    const u = valueFmt(g.metric, units);
    const name = `${u.name[0].toUpperCase()}${u.name.slice(1)} ${u.fmt(g.target)}`;
    rows.push({ label: name, eta: v.f.eta, early: v.f.etaEarly, late: v.f.etaLate, text: v.f.status === 'reached' ? 'Reached' : v.f.eta ? `About ${format(v.f.eta, 'd MMM yyyy')}` : v.f.status === 'need-data' ? 'Needs more entries' : 'No date while it’s flat' });
  }
  for (const g of fitnessGoals) {
    const st = fitnessGoalStatus(g, workouts, now, s, defs);
    if (g.kind === 'sessions') continue;
    rows.push({ label: st.text.split(':')[0], eta: st.forecast?.eta, early: st.forecast?.etaEarly, late: st.forecast?.etaLate, text: st.done ? 'Reached' : st.forecast?.eta ? `About ${format(st.forecast.eta, 'd MMM yyyy')}` : st.text.split(': ')[1] ?? '' });
  }
  if (!rows.length) return null;
  const end = Math.max(now + 30 * DAY, ...rows.map((x) => x.late ?? x.eta ?? 0));
  const pos = (t: number) => `${Math.max(0, Math.min(100, ((t - now) / (end - now)) * 100))}%`;
  return (
    <section className="border-t border-border pt-5 pb-1" aria-labelledby="tl-h">
      <h2 id="tl-h" className="text-sm font-medium text-muted mb-2">Your goals</h2>
      <ul className="space-y-3">
        {rows.sort((a, b) => (a.eta ?? Infinity) - (b.eta ?? Infinity)).map((x) => (
          <li key={x.label}>
            <p className="flex justify-between gap-3"><span className="font-medium">{x.label}</span><span className="text-sm tnum text-muted">{x.text}</span></p>
            {x.eta && (
              <div className="relative h-2 mt-1.5 rounded-full bg-surface-2" aria-hidden="true">
                {x.early && x.late && <div className="absolute h-2 rounded-full" style={{ left: pos(x.early), width: `calc(${pos(x.late)} - ${pos(x.early)})`, background: 'var(--border-strong)' }} />}
                <div className="absolute w-2 h-2 rounded-full bg-text" style={{ left: `calc(${pos(x.eta)} - 4px)` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted mt-1">Now to {format(end, 'd MMM yyyy')}. Dots are the likely dates; bars the likely ranges.</p>
    </section>
  );
}

/** Today: protein and water, one tap each, with the day's total against your own target. */
export function IntakeCard({ personId, today, day, proteinTarget, waterTarget, ready }: {
  personId: string; today: string; day?: DailyHealth; proteinTarget: number | null; waterTarget: number | null; ready: Readiness | null;
}) {
  const toast = useToast();
  const add = async (field: 'proteinG' | 'waterMl', amount: number, unit: string) => {
    const total = await addIntake(personId, today, field, amount);
    toast(`+${amount} ${unit} · ${total} ${unit} today`, { onAction: () => addIntake(personId, today, field, -amount) });
  };
  const row = (label: string, field: 'proteinG' | 'waterMl', unit: string, target: number | null, steps: number[]) => {
    const v = day?.[field] ?? 0;
    return (
      <div>
        <p className="flex justify-between gap-3"><span className="font-medium">{label}</span><span className="tnum text-[15px]">{v}{target ? ` of ${target}` : ''} {unit}</span></p>
        {target ? <div className="h-1.5 rounded-full bg-surface-2 mt-1" aria-hidden="true"><div className="h-1.5 rounded-full bg-text" style={{ width: `${Math.min(100, (v / target) * 100)}%` }} /></div> : null}
        <div className="flex gap-2 mt-2">
          {steps.map((a) => <button key={a} type="button" onClick={() => add(field, a, unit)} aria-label={`Add ${a} ${unit} of ${label.toLowerCase()}`} className="min-h-[44px] px-4 rounded-chip border border-border-strong text-sm font-medium tnum">+{a}</button>)}
        </div>
      </div>
    );
  };
  return (
    <section className="border-t border-border pt-4 space-y-3" aria-label="Protein, water and readiness">
      {ready && <ReadinessBlock r={ready} compact />}
      {row('Protein', 'proteinG', 'g', proteinTarget, [10, 25, 40])}
      {row('Water', 'waterMl', 'mL', waterTarget, [250, 500])}
      {!proteinTarget && !waterTarget && <p className="text-xs text-muted">Set your own daily targets in Settings → Training.</p>}
    </section>
  );
}
