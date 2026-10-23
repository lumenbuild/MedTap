// Fitness cards used on Training, Body, Protocol and Today: readiness, lean mass while losing weight, strength against
// the peptide, and one timeline for every goal.
import { Beef, Dumbbell, GlassWater, Moon, Pill, Scale, Smile, type LucideIcon } from 'lucide-react';
import { Bar, IconRow, MiniRing, Stat } from './ui/Visual';
import { format } from 'date-fns';
import type { BodyEntry, BodyGoal, CheckIn, DailyHealth, Dose, FitnessGoal, Medication, Workout } from '../db/schema';
import type { Digest } from '../logic/digest';
import { intakeTrend, proteinVsLean, readinessTrend, readinessVsPerformance } from '../logic/fitnessInsights';
import { addIntake } from '../db/repos/training';
import { useToast } from '../app/toast';
import type { Units } from '../db/repos/settings';
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
const andList = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const LONG = ['shot day', 'day 1', 'day 2', 'day 3', 'day 4', 'day 5', 'day 6'];

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
      {!compact && <ul className="text-[15px] tnum mt-2 grid grid-cols-2 gap-x-4 gap-y-1">{r.parts.map((p) => <li key={p.what} className="flex items-center gap-2"><span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: p.good ? 'var(--success)' : 'var(--caution)' }} />{p.what}: {p.text}</li>)}</ul>}
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
  if (!r) return null;
  const shots = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && !d.skipped).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b).slice(-6);
  const plan = tz ? strongestWeekday(shots, r.bestDays, tz) : null;
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
      {plan && <p className="text-[15px] mt-2 font-medium">Plan your heaviest session for {plan.weekday}s ({plan.day === 0 ? 'shot day' : `day ${plan.day} after your shot`}), usually your strongest.</p>}
      {r.bestDays.length > 0 && <p className="text-[15px] mt-2">Your strongest {r.bestDays.length === 1 ? 'day' : 'days'}: {andList(r.bestDays.map((d) => d === 0 ? 'shot day' : `${LONG[d]} after it`))}.</p>}
      {r.byDose.filter((d) => d.pct !== undefined).length > 1 && <p className="text-[15px] tnum">By dose: {r.byDose.filter((d) => d.pct !== undefined).map((d) => `${fmtAmount(d.dose, med.unit)} ${d.pct! > 0 ? '+' : ''}${d.pct}%`).join(' · ')}</p>}
      <p className="text-xs text-muted mt-1">{r.sessions} sessions</p>
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
  const row = (label: string, Icon: LucideIcon, field: 'proteinG' | 'waterMl', unit: string, target: number | null, steps: number[]) => {
    const v = day?.[field] ?? 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon size={18} aria-hidden="true" className="text-primary" />
          <span className="font-medium flex-1">{label}</span>
          <span className="tnum"><span className="text-[20px] font-semibold">{v}</span><span className="text-sm text-muted">{target ? ` / ${target}` : ''} {unit}</span></span>
        </div>
        {target ? <Bar value={v} max={target} tone={v >= target ? 'good' : 'primary'} label={`${v} of ${target} ${unit}`} /> : null}
        <div className="flex gap-2">
          {steps.map((a) => <button key={a} type="button" onClick={() => add(field, a, unit)} aria-label={`Add ${a} ${unit} of ${label.toLowerCase()}`} className="flex-1 min-h-[44px] rounded-chip bg-surface-2 text-sm font-medium tnum">+{a}</button>)}
        </div>
      </div>
    );
  };
  return (
    <section className="border-t border-border pt-4 space-y-4" aria-label="Protein, water and readiness">
      {ready && <ReadinessBlock r={ready} compact />}
      {row('Protein', Beef, 'proteinG', 'g', proteinTarget, [10, 25, 40])}
      {row('Water', GlassWater, 'waterMl', 'mL', waterTarget, [250, 500])}
    </section>
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

function Bars({ values, max, label, target }: { values: { key: string; v: number }[]; max: number; label: string; target?: number | null }) {
  return (
    <div className="relative flex items-end gap-0.5 h-16 mt-2" role="img" aria-label={label}>
      {target ? <div className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${Math.min(100, (target / max) * 100)}%`, borderColor: 'var(--border-strong)' }} aria-hidden="true" /> : null}
      {values.map((x) => <div key={x.key} className="flex-1 rounded-[2px] bg-text" style={{ height: `${Math.max(3, (x.v / max) * 100)}%`, opacity: target && x.v < target ? 0.45 : 1 }} />)}
    </div>
  );
}

/** Trends: protein, water and readiness by day, and what they link to in the person's own records. */
export function TrainingTrends({ daily, body, checkIns, workouts, start, end, s, targets }: {
  daily: DailyHealth[]; body: BodyEntry[]; checkIns: CheckIn[]; workouts: Workout[]; start: number; end: number; s: ScheduleSettings; targets: { protein: number | null; water: number | null };
}) {
  const intake = intakeTrend(daily, body, start, end, targets);
  const ready = readinessTrend(daily, checkIns, start, end, s).slice(-31);
  const pl = proteinVsLean(daily, body);
  const rp = readinessVsPerformance(workouts, daily, checkIns, s);
  if (!intake && !ready.length && !pl && !rp) return null;
  const last = intake?.days.slice(-31) ?? [];
  return (
    <>
      {intake?.protein && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="pr-h">
          <h2 id="pr-h" className="text-sm font-medium text-muted">Protein</h2>
          <p className="text-[15px] tnum mt-1">Averaged {intake.protein.avg} g on {intake.protein.days} logged day{intake.protein.days === 1 ? '' : 's'}{intake.protein.perKg ? ` (${intake.protein.perKg} g per kg of body weight)` : ''}.{intake.protein.onTarget !== undefined ? ` At or over your ${targets.protein} g target on ${intake.protein.onTarget}.` : ''}</p>
          <Bars values={last.filter((d) => d.protein).map((d) => ({ key: d.date, v: d.protein! }))} max={Math.max(...last.map((d) => d.protein ?? 0), targets.protein ?? 0)} target={targets.protein}
            label={`Protein each logged day: ${last.filter((d) => d.protein).map((d) => `${d.date} ${d.protein} g`).join(', ')}`} />
          {intake.water && <p className="text-[15px] tnum mt-3">Water averaged {(intake.water.avg / 1000).toFixed(1)} L on {intake.water.days} logged day{intake.water.days === 1 ? '' : 's'}{intake.water.onTarget !== undefined ? `; on target ${intake.water.onTarget}` : ''}.</p>}
          <p className="text-xs text-muted mt-1">Logged days only</p>
        </section>
      )}
      {ready.length >= 3 && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="rd-h">
          <h2 id="rd-h" className="text-sm font-medium text-muted">Ready to train</h2>
          <p className="text-[15px] tnum mt-1">Averaged {Math.round(ready.reduce((n, x) => n + x.score, 0) / ready.length)} over {ready.length} days; {ready.filter((x) => x.score < 55).length} low.</p>
          <Bars values={ready.map((x) => ({ key: String(x.t), v: x.score }))} max={100} target={55} label={`Readiness by day: ${ready.map((x) => `${format(x.t, 'd MMM')} ${x.score}`).join(', ')}`} />
        </section>
      )}
      {(pl || rp) && (
        <section className="border-t border-border pt-5 pb-1" aria-labelledby="ln-h">
          <h2 id="ln-h" className="text-sm font-medium text-muted mb-1">Links in your records</h2>
          {pl && <p className="text-[15px] tnum">Between scans or weigh-ins with body fat, about <strong>{pl.higher.share}%</strong> of the weight lost was lean mass when protein averaged {pl.higher.protein} g, against <strong>{pl.lower.share}%</strong> at {pl.lower.protein} g ({pl.higher.spans + pl.lower.spans} spans).</p>}
          {rp && <p className="text-[15px] tnum mt-2">On your better-readiness days (about {rp.higher.score}), your lifts were {rp.higher.pct > 0 ? '+' : ''}{rp.higher.pct}% against your recent level ({rp.higher.sessions} sessions); on lower days (about {rp.lower.score}), {rp.lower.pct > 0 ? '+' : ''}{rp.lower.pct}% ({rp.lower.sessions}).</p>}
        </section>
      )}
    </>
  );
}

/** Today, Monday to Wednesday: last week in a few lines against the week before. */
const DIGEST_ICON: Record<string, LucideIcon> = { doses: Pill, weight: Scale, training: Dumbbell, protein: Beef, sleep: Moon, mood: Smile };

export function DigestCard({ d, seen, onClose, onNotify, notify }: { d: Digest; seen: number; onClose: () => void; onNotify?: () => void; notify: boolean }) {
  if (seen >= d.weekStart) return null;
  return (
    <section className="border-t border-border pt-4 pb-1" aria-labelledby="dg-h">
      <h2 id="dg-h" className="text-sm font-medium text-muted">Your week · {format(d.weekStart, 'd MMM')} – {format(d.weekEnd - 1, 'd MMM')}</h2>
      <ul className="tnum mt-1">
        {d.lines.map((l) => (
          <li key={l.key}><IconRow Icon={DIGEST_ICON[l.key] ?? Smile} tone={l.tone === 'good' ? 'good' : l.tone === 'watch' ? 'watch' : 'plain'}>{l.text}</IconRow></li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-5 mt-1">
        <button type="button" className="min-h-[44px] text-sm font-medium underline underline-offset-4" onClick={onClose}>Done</button>
        {onNotify && !notify && <button type="button" className="min-h-[44px] text-sm text-muted underline underline-offset-4" onClick={onNotify}>Remind me each Monday</button>}
      </div>
    </section>
  );
}

