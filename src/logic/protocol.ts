// Protocol view (peptide tools): the week's shot days, when stock and supplies run out (and when to order), the estimated
// level carried forward through the plan, results by batch, and a report for each dose step.
// Pure: `now` and settings are passed in. Everything comes from the person's own records and plan; nothing is suggested.
import type { BodyEntry, CheckIn, Dose, Medication, Supply } from '../db/schema';
import { getDayBounds, getFixedSlots, getSlots, isScheduledDay, plannedAmounts, timeInDay, weekdayOf, type ScheduleSettings } from './schedule';
import { forecastRunOut, medOn, type Forecast } from './plans';
import { dosesFromVial, estimatedLevel, SIDE_EFFECT_CHIPS, supplyCount, vialsOf } from './peptide';
import { dayKey } from './stats';

const DAY = 86_400_000;
const r = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const taken = (d: Dose) => !d.deletedAt && !d.skipped;
export const DEFAULT_LEAD_DAYS = 7;

/** Start of the user day `offset` days from the one containing `t` (DST-safe: steps by noon, then snaps). */
function dayStartOffset(t: number, offset: number, s: ScheduleSettings): number {
  const start = getDayBounds(t, s.dayStartsAt, s.tz).start;
  return getDayBounds(start + offset * DAY + 12 * 3_600_000, s.dayStartsAt, s.tz).start;
}

// ── The week's shot days ─────────────────────────────────────────────────────────────────────────────

export type DayState = 'taken' | 'partial' | 'missed' | 'skipped' | 'today' | 'upcoming' | 'off' | 'extra';
export interface WeekDay {
  ymd: string; start: number; label: string;
  isToday: boolean; future: boolean;
  /** Doses the plan has for the day, and doses logged (taken / skipped). */
  planned: number; taken: number; skipped: number;
  state: DayState;
}
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Monday to Sunday of this week for one medication: what the plan had each day and what was logged. */
export function weekStrip(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): WeekDay[] {
  const todayStart = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const back = (weekdayOf(todayStart, s) + 6) % 7; // days since Monday
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt);
  return Array.from({ length: 7 }, (_, i) => {
    const start = dayStartOffset(now, i - back, s);
    const end = getDayBounds(start, s.dayStartsAt, s.tz).end;
    const ymd = dayKey(start, s);
    const m = medOn(med, ymd);
    const amounts = plannedAmounts(m, start, s);
    const planned = m.schedule.type === 'prn' ? 0 : amounts.length || (isScheduledDay(m, start, s) ? 1 : 0);
    const day = mine.filter((d) => { const t = Date.parse(d.takenAt); return t >= start && t < end; });
    const tk = day.filter((d) => !d.skipped).length;
    const sk = day.filter((d) => d.skipped).length;
    const isToday = start === todayStart;
    const future = start > todayStart;
    let state: DayState;
    if (planned === 0) state = tk ? (m.schedule.type === 'prn' ? 'taken' : 'extra') : 'off';
    else if (tk >= planned) state = 'taken';
    else if (future) state = 'upcoming';
    else if (tk + sk >= planned && sk) state = 'skipped';
    else if (isToday) state = tk ? 'partial' : 'today';
    else state = tk ? 'partial' : 'missed';
    return { ymd, start, label: LETTERS[weekdayOf(start, s)], isToday, future, planned, taken: tk, skipped: sk, state };
  });
}

// ── Stock: when it runs out, and when to order ──────────────────────────────────────────────────────

export interface StockPlan {
  /** Vials or pens left, counting what's left in the one in use. */
  left?: number;
  forecast: Forecast | null;
  /** Order by this day to have more before running out (run-out less the delivery time). */
  orderBy: number | null;
  leadDays: number;
}

export function stockPlan(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): StockPlan {
  const leadDays = med.peptide?.leadTimeDays ?? DEFAULT_LEAD_DAYS;
  const forecast = forecastRunOut(med, doses, now, s);
  const orderBy = forecast?.runOutAt != null ? forecast.runOutAt - leadDays * DAY : null;
  return { left: med.stockCount, forecast, orderBy, leadDays };
}

/** Injections the plans have for each of the next `days` user days (today: only those still to come). */
export function plannedInjections(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings, days: number) {
  const peptides = meds.filter((m) => m.peptide && !m.archived);
  const out: { start: number; byMed: { med: Medication; amounts: number[] }[] }[] = [];
  for (let i = 0; i < days; i++) {
    const start = dayStartOffset(now, i, s);
    const byMed = peptides.map((med) => {
      let amounts = plannedAmounts(medOn(med, dayKey(start, s)), start, s);
      if (i === 0) {
        const { end } = getDayBounds(now, s.dayStartsAt, s.tz);
        const done = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && Date.parse(d.takenAt) >= start && Date.parse(d.takenAt) < end).length;
        amounts = amounts.slice(done);
      }
      return { med, amounts };
    });
    out.push({ start, byMed });
  }
  return out;
}

