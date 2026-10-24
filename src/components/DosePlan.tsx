// Dosing plans on screen: the step plan (set on the medication's page, asked about on Today and Protocol when it's
// due), and "start another course?" during a course's break.
import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { Check, Minus, RotateCcw, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { BodyEntry, CheckIn, Dose, Medication, StepPlan, StepUpCriteria } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { describeStepPlan, planLimit, stepAmount, stepStatus, type RestartPrompt, type StepStatus } from '../logic/dosePlan';
import { fmtAmount, fmtDay } from '../logic/format';
import { fmtUnits, isPen } from '../logic/peptide';
import { shownName } from '../logic/privacy';
import { personOf } from '../db/repos/people';
import { applyStep, dismissRestart, saveStepPlan, snoozeStep, startCourse, undoPlanChange } from '../db/repos/meds';
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

/** The plan's conditions as a ticked list. */
function Checks({ v }: { v: StepStatus }) {
  return (
    <ul>
      {v.checks.map((c) => (
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

/** On the medication's page: the step plan, with its conditions ticked, and Set or Edit. */
export function StepPlanCard({ med }: { med: Medication }) {
  const doses = useDoses();
  const checkIns = useCheckIns();
  const body = useBodyEntries();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  if (!doses || !checkIns || !body || !ss || med.schedule.type === 'prn') return null;
  const recs = planRecords(med, doses, checkIns, body);
  const v = stepStatus(med, recs.doses, recs.checkIns, recs.body, now, ss[1]);
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><TrendingUp size={20} className="text-primary" aria-hidden="true" /> Step when ready</h2>
      {med.stepPlan ? (
        <>
          <p className="text-[15px]">{describeStepPlan(med, med.stepPlan)}.</p>
          {v ? (
            <>
              <p className="text-[15px] font-medium">{stepSummary(med, v, now)}</p>
              {v.checks.length > 0 && !v.atLimit && <Checks v={v} />}
            </>
          ) : <p className="text-[15px] text-muted">Starts checking once you've logged a dose.</p>}
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>Edit the plan</Button>
        </>
      ) : (
        <>
          <p className="text-muted">Step the dose up (or down) by a set amount once your own conditions are met, e.g. every 4 weeks when appetite is back, to a maximum. It asks first; nothing changes until you say.</p>
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>Set a step plan</Button>
        </>
      )}
      {open && <StepPlanSheet med={med} now={now} s={ss[1]} onClose={() => setOpen(false)} />}
    </Card>
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
