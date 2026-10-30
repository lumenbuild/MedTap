// Dosing plans on screen: the one dose plan (dated changes, steps on a schedule, stepping when ready, drawn as a
// ladder), the step prompt on Today and Protocol when it's due, and "start another course?" during a course's break.
import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarClock, Check, ChevronDown, ListOrdered, Minus, RotateCcw, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { BodyEntry, CheckIn, Dose, Medication, PlannedChange, StepPlan, StepUpCriteria } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { describeStepPlan, planLimit, stepAmount, stepStatus, type RestartPrompt, type StepStatus } from '../logic/dosePlan';
import { fmtAmount, fmtDay, fmtSchedule, fmtYmdDay } from '../logic/format';
import { DEFAULT_STEP_UP, stepUpChecklist, type StepCheck } from '../logic/stepUp';
import { medOn } from '../logic/plans';
import { dayKey } from '../logic/stats';
import { PlanLadder } from './charts/PlanLadder';
import { ScheduleFields, scheduleFormFromMed, scheduleFromForm, validateSchedule, type ScheduleErrors, type ScheduleForm } from '../screens/Meds/ScheduleFields';
import { fmtUnits, isPen, scheduleAtDose, titrationSteps } from '../logic/peptide';
import { shownName } from '../logic/privacy';
import { personOf } from '../db/repos/people';
import { addPlannedChange, addPlannedChanges, applyStep, dismissRestart, removePlannedChange, removePlannedChanges, saveStepConditions, saveStepPlan, snoozeStep, startCourse, undoPlanChange } from '../db/repos/meds';
import { useBodyEntries, useCheckIns, useDoses, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { HAS_BODY } from '../edition';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Sheet, SheetActions } from './ui/Sheet';
import { Segmented, TextInput } from './ui/Field';

const ymd = (t: number | Date) => format(t, 'yyyy-MM-dd');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The person's records that a medication's plan is checked against. */
export function planRecords(med: Medication, doses: Dose[], checkIns: CheckIn[], body: BodyEntry[]) {
  const mine = <T extends { personId?: string }>(x: T) => med.shared || personOf(x) === personOf(med);
  return { doses: doses.filter((d) => d.medicationId === med.id), checkIns: checkIns.filter(mine), body: HAS_BODY ? body.filter(mine) : [] };
}

/** "Step up to 2.25 mg?" with Step up and Not yet. */
export function StepPrompt({ med, v }: { med: Medication; v: StepStatus }) {
  const toast = useToast();
  const p = med.stepPlan!;
  const up = !p.down;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <Icon className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{shownName(med)}: your plan's next step is due</p>
          <p className="text-[15px] tnum">{fmtAmount(v.current, med.unit)} → <strong>{fmtAmount(v.next, med.unit)}</strong>{p.byUnits ? ` (${up ? '+' : '−'}${fmtUnits(p.by)})` : ''}</p>
          <p className="text-sm text-muted">Every condition you set is met: {v.checks.map((c) => c.label.toLowerCase()).join(', ')}.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={async () => {
          const u = await applyStep(med.id, v.next);
          if (u) toast(`${shownName(med)}: ${fmtAmount(v.next, med.unit)} from the next dose`, { onAction: () => undoPlanChange(u) });
        }}>{up ? 'Step up' : 'Step down'}</Button>
        <Button variant="secondary" onClick={async () => { await snoozeStep(med.id, ymd(addDays(new Date(), 7))); toast('Asks again in a week'); }}>Not yet</Button>
      </div>
    </Card>
  );
}

/** "Pain in a check-in. Start another course?" during a course's break. */
export function RestartCard({ med, prompt }: { med: Medication; prompt: RestartPrompt }) {
  const toast = useToast();
  const c = med.schedule.course!;
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <RotateCcw className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Start another course of {shownName(med)}?</p>
          <p className="text-[15px]">{prompt.reason}. Your plan: {c.days % 7 === 0 ? `${c.days / 7} weeks` : `${c.days} days`}, then a break.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={async () => {
          const u = await startCourse(med.id, ymd(new Date()));
          if (u) toast(`Course started today`, { onAction: () => undoPlanChange(u) });
        }}>Start today</Button>
        <Button variant="secondary" onClick={async () => { await dismissRestart(med.id); toast('Asks again only for a new reason'); }}>Not now</Button>
      </div>
    </Card>
  );
}