export interface SupplyPlan {
  supply: Supply;
  count: number;
  /** For the sharps container: when it's full. Otherwise when it runs out. */
  runOutAt: number | null;
  orderBy: number | null;
}

/** When each supply runs out (or the sharps container fills), following the injection plans. */
export function supplyPlans(supplies: Supply[], meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings,
  leadDays = DEFAULT_LEAD_DAYS, horizon = 180): SupplyPlan[] {
  const plan = plannedInjections(meds, doses, now, s, horizon);
  return supplies.filter((x) => !x.deletedAt).map((supply) => {
    const count = supplyCount(supply, meds, doses);
    const room = supply.kind === 'sharps' ? (supply.capacity ?? Infinity) - count : count;
    let used = 0;
    let runOutAt: number | null = null;
    for (const day of plan) {
      for (const { med, amounts } of day.byMed) {
        const pen = med.peptide?.kind === 'pen';
        if (supply.kind === 'water') {
          if (pen || !(med.strength > 0)) continue;
          used += amounts.reduce((a, b) => a + b, 0) / med.strength * (med.peptide?.waterMl ?? 0);
        } else if (supply.kind === 'swabs' || supply.kind === 'sharps' || (supply.kind === 'syringes' ? !pen : pen)) {
          used += amounts.length;
        }
      }
      if (used > room + 1e-9) { runOutAt = day.start; break; }
    }
    return { supply, count, runOutAt, orderBy: runOutAt !== null && supply.kind !== 'sharps' ? runOutAt - leadDays * DAY : null };
  });
}

// ── Estimated level, carried forward through the plan ───────────────────────────────────────────────

/** The doses the plan has after `now` until `until` (set times at their times; every-few-hours from the day start). */
export function plannedDoses(med: Medication, doses: Dose[], now: number, until: number, s: ScheduleSettings): { t: number; amount: number }[] {
  const out: { t: number; amount: number }[] = [];
  for (let i = 0; ; i++) {
    const start = dayStartOffset(now, i, s);
    if (start >= until) break;
    const m = medOn(med, dayKey(start, s));
    if (m.schedule.type === 'prn' || !isScheduledDay(m, start, s)) { if (i > 400) break; continue; }
    if (m.schedule.type === 'fixed') {
      const slots = i === 0 ? getFixedSlots(m, doses, now, s).filter((x) => !x.dose && x.at > now)
        : getSlots(m).map((x) => ({ at: timeInDay(start, x.time, s), amount: x.amount ?? m.defaultAmount }));
      for (const x of slots) if (x.at > now && x.at < until) out.push({ t: x.at, amount: x.amount });
    } else {
      const amounts = plannedAmounts(m, start, s);
      const gap = (m.schedule.intervalHours ?? 24) * 3_600_000;
      amounts.forEach((a, k) => { const t = start + 4 * 3_600_000 + k * gap; if (t > now && t < until) out.push({ t, amount: a }); });
    }
    if (i > 400) break;
  }
  return out;
}

/** Estimated level from the doses taken, then (dashed on the chart) from the doses the plan has to come. */
export function projectedLevel(med: Medication, doses: Dose[], now: number, s: ScheduleSettings, from: number, to: number) {
  const h = med.peptide?.halfLifeHours;
  if (!h) return { past: [], future: [] };
  const mine = doses.filter((d) => d.medicationId === med.id);
  const future = plannedDoses(med, doses, now, to, s).map((p, i) => ({
    id: `plan-${i}`, medicationId: med.id, takenAt: new Date(p.t).toISOString(), amount: p.amount, source: 'manual' as const, createdAt: '', updatedAt: '',
  }));
  const all = [...mine, ...future];
  const pts = estimatedLevel(all, h, from, Math.max(to, now + 1), 240);
  return { past: pts.filter((p) => p.t <= now), future: pts.filter((p) => p.t >= now - (to - from) / 239) };
}

// ── Results by batch ────────────────────────────────────────────────────────────────────────────────

export interface LotStats {
  lot: string;
  supplier?: string;
  vials: number;
  doses: number;
  from: number; to: number;
  /** Weight change per week while vials from it were in use (needs two weigh-ins inside). */
  perWeek?: number;
  appetite?: number;
  checkIns: number;
  noticed: { chip: string; n: number }[];
  flag?: { note?: string; at: string };
}

