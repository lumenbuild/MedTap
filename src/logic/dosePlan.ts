// Dosing plans the person sets (their own or their prescriber's): step the dose once their conditions are met, up to
// their maximum; a course, then a break until they start again; or on and off. Facts against their plan: the app says
// when a step or a restart is due and changes nothing until they confirm. Pure.
import type { BodyEntry, CheckIn, Dose, Medication, StepPlan } from '../db/schema';
import { courseInfo, cycleInfo, getDayBounds, plannedAmounts, type ScheduleSettings } from './schedule';
import { stepUpChecklist, type StepCheck } from './stepUp';
import { currentVial, doseForUnits, fmtUnits } from './peptide';
import { fmtAmount, fmtSpan, fmtYmdDay } from './format';
import { dayKey } from './stats';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** One step in the medication's unit. Syringe units are worked out from the vial in use (or the usual mix). */
export function stepAmount(med: Medication, p: StepPlan): number | undefined {
  if (!(p.by > 0)) return undefined;
  if (!p.byUnits) return p.by;
  const pep = med.peptide;
  if (!pep || pep.kind === 'pen') return undefined;
  const v = currentVial(med);
  const amount = v?.amount ?? med.strength, water = v?.waterMl ?? pep.waterMl;
  return amount > 0 && water > 0 ? doseForUnits(p.by, amount, water, pep.syringe) : undefined;
}

/** Doses in a usual week, from the schedule (on/off stretches and breaks left out), for a weekly maximum. */
export function dosesPerWeek(med: Medication, now: number, s: ScheduleSettings): number {
  const plain: Medication = { ...med, schedule: { ...med.schedule, cycle: undefined, course: undefined } };
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  let n = 0;
  for (let i = 0; i < 28; i++) n += plannedAmounts(plain, start + i * DAY + DAY / 2, s).length;
  return n / 4;
}

/** The highest (or, stepping down, lowest) single dose the plan allows. */
export function planLimit(med: Medication, p: StepPlan, now: number, s: ScheduleSettings): number {
  const perWeek = dosesPerWeek(med, now, s);
  return r4(p.maxPer === 'week' && perWeek > 0 ? p.max / perWeek : p.max);
}

export interface StepStatus {
  current: number; next: number; step: number; limit: number;
  /** Already at the plan's maximum (or minimum, stepping down). */
  atLimit: boolean;
  /** Every condition met, not at the limit and not put off: ask "Step up now?". */
  ready: boolean;
  /** "Not yet" was chosen; asks again from this date. */
  snoozedUntil?: string;
  /** Stepped, but no dose taken at the new amount yet. */
  awaitingFirstDose: boolean;
  /** The plan's conditions, each ticked from the records. */
  checks: StepCheck[];
  /** When the weeks-on-this-dose condition will be met, if it isn't yet. */
  readyFrom?: number;
}

export function stepStatus(med: Medication, doses: Dose[], checkIns: CheckIn[], body: BodyEntry[], now: number, s: ScheduleSettings): StepStatus | null {
  const p = med.stepPlan;
  if (!p || med.archived || med.schedule.type === 'prn') return null;
  const step = stepAmount(med, p);
  if (!step) return null;
  const current = med.defaultAmount;
  const limit = planLimit(med, p, now, s);
  const atLimit = p.down ? current <= limit + 1e-9 : current >= limit - 1e-9;
  const next = r4(p.down ? Math.max(limit, current - step) : Math.min(limit, current + step));
  const v = stepUpChecklist(med, doses, checkIns, body, now, s);
  const checks = v?.checks ?? [];
  const awaitingFirstDose = !!v && Math.abs(v.amount - current) > 1e-6;
  const snoozed = !!p.snoozedUntil && dayKey(now, s) < p.snoozedUntil;
  const weeks = med.stepUp?.minWeeks;
  const readyFrom = v && weeks && now - v.since < weeks * WEEK ? v.since + weeks * WEEK : undefined;
  const ready = !!v && !atLimit && !snoozed && !awaitingFirstDose && checks.every((c) => c.ok === true);
  return { current, next, step, limit, atLimit, ready, snoozedUntil: snoozed ? p.snoozedUntil : undefined, awaitingFirstDose, checks, readyFrom };
}