/** Conditions as a ticked list: the step plan's, or the checklist for a dated step. */
function Checks({ checks }: { checks: StepCheck[] }) {
  return (
    <ul>
      {checks.map((c) => (
        <li key={c.key} className="flex items-center gap-3 min-h-[36px]">
          <span aria-hidden="true" className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: c.ok ? 'var(--success-soft)' : 'var(--surface-2)', color: c.ok ? 'var(--success)' : 'var(--text-muted)' }}>
            {c.ok ? <Check size={14} /> : c.ok === false ? <X size={14} /> : <Minus size={14} />}
          </span>
          <span className="flex-1 text-[15px]">{c.label}</span>
          <span className="text-sm text-muted tnum">{c.value}</span>
          <span className="sr-only">{c.ok ? 'met' : c.ok === false ? 'not yet' : 'not enough data'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where the step plan is: due, waiting on what, or at the maximum. */
export function stepSummary(med: Medication, v: StepStatus, now: number): string {
  if (v.atLimit) return `At your ${med.stepPlan?.down ? 'lowest' : 'highest'} dose: ${fmtAmount(v.limit, med.unit)}.`;
  if (v.awaitingFirstDose) return `Next: your first dose at ${fmtAmount(v.current, med.unit)}.`;
  if (v.ready) return `Ready for ${fmtAmount(v.next, med.unit)}.`;
  if (v.snoozedUntil) return `Asks again ${fmtDay(new Date(`${v.snoozedUntil}T12:00`).getTime(), now)}.`;
  const waiting = v.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
  return `Next ${fmtAmount(v.next, med.unit)}, once: ${waiting.join(', ')}${v.readyFrom ? ` (weeks met ${fmtDay(v.readyFrom, now)})` : ''}.`;
}

type PlanSheet = 'choose' | 'date' | 'schedule' | 'ready' | 'conditions' | null;

/** The one dose plan: every way a dose changes, in one place. Dated changes (one, or several on a schedule, as in a
 *  titration or a taper), and stepping when ready (the person's own conditions, ticked from their records), drawn as
 *  one ladder of what's been taken and what's planned. `flat`: a section of a page (Protocol) rather than a card. */
export function DosePlanCard({ med, flat = false }: { med: Medication; flat?: boolean }) {
  const toast = useToast();
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [sheet, setSheet] = useState<PlanSheet>(null);
  if (!doses || !checkIns || !body || !ss) return null;
  const s = ss[1];
  const recs = planRecords(med, doses, checkIns, body);
  const prn = med.schedule.type === 'prn';
  const v = prn ? null : stepStatus(med, recs.doses, recs.checkIns, recs.body, now, s);
  const dated = [...(med.plannedChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const today = dayKey(now, s);
  // The next change worth naming: the first dated one with a new dose (or, failing that, any still to come).
  const coming = dated.filter((c) => c.from > today);
  const next = coming.find((c) => Math.abs(c.defaultAmount - med.defaultAmount) > 1e-9) ?? coming[0];
  // For a dated step with no step plan: are the usual conditions met before it comes? (Injections, where it matters.)
  const ahead = !v && next && med.peptide ? stepUpChecklist(med, recs.doses, recs.checkIns, recs.body, now, s) : null;
  const nextText = next ? (Math.abs(next.defaultAmount - med.defaultAmount) > 1e-9 ? `${fmtAmount(next.defaultAmount, med.unit)} from ${fmtYmdDay(next.from)}` : `a change from ${fmtYmdDay(next.from)}`) : v ? stepSummary(med, v, now) : 'No changes planned';
  const remove = async (c: PlannedChange) => {
    await removePlannedChange(med.id, c.id);
    toast(`Removed the change on ${fmtYmdDay(c.from)}`, { onAction: () => addPlannedChange(med.id, c) });
  };
  const body_ = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`plan-${med.id}`} className="text-sm font-medium text-muted flex items-center gap-2"><TrendingUp size={20} className="text-primary" aria-hidden="true" /> Dose plan</h2>
        <button type="button" className="text-sm font-medium underline underline-offset-4 min-h-[44px]" onClick={() => setSheet('choose')}>Change the plan</button>
      </div>
      <p className="text-[15px] tnum"><span className="font-medium">Now {fmtAmount(med.defaultAmount, med.unit)}</span><span className="text-muted"> · {nextText}</span></p>
      <PlanLadder med={med} doses={recs.doses} now={now} />
      {med.stepPlan && v && (
        <div className="space-y-1">
          <p className="text-[15px]"><span className="font-medium">When ready:</span> {describeStepPlan(med, med.stepPlan)}.</p>
          {!next && <p className="text-[15px]">{stepSummary(med, v, now)}</p>}
          {v.checks.length > 0 && !v.atLimit && <Checks checks={v.checks} />}
        </div>
      )}
      {ahead && ahead.checks.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-medium">Ready for {fmtAmount(next!.defaultAmount, med.unit)}? {ahead.met} of {ahead.checks.length}</p>
            <button type="button" className="text-sm underline underline-offset-4 min-h-[44px]" onClick={() => setSheet('conditions')}>{med.stepUp ? 'Edit' : 'Set yours'}</button>
          </div>
          <Checks checks={ahead.checks} />
        </div>
      )}
      {dated.length > 0 && (
        <details className="group">
          <summary className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium cursor-pointer list-none">
            {dated.length} dated change{dated.length === 1 ? '' : 's'} <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ol className="space-y-2">
            {dated.map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded-btn bg-surface-2 p-3">
                <span className="flex-1">
                  <span className="block font-semibold tnum">From {fmtYmdDay(c.from)}</span>
                  <span className="block text-sm tnum">{fmtSchedule(c.schedule, med.unit)}</span>
                  {c.schedule.type === 'prn' && <span className="block text-sm tnum">Usual dose {fmtAmount(c.defaultAmount, med.unit)}</span>}
                  {c.note && <span className="block text-sm text-muted">{c.note}</span>}
                </span>
                <button type="button" onClick={() => remove(c)} aria-label={`Remove the change on ${fmtYmdDay(c.from)}`}
                  className="w-12 h-12 -m-1 rounded-btn flex items-center justify-center text-muted"><Trash2 size={20} aria-hidden="true" /></button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {sheet === 'choose' && (
        <Sheet open onClose={() => setSheet(null)} title="Change the plan">
          <div className="space-y-2">
            {([
              ['date', CalendarClock, 'On a date', 'One change from a day you choose: a new dose, times or days.'],
              ['schedule', ListOrdered, 'Steps on a schedule', 'Up or down by the same amount every few weeks, to a dose: a titration or a taper.'],
              ...(prn ? [] : [['ready', TrendingUp, med.stepPlan ? 'Edit stepping when ready' : 'When I\'m ready', 'Up or down once your own conditions are met (weeks on the dose, appetite, side effects…). It asks first.']]),
            ] as [PlanSheet, typeof TrendingUp, string, string][]).map(([k, Icon, title, what]) => (
              <button key={k} type="button" onClick={() => setSheet(k)} className="w-full text-left rounded-btn border border-border p-3 min-h-[64px] flex items-start gap-3">
                <Icon size={22} aria-hidden="true" className="text-primary shrink-0 mt-0.5" />
                <span><span className="block font-medium">{title}</span><span className="block text-sm text-muted">{what}</span></span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'date' && <PlanChangeSheet med={med} onClose={() => setSheet(null)} />}
      {sheet === 'schedule' && <StepsOnScheduleSheet med={med} onClose={() => setSheet(null)} />}
      {sheet === 'ready' && <StepPlanSheet med={med} now={now} s={s} onClose={() => setSheet(null)} />}
      {sheet === 'conditions' && <ConditionsSheet med={med} onClose={() => setSheet(null)} />}
    </>
  );
  return flat
    ? <section aria-labelledby={`plan-${med.id}`} className="border-t border-border pt-5 space-y-3">{body_}</section>
    : <Card className="space-y-3"><section aria-labelledby={`plan-${med.id}`} className="space-y-3">{body_}</section></Card>;
}

/** A dated change: from a day, a new dose, times or days. */
function PlanChangeSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const last = [...(med.plannedChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from)).pop();
  // Start from the schedule that will be in force just before the new change: easy to step a taper.
  const [from, setFrom] = useState(last ? ymd(addDays(new Date(`${last.from}T12:00`), 7)) : ymd(addDays(new Date(), 1)));
  const [f, setF] = useState<ScheduleForm>(() => scheduleFormFromMed(last ? medOn(med, last.from) : med));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ScheduleForm>(k: K, val: ScheduleForm[K]) => setF((p) => ({ ...p, [k]: val }));
  const tomorrow = ymd(addDays(new Date(), 1));
  const errors: ScheduleErrors & { from?: string } = tried ? validateSchedule(f) : {};
  if (tried && (!from || from < tomorrow)) errors.from = 'Choose a date from tomorrow on. To change today, edit the medication.';
  const save = async () => {
    setTried(true);
    if (Object.keys(validateSchedule(f)).length || !from || from < tomorrow) return;
    const { schedule, defaultAmount } = scheduleFromForm(f);
    await addPlannedChange(med.id, { from, schedule, defaultAmount, note: note.trim() || undefined });
    toast(`Change planned for ${fmtYmdDay(from)}`);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="A change on a date">
      <div className="space-y-4">
        <TextInput label="Starting on" type="date" min={tomorrow} value={from} onChange={(e) => setFrom(e.target.value)} error={errors.from} />
        <ScheduleFields f={f} set={set} errors={errors} unit={med.unit} />
        <TextInput label="Note (optional)" placeholder="e.g. Week 2 of taper, per Dr Lee" value={note} onChange={(e) => setNote(e.target.value)} />
        <SheetActions><Button className="w-full min-h-[56px]" onClick={save}>Save the change</Button></SheetActions>
      </div>
    </Sheet>
  );
}

/** Several dated changes at once: the same step every few weeks, up or down to a dose (a titration or a taper). */
function StepsOnScheduleSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const tomorrow = ymd(addDays(new Date(), 1));
  const [start, setStart] = useState(String(med.defaultAmount || ''));
  const [step, setStep] = useState('');
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [every, setEvery] = useState('4');
  const [unit, setUnit] = useState<'weeks' | 'days'>('weeks');
  const [until, setUntil] = useState('');
  const [from, setFrom] = useState(tomorrow);
  const n = (x: string) => Number(x);
  const all = titrationSteps({ start: n(start), from, step: (dir === 'up' ? 1 : -1) * n(step), everyDays: n(every) * (unit === 'weeks' ? 7 : 1), until: n(until) });
  // A step at the dose already in force that day (the first, usually) changes nothing: left out.
  const steps = all.filter((x) => Math.abs(medOn(med, x.from).defaultAmount - x.dose) > 1e-9);
  const dateError = from < tomorrow ? 'Start from tomorrow on. To change today, edit the medication.' : undefined;
  const filled = n(start) > 0 && n(step) > 0 && n(every) >= 1 && n(until) > 0;
  const mismatch = filled && !all.length ? `Stepping ${dir} from ${start} won't reach ${until}. Check the direction.` : undefined;
  const save = async () => {
    if (!steps.length || dateError) return;
    const changes = steps.map((x, i) => ({ from: x.from, defaultAmount: x.dose, schedule: scheduleAtDose(medOn(med, x.from).schedule), note: `Step ${i + 1} of ${steps.length}` }));
    const ids = await addPlannedChanges(med.id, changes);
    toast(`Planned ${ids.length} step${ids.length === 1 ? '' : 's'}`, { onAction: () => removePlannedChanges(med.id, ids) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Steps on a schedule">
      <div className="space-y-4">
        <p className="text-sm text-muted">Times and days stay the same; only the dose changes.</p>
        <TextInput label={`First dose (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={start} onChange={(e) => setStart(e.target.value)} />
        <Segmented label="Up or down" value={dir} options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} onChange={setDir} />
        <TextInput label={`By (${med.unit}) each step`} type="number" inputMode="decimal" min="0" step="any" value={step} onChange={(e) => setStep(e.target.value)} />
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <TextInput label="Every" type="number" inputMode="numeric" min="1" step="1" value={every} onChange={(e) => setEvery(e.target.value)} />
          <Segmented label="Weeks or days" value={unit} options={[{ value: 'weeks', label: 'Weeks' }, { value: 'days', label: 'Days' }]} onChange={setUnit} />
        </div>
        <TextInput label={`Until the dose is (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={until} onChange={(e) => setUntil(e.target.value)} error={mismatch} />
        <TextInput label="First step on" type="date" min={tomorrow} value={from} onChange={(e) => setFrom(e.target.value)} error={dateError} />
        {steps.length > 0 && (
          <div className="rounded-btn bg-surface-2 p-3">
            <p className="font-semibold mb-1">{steps.length} step{steps.length === 1 ? '' : 's'}</p>
            <ol className="text-sm space-y-0.5 tnum">{steps.map((x) => <li key={x.from}>{fmtYmdDay(x.from)}: {fmtAmount(x.dose, med.unit)}</li>)}</ol>
          </div>
        )}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!steps.length || !!dateError} onClick={save}>Plan {steps.length || ''} step{steps.length === 1 ? '' : 's'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** "Ready for the next step when": the conditions a dated step is checked against (and a step plan uses). */
function ConditionsSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const c = med.stepUp ?? DEFAULT_STEP_UP;
  const [f, setF] = useState({ minWeeks: c.minWeeks ?? '', maxEffectPct: c.maxEffectPct ?? '', maxLossKgWeek: c.maxLossKgWeek ?? '', minAppetite: c.minAppetite ?? '', noMissedWeeks: c.noMissedWeeks ?? '' } as Record<keyof StepUpCriteria, string | number>);
  const num = (x: string | number) => (String(x).trim() === '' ? undefined : Number(x));
  const save = async () => {
    await saveStepConditions(med.id, { minWeeks: num(f.minWeeks), maxEffectPct: num(f.maxEffectPct), maxLossKgWeek: HAS_BODY ? num(f.maxLossKgWeek) : undefined, minAppetite: num(f.minAppetite), noMissedWeeks: num(f.noMissedWeeks) });
    onClose();
  };
  const field = (k: keyof StepUpCriteria, label: string) => (
    <TextInput label={label} type="number" inputMode="decimal" min="0" step="any" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  return (
    <Sheet open onClose={onClose} title="Ready for the next step when">
      <div className="space-y-3">
        <p className="text-sm text-muted">Yours or your prescriber's. Leave any blank to skip it.</p>
        {field('minWeeks', 'Weeks on the dose, at least')}
        {field('maxEffectPct', 'Side effects in at most this % of check-ins')}
        {HAS_BODY && field('maxLossKgWeek', 'Losing at most this many kg a week')}
        {field('minAppetite', 'Appetite at least (1–5)')}
        {field('noMissedWeeks', 'No missed doses for this many weeks')}
        <SheetActions><Button className="w-full min-h-[56px]" onClick={save}>Save</Button></SheetActions>
      </div>
    </Sheet>
  );
}

function StepPlanSheet({ med, now, s, onClose }: { med: Medication; now: number; s: ScheduleSettings; onClose: () => void }) {
  const toast = useToast();
  const p = med.stepPlan;
  const c = med.stepUp ?? {};
  const vial = !!med.peptide && !isPen(med);
  const [dir, setDir] = useState<'up' | 'down'>(p?.down ? 'down' : 'up');
  const [by, setBy] = useState(p ? String(p.by) : '');
  const [byUnits, setByUnits] = useState<'units' | 'amount'>(p ? (p.byUnits ? 'units' : 'amount') : vial ? 'units' : 'amount');
  const [weeks, setWeeks] = useState(String(c.minWeeks ?? 4));
  const [max, setMax] = useState(p ? String(p.max) : '');
  const [maxPer, setMaxPer] = useState<'dose' | 'week'>(p?.maxPer ?? 'week');
  const [appetite, setAppetite] = useState(c.minAppetite !== undefined ? String(c.minAppetite) : '');
  const [effects, setEffects] = useState(c.maxEffectPct !== undefined ? String(c.maxEffectPct) : '');
  const [loss, setLoss] = useState(c.maxLossKgWeek !== undefined ? String(c.maxLossKgWeek) : '');
  const [missed, setMissed] = useState(c.noMissedWeeks !== undefined ? String(c.noMissedWeeks) : '');
  const num = (x: string) => (x.trim() === '' ? undefined : Number(x));
  const plan: StepPlan = { by: Number(by), byUnits: byUnits === 'units' || undefined, down: dir === 'down' || undefined, max: Number(max), maxPer };
  const step = stepAmount(med, plan);
  const limit = Number(max) > 0 ? planLimit(med, plan, now, s) : undefined;
  const wrongWay = limit !== undefined && (dir === 'up' ? limit < med.defaultAmount : limit > med.defaultAmount);
  const valid = !!step && Number(max) > 0 && Number(weeks) >= 1 && !wrongWay;
  // The steps from today's dose to the limit, as a preview.
  const preview: number[] = [];
  if (valid && limit !== undefined) {
    let d = med.defaultAmount;
    while (preview.length < 30 && (dir === 'up' ? d < limit - 1e-9 : d > limit + 1e-9)) { d = r4(dir === 'up' ? Math.min(limit, d + step!) : Math.max(limit, d - step!)); preview.push(d); }
  }
  const save = async () => {
    const criteria: StepUpCriteria = { minWeeks: num(weeks), minAppetite: num(appetite), maxEffectPct: num(effects), maxLossKgWeek: HAS_BODY ? num(loss) : undefined, noMissedWeeks: num(missed) };
    await saveStepPlan(med.id, plan, criteria);
    toast('Step plan saved');
    onClose();
  };
  const unitLabel = byUnits === 'units' ? 'units on the syringe' : med.unit;
  return (
    <Sheet open onClose={onClose} title="Step when ready">
      <div className="space-y-4">
        <p className="text-sm text-muted">From your prescriber or your own protocol. When every condition is met, Today asks before changing anything.</p>
        <Segmented label="Step" value={dir} onChange={setDir} options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} />
        {vial && <Segmented label="Step size in" value={byUnits} onChange={setByUnits} options={[{ value: 'units', label: 'Syringe units' }, { value: 'amount', label: med.unit }]} />}
        <TextInput label={`By (${unitLabel})`} type="number" inputMode="decimal" min="0" step="any" value={by} onChange={(e) => setBy(e.target.value)}
          help={byUnits === 'units' && step ? `${fmtAmount(r4(step), med.unit)} with the vial in use` : undefined} />
        <TextInput label="At least this many weeks on each dose" type="number" inputMode="numeric" min="1" step="1" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
        <TextInput label={`${dir === 'up' ? 'Up to' : 'Down to'} (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={max} onChange={(e) => setMax(e.target.value)}
          error={wrongWay ? `That's ${dir === 'up' ? 'below' : 'above'} today's dose.` : undefined}
          help={maxPer === 'week' && limit !== undefined && Number(max) > 0 ? `${fmtAmount(limit, med.unit)} a dose on your schedule` : undefined} />
        <Segmented label="That's the most" value={maxPer} onChange={setMaxPer} options={[{ value: 'week', label: 'In a week' }, { value: 'dose', label: 'In one dose' }]} />
        <fieldset className="space-y-3">
          <legend className="font-medium mb-1">And only when (optional)</legend>
          <TextInput label="Appetite back to at least (1 to 5)" type="number" inputMode="decimal" min="1" max="5" step="0.5" value={appetite} onChange={(e) => setAppetite(e.target.value)}
            help="Average of your check-ins over 2 weeks" />
          <TextInput label="Side effects in at most this % of check-ins" type="number" inputMode="numeric" min="0" max="100" step="1" value={effects} onChange={(e) => setEffects(e.target.value)} />
          {HAS_BODY && <TextInput label="Weight loss slowed to at most (kg a week)" type="number" inputMode="decimal" min="0" step="0.1" value={loss} onChange={(e) => setLoss(e.target.value)} />}
          <TextInput label="No missed doses for (weeks)" type="number" inputMode="numeric" min="1" step="1" value={missed} onChange={(e) => setMissed(e.target.value)} />
        </fieldset>
        {preview.length > 0 && (
          <div className="rounded-btn bg-surface-2 p-3">
            <p className="font-semibold mb-1">{preview.length} step{preview.length === 1 ? '' : 's'} from {fmtAmount(med.defaultAmount, med.unit)}</p>
            <p className="text-sm tnum">{preview.map((d) => fmtAmount(d, med.unit)).join(' → ')}</p>
            <p className="text-xs text-muted mt-1">Each at least {weeks} week{weeks === '1' ? '' : 's'} apart, when the conditions are met.</p>
          </div>
        )}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!valid} onClick={save}>Save step plan</Button>
          {p && <Button variant="secondary" className="w-full" onClick={async () => { await saveStepPlan(med.id, undefined, undefined); toast('Step plan removed'); onClose(); }}>Remove the step plan</Button>}
        </SheetActions>
      </div>
    </Sheet>
  );
}
