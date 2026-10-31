// Fitness cards used on Training, Body, Protocol and Today: readiness, lean mass while losing weight, strength against
// the peptide, and one timeline for every goal.
import { Beef, GlassWater, Plus, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Bar, MiniRing, Stat, ZeroBars } from './ui/Visual';
import { format } from 'date-fns';
import type { BodyEntry, BodyGoal, DailyHealth, Dose, FitnessGoal, Medication, Workout } from '../db/schema';
import { addIntake } from '../db/repos/training';
import { useToast } from '../app/toast';
import { setSetting, type AppSettings, type Units } from '../db/repos/settings';
import { INTAKE_LIMIT, keepAmount, MAX_AMOUNTS, parseAmount, shownAmounts, usedAmount, type IntakeField } from '../logic/intake';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';
import { Switch } from './ui/Switch';
import type { ScheduleSettings } from '../logic/schedule';
import { muscleWatch, trainingVsPeptide, fitnessGoalStatus, type Readiness, type TrainingSummary } from '../logic/training';
import { fmtLoad } from '../logic/load';
import { strongestWeekday } from '../logic/trainingExtras';
import type { ExerciseDef } from '../logic/exercises';
import { goalView, valueFmt } from '../screens/Body/Goals';
import { kgTo, weightUnit } from '../logic/units';
import { shownName } from '../logic/privacy';
import { fmtAmount } from '../logic/format';

const DAY = 86_400_000;