/** "Up 5 units (0.5 mg) when ready, to 12 mg a week" */
export function describeStepPlan(med: Medication, p: StepPlan): string {
  const amt = stepAmount(med, p);
  const by = p.byUnits ? `${fmtUnits(p.by)}${amt ? ` (${fmtAmount(r4(amt), med.unit)})` : ''}` : fmtAmount(p.by, med.unit);
  return `${p.down ? 'Down' : 'Up'} ${by} ${p.lowest ? 'only once loss slows' : 'when ready'}, ${p.down ? 'down' : 'up'} to ${fmtAmount(p.max, med.unit)} a ${p.maxPer}`;
}

// ── Courses ────────────────────────────────────────────────────────────────────────────────────────

export interface RestartPrompt { reason: string; at: number }

const mentions = (c: CheckIn, words: string[]) => words.some((w) => {
  const x = w.trim().toLowerCase();
  return !!x && (c.chips.some((ch) => ch.toLowerCase() === x) || (c.note ?? '').toLowerCase().includes(x));
});

/** On a course's break: ask about starting again when a check-in mentions what the person chose (e.g. Pain), or
 *  once the break has lasted as long as they said. Each reason asks once ("Not now" waits for the next one). */
export function restartPrompt(med: Medication, checkIns: CheckIn[], now: number, s: ScheduleSettings): RestartPrompt | null {
  const c = med.schedule.course;
  if (!c || med.archived) return null;
  const info = courseInfo(c, getDayBounds(now, s.dayStartsAt, s.tz).start, s);
  if (info.phase !== 'break') return null;
  const breakStart = getDayBounds(new Date(`${info.lastDay}T12:00`).getTime(), s.dayStartsAt, s.tz).end;
  const since = Math.max(breakStart, c.dismissedAt ? Date.parse(c.dismissedAt) : 0);
  if (c.restartOn?.length) {
    const hit = checkIns.filter((x) => !x.deletedAt && Date.parse(x.at) > since && Date.parse(x.at) <= now && mentions(x, c.restartOn!))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (hit) {
      const word = c.restartOn.find((w) => mentions(hit, [w]))!;
      return { reason: `${word.trim()[0].toUpperCase()}${word.trim().slice(1)} in a check-in ${fmtYmdDay(dayKey(Date.parse(hit.at), s))}`, at: Date.parse(hit.at) };
    }
  }
  if (c.remindAfterDays) {
    const due = breakStart + c.remindAfterDays * DAY;
    if (now >= due && since < due) return { reason: `${fmtSpan(c.remindAfterDays)} into the break`, at: due };
  }
  return null;
}

/** Where a medication is in its course or on/off cycle, in words (undefined without either). */
export function planLine(med: Medication, now: number, s: ScheduleSettings): string | undefined {
  const sc = med.schedule;
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const inWeeks = (day: number, length: number) => (length >= 14 && length % 7 === 0 ? `week ${Math.ceil(day / 7)} of ${length / 7}` : `day ${day} of ${length}`);
  if (sc.course) {
    const i = courseInfo(sc.course, start, s);
    if (i.phase === 'before') return `Course starts ${fmtYmdDay(sc.course.start)}`;
    if (i.phase === 'on') return `Course, ${inWeeks(i.day, i.length)} · last day ${fmtYmdDay(i.lastDay)}`;
    return `On a break · ${i.breakDays >= 14 ? `${Math.floor(i.breakDays / 7)} weeks` : `${i.breakDays} day${i.breakDays === 1 ? '' : 's'}`} since the course ended`;
  }
  if (sc.cycle) {
    const i = cycleInfo(sc.cycle, start, s);
    if (!i) return undefined;
    if (i.phase === 'before') return `On and off, starts ${fmtYmdDay(i.nextChange)}`;
    return `${i.phase === 'on' ? 'On' : 'Off'}, ${inWeeks(i.day, i.length)} · ${i.phase === 'on' ? 'break' : 'back on'} ${fmtYmdDay(i.nextChange)}`;
  }
  return undefined;
}

/** A few words for a day the medication isn't taken because of its plan ("On a break", "Off until Thu 29 Oct"). */
export function planShort(med: Medication, now: number, s: ScheduleSettings): string | undefined {
  const sc = med.schedule;
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  if (sc.course) {
    const i = courseInfo(sc.course, start, s);
    if (i.phase === 'break') return 'On a break';
    if (i.phase === 'before') return `Starts ${fmtYmdDay(sc.course.start)}`;
  }
  if (sc.cycle) {
    const i = cycleInfo(sc.cycle, start, s);
    if (i?.phase === 'off') return `Off until ${fmtYmdDay(i.nextChange)}`;
  }
  return undefined;
}