/** For each batch used: its doses, and the weight and check-ins while its vials were in use. */
export function lotStats(med: Medication, doses: Dose[], body: BodyEntry[], checkIns: CheckIn[], now: number): LotStats[] {
  const byLot = new Map<string, { vials: number; doses: Dose[]; ranges: [number, number][]; supplier?: string }>();
  for (const v of vialsOf(med)) {
    if (!v.lot || !v.startedAt) continue;
    const e = byLot.get(v.lot) ?? { vials: 0, doses: [], ranges: [] };
    e.vials++;
    e.supplier ??= v.supplier;
    e.doses.push(...dosesFromVial(v, med.id, doses));
    e.ranges.push([Date.parse(v.startedAt), v.finishedAt ? Date.parse(v.finishedAt) : now]);
    byLot.set(v.lot, e);
  }
  const inRanges = (t: number, rs: [number, number][]) => rs.some(([a, b]) => t >= a && t < b);
  const weights = body.filter((b) => !b.deletedAt && typeof b.weightKg === 'number').map((b) => ({ t: Date.parse(`${b.date}T12:00`), kg: b.weightKg! })).sort((a, b) => a.t - b.t);
  return [...byLot].map(([lot, e]) => {
    const from = Math.min(...e.ranges.map((x) => x[0]));
    const to = Math.max(...e.ranges.map((x) => x[1]));
    const ws = weights.filter((w) => inRanges(w.t, e.ranges));
    const perWeek = ws.length >= 2 && ws[ws.length - 1].t > ws[0].t ? r(((ws[ws.length - 1].kg - ws[0].kg) / (ws[ws.length - 1].t - ws[0].t)) * 7 * DAY) : undefined;
    const cis = checkIns.filter((c) => !c.deletedAt && inRanges(Date.parse(c.at), e.ranges));
    const app = cis.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
    const counts = new Map<string, number>();
    for (const c of cis) for (const chip of c.chips) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    const flag = med.lotFlags?.find((f) => f.lot === lot);
    return {
      lot, supplier: e.supplier, vials: e.vials, doses: e.doses.length, from, to, perWeek,
      appetite: app.length ? r(app.reduce((a, b) => a + b, 0) / app.length, 1) : undefined,
      checkIns: cis.length, noticed: [...counts].map(([chip, n]) => ({ chip, n })).sort((a, b) => b.n - a.n).slice(0, 3),
      flag: flag ? { note: flag.note, at: flag.at } : undefined,
    };
  }).sort((a, b) => b.from - a.from);
}

// ── Report for each dose step ───────────────────────────────────────────────────────────────────────

export interface StepRow {
  dose: number;
  from: number; to: number;
  weeks: number;
  doses: number;
  weightPerWeek?: number; waistPerWeek?: number;
  appetite?: number;
  checkIns: number;
  /** Side effects: how many check-ins on this step noted each one, and what share of them. */
  sideEffects: { chip: string; n: number; pct: number }[];
}

function perWeekIn(points: { t: number; v: number }[], from: number, to: number): number | undefined {
  const before = points.filter((p) => p.t <= from).pop() ?? points.find((p) => p.t > from && p.t <= to);
  const end = points.filter((p) => p.t <= to).pop();
  return before && end && end.t > before.t ? r(((end.v - before.v) / (end.t - before.t)) * 7 * DAY) : undefined;
}

/** One row per dose step actually taken (a new step starts when the dose amount changes). */
export function stepReport(med: Medication, doses: Dose[], body: BodyEntry[], checkIns: CheckIn[], now: number): StepRow[] {
  const mine = doses.filter((d) => d.medicationId === med.id && taken(d)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const steps: StepRow[] = [];
  for (const d of mine) {
    const t = Date.parse(d.takenAt);
    const last = steps[steps.length - 1];
    if (last && r(last.dose, 4) === r(d.amount, 4)) { last.doses++; continue; }
    if (last) last.to = t;
    steps.push({ dose: d.amount, from: t, to: now, weeks: 0, doses: 1, checkIns: 0, sideEffects: [] });
  }
  const series = (k: 'weightKg' | 'waistCm') => body.filter((b) => !b.deletedAt && typeof b[k] === 'number')
    .map((b) => ({ t: Date.parse(`${b.date}T12:00`), v: b[k] as number })).sort((a, b) => a.t - b.t);
  const weight = series('weightKg');
  const waist = series('waistCm');
  for (const st of steps) {
    st.weeks = r((st.to - st.from) / (7 * DAY), 1);
    st.weightPerWeek = perWeekIn(weight, st.from, st.to);
    st.waistPerWeek = perWeekIn(waist, st.from, st.to);
    const cis = checkIns.filter((c) => !c.deletedAt && Date.parse(c.at) >= st.from && Date.parse(c.at) < st.to);
    st.checkIns = cis.length;
    const app = cis.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
    if (app.length) st.appetite = r(app.reduce((a, b) => a + b, 0) / app.length, 1);
    st.sideEffects = SIDE_EFFECT_CHIPS.map((chip) => ({ chip, n: cis.filter((c) => c.chips.includes(chip)).length }))
      .filter((x) => x.n > 0).map((x) => ({ ...x, pct: Math.round((x.n / cis.length) * 100) })).sort((a, b) => b.n - a.n);
  }
  return steps;
}