export function ReadinessBlock({ r, compact = false }: { r: Readiness; compact?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <MiniRing value={r.score} max={100} size={compact ? 44 : 64} tone={r.score >= 70 ? 'good' : r.score < 55 ? 'watch' : 'primary'} label={`Ready to train: ${r.score} of 100, ${r.label}`}>{r.score}</MiniRing>
        <div>
          <p className="text-sm font-medium text-muted">Ready to train</p>
          <p className="text-[17px] font-medium">{r.label}</p>
        </div>
      </div>
      {!compact && <ul className="text-[15px] tnum mt-3 space-y-1">{r.parts.map((p) => <li key={p.what} className="flex items-start gap-2"><span aria-hidden="true" className="w-2 h-2 mt-[8px] rounded-full shrink-0" style={{ background: p.good ? 'var(--success)' : 'var(--caution)' }} />{p.what}: {p.text}</li>)}</ul>}
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
    <section className="box" aria-labelledby="lean-h">
      <h2 id="lean-h" className="text-sm font-medium text-muted mb-1">Lean mass while losing weight</h2>
      {!w.overall ? (
        <p className="text-[15px] text-muted">{w.points < 2 ? 'Log body fat % twice to see this.' : 'Shows after 2+ kg lost.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <Stat label="Lost" value={kgTo(w.overall.weightLost, units)} unit={u} />
            <Stat label="Of it lean" value={`${Math.round(Math.max(0, w.overall.share) * 100)}%`} tone={high(w.overall.share) ? 'watch' : 'good'}>
              <Bar value={Math.max(0, w.overall.share) * 100} max={100} marker={35} tone={high(w.overall.share) ? 'watch' : 'good'} label={`${Math.round(Math.max(0, w.overall.share) * 100)}% of the loss was lean mass`} />
            </Stat>
          </div>
          <p className="text-sm text-muted tnum mt-1">{format(w.overall.from, 'd MMM')} – {format(w.overall.to, 'd MMM yyyy')}</p>
          {w.steps.length > 0 && <ul className="text-[15px] tnum mt-2">{w.steps.map((s) => <li key={s.dose}>{med ? fmtAmount(s.dose, med.unit) : s.dose}: {line(s)}</li>)}</ul>}
        </>
      )}
    </section>
  );
}

/** Strength by days since the shot and by dose. */
export function PeptideTrainingCard({ med, doses, workouts, tz }: { med: Medication; doses: Dose[]; workouts: Workout[]; tz?: string }) {
  const r = trainingVsPeptide(med, doses, workouts);
  // Only once it says something: at least three days after the shot with enough sessions, and a real gap between them.
  const known = r ? r.byDay.filter((d) => d.pct !== undefined).map((d) => d.pct!) : [];
  if (!r || known.length < 3 || Math.max(...known) - Math.min(...known) < 3) return null;
  const shots = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b).slice(-6);
  const plan = tz ? strongestWeekday(shots, r.bestDays, tz) : null;
  return (
    <section className="box" aria-labelledby="pt-h">
      <h2 id="pt-h" className="text-sm font-medium text-muted mb-2">Strength and {shownName(med)}</h2>
      <ZeroBars fmt={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`} items={r.byDay.map((d) => ({ label: d.day === 0 ? 'Shot' : `D${d.day}`, v: d.pct ?? null, strong: r.bestDays.includes(d.day) }))} />
      <p className="text-xs text-muted mt-1 tnum">Lifts against your usual, by day after a shot ({r.sessions} sessions). Bold: your strongest days.</p>
      {plan && <p className="text-[15px] mt-2 font-medium">Plan your heaviest session for {plan.weekday}s ({plan.day === 0 ? 'shot day' : `day ${plan.day} after your shot`}), usually your strongest.</p>}
      {r.byDose.filter((d) => d.pct !== undefined).length > 1 && <p className="text-[15px] tnum">By dose: {r.byDose.filter((d) => d.pct !== undefined).map((d) => `${fmtAmount(d.dose, med.unit)} ${d.pct! > 0 ? '+' : d.pct! < 0 ? '−' : ''}${Math.abs(d.pct!)}%`).join(' · ')}</p>}
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
    const st = fitnessGoalStatus(g, workouts, now, s, defs, units);
    if (g.kind === 'sessions') continue;
    rows.push({ label: st.text.split(':')[0], eta: st.forecast?.eta, early: st.forecast?.etaEarly, late: st.forecast?.etaLate, text: st.done ? 'Reached' : st.forecast?.eta ? `About ${format(st.forecast.eta, 'd MMM yyyy')}` : st.text.split(': ')[1] ?? '' });
  }
  if (!rows.length) return null;
  const end = Math.max(now + 30 * DAY, ...rows.map((x) => x.late ?? x.eta ?? 0));
  const pos = (t: number) => `${Math.max(0, Math.min(100, ((t - now) / (end - now)) * 100))}%`;
  return (
    <section className="box" aria-labelledby="tl-h">
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
export function IntakeCard({ personId, today, day, proteinTarget, waterTarget, ready, amounts }: {
  personId: string; today: string; day?: DailyHealth; proteinTarget: number | null; waterTarget: number | null; ready: Readiness | null; amounts: AppSettings['intakeAmounts'];
}) {
  const toast = useToast();
  const [other, setOther] = useState<IntakeField | null>(null);
  const add = async (field: IntakeField, amount: number, unit: string) => {
    const total = await addIntake(personId, today, field, amount);
    toast(`+${amount} ${unit} · ${total} ${unit} today`, { onAction: () => addIntake(personId, today, field, -amount) });
    const list = usedAmount(amounts[field], amount);
    if (list !== amounts[field]) void setSetting('intakeAmounts', { ...amounts, [field]: list });
  };
  const row = (label: string, Icon: LucideIcon, field: IntakeField, unit: string, target: number | null) => {
    const v = day?.[field] ?? 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon size={18} aria-hidden="true" className="text-primary" />
          <span className="font-medium flex-1">{label}</span>
          <span className="tnum"><span className="text-[20px] font-semibold">{Math.round(v)}</span><span className="text-sm text-muted">{target ? ` / ${target}` : ''} {unit}</span></span>
        </div>
        {target ? <Bar value={v} max={target} tone={v >= target ? 'good' : 'primary'} label={`${v} of ${target} ${unit}`} /> : null}
        <div className="flex gap-2">
          {shownAmounts(amounts[field]).map((a) => <button key={a} type="button" onClick={() => add(field, a, unit)} aria-label={`Add ${a} ${unit} of ${label.toLowerCase()}`} className="flex-1 min-h-[44px] rounded-chip bg-surface-2 text-sm font-medium tnum">+{a}</button>)}
          <button type="button" onClick={() => setOther(field)} aria-label={`Add another amount of ${label.toLowerCase()}`} className="flex-1 min-h-[44px] rounded-chip bg-surface-2 text-sm font-medium flex items-center justify-center gap-1">
            <Plus size={16} aria-hidden="true" />Other
          </button>
        </div>
      </div>
    );
  };
  return (
    <section className="box space-y-4" aria-label="Protein, water and readiness">
      {ready && <div className="pb-4 border-b border-border"><ReadinessBlock r={ready} compact /></div>}
      {row('Protein', Beef, 'proteinG', 'g', proteinTarget)}
      {row('Water', GlassWater, 'waterMl', 'mL', waterTarget)}
      {other && <OtherAmount field={other} total={day?.[other] ?? 0} amounts={amounts} onClose={() => setOther(null)}
        onAdd={(n, keep) => { setOther(null); void add(other, n, other === 'waterMl' ? 'mL' : 'g').then(() => { if (keep) void setSetting('intakeAmounts', { ...amounts, [other]: keepAmount(amounts[other], n) }); }); }}
        onSet={async (n) => { const field = other, before = day?.[field] ?? 0, unit = field === 'waterMl' ? 'mL' : 'g'; setOther(null);
          await addIntake(personId, today, field, n - before); toast(`${n} ${unit} today`, { onAction: () => addIntake(personId, today, field, before - n) }); }} />}
    </section>
  );
}

/** Any amount: add it (and keep it as a button, for a cup or bottle used again), or set the day's total to it. The
 *  buttons can be taken off here too. */
function OtherAmount({ field, total, amounts, onAdd, onSet, onClose }: {
  field: IntakeField; total: number; amounts: AppSettings['intakeAmounts']; onAdd: (n: number, keep: boolean) => void; onSet: (n: number) => void; onClose: () => void;
}) {
  const water = field === 'waterMl', unit = water ? 'mL' : 'g';
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(true);
  const n = parseAmount(text, field);
  const list = amounts[field];
  const kept = n !== null && list.includes(n);
  return (
    <Sheet open onClose={onClose} title={water ? 'Water' : 'Protein'}>
      <div className="space-y-4">
        <TextInput label={water ? 'How much (mL)' : 'How much protein (g)'} type="number" inputMode="numeric" min="1" step="1" autoFocus value={text}
          placeholder={water ? 'Like 350 for your cup' : 'Like 30 for a scoop'} onChange={(e) => setText(e.target.value)}
          error={text.trim() && n === null ? `A whole number up to ${INTAKE_LIMIT[field]}` : undefined} />
        {!kept && <Switch label="Keep as a button" checked={keep} onChange={setKeep}>{list.length >= MAX_AMOUNTS ? `Replaces +${list[list.length - 1]}, the one used longest ago` : 'Next to the others on Today'}</Switch>}
        {list.length > 0 && (
          <div>
            <span className="block text-sm font-medium mb-2">Your buttons</span>
            <ul className="flex flex-wrap gap-2">
              {shownAmounts(list).map((a) => (
                <li key={a} className="flex items-center gap-1 pl-4 pr-1 min-h-[44px] rounded-chip bg-surface-2 text-sm tnum">
                  {a} {unit}
                  <button type="button" onClick={() => setSetting('intakeAmounts', { ...amounts, [field]: list.filter((x) => x !== a) })} aria-label={`Remove the ${a} ${unit} button`}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-muted"><X size={16} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={n === null} onClick={() => n !== null && onAdd(n, keep && !kept)}>{n === null ? 'Add' : `Add ${n} ${unit}`}</Button>
          <Button variant="secondary" className="w-full" disabled={n === null} onClick={() => n !== null && onSet(n)}>
            {n === null ? 'Set today’s total' : `Set today’s total to ${n} ${unit}`}{total ? ` (now ${Math.round(total)})` : ''}
          </Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** The doctor report's training and body composition section. */
export function TrainingReport({ sum, units }: { sum: TrainingSummary; units: Units }) {
  const L = (kg: number) => fmtLoad(kg, units);
  return (
    <section className="border-t border-border pt-5 pb-2 report-block">
      <h2 className="text-sm font-medium text-muted mb-2">Training and body composition</h2>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm tnum">
        <div><dt className="text-muted">Strength sessions</dt><dd className="font-semibold">{sum.sessions}</dd></div>
        <div><dt className="text-muted">Sessions a week (all)</dt><dd className="font-semibold">{sum.perWeek}</dd></div>
        {sum.cardio > 0 && <div><dt className="text-muted">Cardio</dt><dd className="font-semibold">{sum.cardio}{sum.km ? ` · ${sum.km} km` : ''}</dd></div>}
        {sum.protein !== undefined && <div><dt className="text-muted">Protein a day (logged days)</dt><dd className="font-semibold">{sum.protein} g <span className="font-normal text-muted">({sum.proteinDays} days)</span></dd></div>}
        {sum.water !== undefined && <div><dt className="text-muted">Water a day (logged days)</dt><dd className="font-semibold">{sum.water} mL</dd></div>}
        {sum.bodyFat && <div><dt className="text-muted">Body fat</dt><dd className="font-semibold">{sum.bodyFat.from}% → {sum.bodyFat.to}%</dd></div>}
        {sum.lean && <div><dt className="text-muted">Lean mass</dt><dd className="font-semibold">{L(sum.lean.from)} → {L(sum.lean.to)}</dd></div>}
      </dl>
      {sum.lifts.length > 0 && (
        <div className="table-scroll mt-3" tabIndex={0}>
          <table className="w-full text-sm tnum">
            <thead><tr className="text-left">{['Exercise', 'Sessions', 'First', 'Last', 'Change'].map((h) => <th key={h} className="py-1 pr-3 border-b border-border font-semibold">{h}</th>)}</tr></thead>
            <tbody>{sum.lifts.map((l) => (
              <tr key={l.id}>
                <td className="py-1 pr-3 border-b border-border">{l.name}</td>
                <td className="py-1 pr-3 border-b border-border">{l.sessions}</td>
                <td className="py-1 pr-3 border-b border-border">{l.noLoad ? l.from : L(l.from)}</td>
                <td className="py-1 pr-3 border-b border-border">{l.noLoad ? l.to : L(l.to)}</td>
                <td className="py-1 pr-3 border-b border-border">{l.pct > 0 ? '+' : ''}{l.pct}%</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="text-xs text-muted mt-1">Estimated 1-rep max per session</p>
        </div>
      )}
    </section>
  );
}


