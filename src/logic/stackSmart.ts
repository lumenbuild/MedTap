// The stack, made smarter and joined up: a warning when a new vial is a different strength from the last (so the
// units to draw change), what your vials actually give against what they should (and the loss per vial learned from
// it), how each batch did on the peptide's own goal and what it
// cost per mg, a summary when a course ends, every peptide's estimated level on one chart, the courses on one
// calendar, one shopping list for the whole stack with delivery times learned from your orders, and fridge
// excursions. Facts from the person's own records: dose changes stay with their prescriber. Pure.
import type { CheckIn, DailyHealth, Dose, BodyEntry, Experiment, Medication, PeptideVial } from '../db/schema';
import { concentration, currentVial, drawFor, estimatedLevel, stockVials, vialsOf } from './peptide';
import { courseShop } from './courseShop';
import { courseInfo, getDayBounds, type ScheduleSettings } from './schedule';
import { goalOf, outcomeByDay, OUTCOMES, MEANINGFUL, type Outcome } from './verdict';
import { guideFor } from './peptideGuide';
import { dayKey } from './stats';
import { shownName } from './privacy';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const taken = (d: Dose) => live(d) && !d.skipped;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
const peptides = (meds: Medication[]) => meds.filter((m) => m.peptide && !m.archived);

// ── 1. A new vial at a different strength ──────────────────────────────────────────────────────────────

export interface StrengthChange { vial: PeptideVial; was: number; now: number; unitsWas: number; unitsNow: number; checked: boolean }

/** The vial in use is a different strength (mg per mL) from the one before it: the same dose is a different number of
 *  units. Until it's confirmed (`checkedAt`), every dose says so. Pens and unchanged strengths: null. */
export function strengthChange(med: Medication, dose = med.defaultAmount): StrengthChange | null {
  if (!med.peptide || med.peptide.kind === 'pen' || !(dose > 0)) return null;
  const cur = currentVial(med);
  if (!cur?.waterMl || !cur.startedAt) return null;
  const prev = vialsOf(med).filter((v) => v.status === 'finished' && v.waterMl && v.startedAt && v.startedAt < cur.startedAt!)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
  if (!prev?.waterMl) return null;
  const was = concentration(prev.amount, prev.waterMl), now = concentration(cur.amount, cur.waterMl);
  if (!(was > 0) || !(now > 0) || Math.abs(now / was - 1) < 0.05) return null;
  const syr = med.peptide.syringe;
  return { vial: cur, was: r(was, 3), now: r(now, 3), unitsWas: r(drawFor(dose, prev.amount, prev.waterMl, syr).units), unitsNow: r(drawFor(dose, cur.amount, cur.waterMl, syr).units), checked: !!cur.checkedAt };
}

// ── 2. What vials actually give ───────────────────────────────────────────────────────────────────────

export { vialYield, type VialYield } from './peptide';

// ── 5. Each batch on the peptide's own goal, and its cost ─────────────────────────────────────────────

export interface BatchRow { lot: string; supplier?: string; vials: number; days: number; outcome?: number; perMg?: number }
export interface BatchCompare { outcome?: Outcome; label?: string; unit?: string; higherBetter?: boolean; rows: BatchRow[]; /** A batch well off the others on the goal, said plainly. */ note?: string }

/** Each batch (lot) used: days in use, the goal measure while it was (weight change a week for weight; the average
 *  otherwise) and the price per mg (or mcg). A batch whose result sits well apart from the rest is noted. */
export function batchCompare(med: Medication, d: { doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[]; experiments?: Experiment[] }, now: number, s: ScheduleSettings): BatchCompare | null {
  const byLot = new Map<string, { supplier?: string; vials: PeptideVial[] }>();
  for (const v of vialsOf(med)) if (v.lot && v.startedAt) { const e = byLot.get(v.lot) ?? { supplier: v.supplier, vials: [] }; e.vials.push(v); byLot.set(v.lot, e); }
  if (byLot.size < 2) return null;
  const goal = goalOf(med);
  const byDay = goal ? outcomeByDay(goal, { meds: [med], doses: d.doses, checkIns: d.checkIns, daily: d.daily, body: d.body, experiments: d.experiments ?? [] }, s) : undefined;
  const rows: BatchRow[] = [...byLot].map(([lot, e]) => {
    const ranges = e.vials.map((v) => [Date.parse(v.startedAt!), v.finishedAt ? Date.parse(v.finishedAt) : now] as const);
    const days = Math.round(ranges.reduce((a, [f, t]) => a + (t - f), 0) / DAY);
    let outcome: number | undefined;
    if (byDay && goal) {
      const pts = [...byDay].map(([k, v]) => ({ t: new Date(`${k}T12:00`).getTime(), v })).filter((p) => ranges.some(([f, t]) => p.t >= f && p.t < t)).sort((a, b) => a.t - b.t);
      if (goal === 'weight') { if (pts.length >= 3 && pts[pts.length - 1].t - pts[0].t >= 7 * DAY) outcome = r(((pts[pts.length - 1].v - pts[0].v) / (pts[pts.length - 1].t - pts[0].t)) * 7 * DAY, 2); }
      else if (pts.length >= 5) outcome = r(mean(pts.map((p) => p.v)), 1);
    }
    const priced = e.vials.filter((v) => v.cost && v.amount > 0);
    const perMg = priced.length ? r(mean(priced.map((v) => v.cost! / v.amount)), 2) : undefined;
    return { lot, supplier: e.supplier, vials: e.vials.length, days, outcome, perMg };
  }).sort((a, b) => b.days - a.days);
  let note: string | undefined;
  const scored = rows.filter((x) => x.outcome !== undefined && x.days >= 10);
  if (goal && scored.length >= 2) {
    const meaningful = goal === 'weight' ? 0.3 : MEANINGFUL[goal];
    const O = OUTCOMES[goal];
    for (const x of scored) {
      const rest = scored.filter((y) => y !== x).map((y) => y.outcome!);
      const diff = x.outcome! - mean(rest);
      const worse = goal === 'weight' ? diff > 0 : O.higherBetter ? diff < 0 : diff > 0;
      if (Math.abs(diff) >= meaningful && worse) {
        note = goal === 'weight'
          ? `With batch ${x.lot}, weight changed ${x.outcome! > 0 ? '+' : ''}${x.outcome} kg a week against ${r(mean(rest), 2)} kg with the others.`
          : `With batch ${x.lot}, ${O.label.toLowerCase()} averaged ${x.outcome} against ${r(mean(rest), 1)} with the others.`;
        break;
      }
    }
  }
  return { outcome: goal, label: goal ? OUTCOMES[goal].label : undefined, unit: goal === 'weight' ? 'kg a week' : goal ? OUTCOMES[goal].unit : undefined, higherBetter: goal ? (goal === 'weight' ? false : OUTCOMES[goal].higherBetter) : undefined, rows, note };
}

// ── 4. A course's summary ─────────────────────────────────────────────────────────────────────────────

export interface CourseSummary { med: Medication; label: string; unit: string; before?: number; during?: number; after?: number; change?: number; better?: boolean; ended: boolean; lastDay: string }

/** The peptide's goal measure in the 2 weeks before its course, the last 2 weeks of it, and (on the break) since.
 *  Weight compares weekly rates of change instead. Null without a course or a goal measured here. */
export function courseSummary(med: Medication, d: { doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[] }, now: number, s: ScheduleSettings): CourseSummary | null {
  const c = med.schedule.course;
  const goal = goalOf(med);
  if (!c || !goal) return null;
  const info = courseInfo(c, getDayBounds(now, s.dayStartsAt, s.tz).start, s);
  if (info.phase === 'before' || (info.phase === 'on' && info.day < 10)) return null;
  const byDay = outcomeByDay(goal, { meds: [med], doses: d.doses, checkIns: d.checkIns, daily: d.daily, body: d.body, experiments: [] }, s);
  const start = new Date(`${c.start}T12:00`).getTime(), end = new Date(`${info.lastDay}T12:00`).getTime() + DAY;
  const win = (from: number, to: number) => [...byDay].map(([k, v]) => ({ t: new Date(`${k}T12:00`).getTime(), v })).filter((p) => p.t >= from && p.t < to).sort((a, b) => a.t - b.t);
  const val = (pts: { t: number; v: number }[]) => {
    if (goal === 'weight') return pts.length >= 3 && pts[pts.length - 1].t - pts[0].t >= 6 * DAY ? r(((pts[pts.length - 1].v - pts[0].v) / (pts[pts.length - 1].t - pts[0].t)) * 7 * DAY, 2) : undefined;
    return pts.length >= 4 ? r(mean(pts.map((p) => p.v)), 1) : undefined;
  };
  const before = val(win(start - 14 * DAY, start));
  const during = val(win(Math.max(start, Math.min(end, now) - 14 * DAY), Math.min(end, now)));
  const after = info.phase === 'break' ? val(win(end, now + 1)) : undefined;
  const O = OUTCOMES[goal];
  const change = before !== undefined && during !== undefined ? r(during - before, 2) : undefined;
  const better = change === undefined ? undefined : goal === 'weight' ? change < 0 : O.higherBetter ? change > 0 : change < 0;
  if (before === undefined && during === undefined) return null;
  return { med, label: O.label, unit: goal === 'weight' ? 'kg a week' : O.unit, before, during, after, change, better, ended: info.phase === 'break', lastDay: info.lastDay };
}

// ── 7. Every peptide's level on one chart ─────────────────────────────────────────────────────────────

export interface LevelSeries { med: Medication; name: string; points: { t: number; pct: number }[]; nowPct: number }

/** Peptides that clear within a day of a shot (half-life under 24 hours). */
export function shortActing(meds: Medication[]): Medication[] {
  return peptides(meds).filter((m) => { const hl = m.peptide?.halfLifeHours ?? guideFor(m.name)?.halfLifeHours; return hl !== undefined && hl < 24; });
}

/** The estimated level of each peptide with a half-life of a day or more, as a share of its own peak over the window (so a mcg peptide
 *  and a mg one share a scale), from 14 days back to 7 ahead (planned doses ahead included). */
export function stackLevels(meds: Medication[], doses: Dose[], now: number, plannedAhead: (m: Medication) => { t: number; amount: number }[]): LevelSeries[] {
  const out: LevelSeries[] = [];
  for (const m of peptides(meds)) {
    const hl = m.peptide?.halfLifeHours ?? guideFor(m.name)?.halfLifeHours;
    // Short-acting ones (gone within a day of each shot) would only draw spikes: they're listed, not drawn.
    if (!hl || hl < 24) continue;
    const past = doses.filter((d) => taken(d) && d.medicationId === m.id && Date.parse(d.takenAt) > now - 60 * DAY);
    if (!past.length) continue;
    const ahead = plannedAhead(m).map((p, i) => ({ id: `p${i}`, medicationId: m.id, takenAt: new Date(p.t).toISOString(), amount: p.amount, source: 'manual' as const, createdAt: '', updatedAt: '' }));
    const pts = estimatedLevel([...past, ...ahead], hl, now - 14 * DAY, now + 7 * DAY, 120);
    const peak = Math.max(...pts.map((p) => p.v));
    if (!(peak > 0)) continue;
    const at = pts.reduce((best, p) => (Math.abs(p.t - now) < Math.abs(best.t - now) ? p : best), pts[0]);
    out.push({ med: m, name: shownName(m), points: pts.map((p) => ({ t: p.t, pct: Math.round((p.v / peak) * 100) })), nowPct: Math.round((at.v / peak) * 100) });
  }
  return out;
}

// ── 9. Courses on one calendar ────────────────────────────────────────────────────────────────────────

export interface CourseBar { med: Medication; name: string; spans: { from: number; to: number; kind: 'on' | 'break' }[]; overlapNote?: string }

/** Each peptide over the next 12 weeks (from 2 back): on-course spans and breaks for courses; continuous otherwise. */
export function courseCalendar(meds: Medication[], now: number, s: ScheduleSettings): { from: number; to: number; bars: CourseBar[] } {
  const from = getDayBounds(now - 14 * DAY, s.dayStartsAt, s.tz).start, to = from + 84 * DAY;
  const bars: CourseBar[] = peptides(meds).filter((m) => m.schedule.type !== 'prn').map((m) => {
    const c = m.schedule.course;
    if (!c) return { med: m, name: shownName(m), spans: [{ from, to, kind: 'on' as const }] };
    const spans: CourseBar['spans'] = [];
    const len = c.days * DAY, start = new Date(`${c.start}T00:00`).getTime();
    const breakLen = (c.remindAfterDays ?? c.days) * DAY;
    // The course as planned, then its break, then (as an outline) the next course if it's repeated.
    for (let t = start, i = 0; t < to && i < 6; i++) {
      spans.push({ from: Math.max(from, t), to: Math.min(to, t + len), kind: 'on' });
      spans.push({ from: Math.max(from, t + len), to: Math.min(to, t + len + breakLen), kind: 'break' });
      t += len + breakLen;
    }
    return { med: m, name: shownName(m), spans: spans.filter((x) => x.to > x.from) };
  });
  // Two courses starting within a week of each other: their effects are hard to tell apart.
  const starts = bars.flatMap((b) => b.spans.filter((x) => x.kind === 'on' && x.from > from).map((x) => ({ b, t: x.from })));
  for (const a of starts) for (const b of starts) if (a.b !== b.b && Math.abs(a.t - b.t) < 7 * DAY && a.t <= b.t) {
    a.b.overlapNote ??= `Starts within a week of ${b.b.name}: changes would be hard to put down to either.`;
  }
  return { from, to, bars };
}

// ── 10. One shopping list for the stack ───────────────────────────────────────────────────────────────

export interface StackShop {
  weeks: number;
  items: { med: Medication; name: string; vials: number; vialSize: number; unit: string; runsOutAt?: number; orderBy?: number }[];
  waterMl: number; syringes: number; swabs: number;
  /** The earliest "order by" across the stack, with the delivery days used (learned, or the default). */
  orderBy?: number; leadDays: number; learned: boolean;
}

/** Days from order to arrival: the median of finished orders (2+), else the default. */
export function learnedLeadDays(orders: { placedAt: string; arrivedAt?: string }[], fallback = 7): { days: number; learned: boolean } {
  const ds = orders.filter((o) => o.arrivedAt).map((o) => (Date.parse(o.arrivedAt!) - Date.parse(o.placedAt)) / DAY).filter((x) => x > 0 && x < 60);
  return ds.length >= 2 ? { days: Math.ceil(median(ds)), learned: true } : { days: fallback, learned: false };
}

/** Everything the stack needs over the next 6 weeks (or each course's rest): vials per peptide, and the water,
 *  syringes and swabs in all, with when each peptide runs out and the date to order by. */
export function stackShop(meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings, orders: { placedAt: string; arrivedAt?: string }[] = []): StackShop | null {
  const lead = learnedLeadDays(orders);
  const items: StackShop['items'] = [];
  let water = 0, syringes = 0, swabs = 0;
  for (const m of peptides(meds)) {
    const c = courseShop(m, doses, now, s);
    if (!c) continue;
    const leadM = lead.learned ? lead.days : m.peptide?.leadTimeDays ?? lead.days;
    items.push({ med: m, name: shownName(m), vials: c.vials, vialSize: c.vialSize, unit: m.unit, runsOutAt: c.runsOutAt, orderBy: c.runsOutAt !== undefined ? c.runsOutAt - leadM * DAY : undefined });
    water += c.waterMl ?? 0; syringes += c.syringes; swabs += c.swabs;
  }
  if (!items.length) return null;
  const by = items.map((x) => x.orderBy).filter((x): x is number => x !== undefined);
  return { weeks: 4, items, waterMl: r(water, 1), syringes, swabs, orderBy: by.length ? Math.min(...by) : undefined, leadDays: lead.days, learned: lead.learned };
}

// ── 11. Out of the fridge ─────────────────────────────────────────────────────────────────────────────

/** The vial in use: how often and how long it has been out of the fridge. */
export function fridgeNote(v: PeptideVial | undefined): string | undefined {
  const ex = v?.excursions ?? [];
  if (!ex.length) return undefined;
  const h = ex.reduce((a, x) => a + x.hours, 0);
  return `Out of the fridge ${ex.length === 1 ? 'once' : `${ex.length} times`}, ${r(h, 1)} hour${h === 1 ? '' : 's'} in all`;
}

// ── Today's plan: what the stack needs today ──────────────────────────────────────────────────────────

export interface StackItem { key: string; title: string; detail: string; tone: 'watch' | 'info'; href: string; impact: number }

/** Things the stack needs from you today: a vial at a new strength to confirm, a vial used up or near its use-by date,
 *  an order to place, a course ending or ended with its summary. */
export function stackPlanItems(meds: Medication[], d: { doses: Dose[]; checkIns: CheckIn[]; daily: DailyHealth[]; body: BodyEntry[] }, now: number, s: ScheduleSettings, orders: { placedAt: string; arrivedAt?: string }[] = []): StackItem[] {
  const out: StackItem[] = [];
  for (const m of peptides(meds)) {
    const name = shownName(m);
    const sc = strengthChange(m);
    if (sc && !sc.checked) out.push({ key: `strength:${sc.vial.id}`, tone: 'watch', impact: 95, href: `#/meds/${m.id}/stock`,
      title: `${name}: this vial draws ${sc.unitsNow} units, not ${sc.unitsWas}`,
      detail: `It's mixed to ${sc.now} ${m.unit}/mL (the last was ${sc.was}). Same dose, different units.` });
    const cur = currentVial(m);
    if (cur?.startedAt && m.peptide?.useWithinDays) {
      const useBy = Date.parse(cur.startedAt) + m.peptide.useWithinDays * DAY;
      const daysLeft = Math.ceil((useBy - now) / DAY);
      if (daysLeft >= 0 && daysLeft <= 3) out.push({ key: `useby:${cur.id}`, tone: 'info', impact: 62, href: `#/meds/${m.id}/stock`,
        title: `${name}: vial's use-within date ${daysLeft === 0 ? 'is today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}`,
        detail: stockVials(m).length ? `Next up: ${stockVials(m)[0].amount} ${m.unit}${stockVials(m)[0].lot ? `, lot ${stockVials(m)[0].lot}` : ''}.` : 'No unopened vials left.' });
    }
    const cs = courseSummary(m, d, now, s);
    if (cs?.ended && now - new Date(`${cs.lastDay}T12:00`).getTime() < 7 * DAY) out.push({ key: `course:${m.id}:${cs.lastDay}`, tone: 'info', impact: 58, href: `#/meds/${m.id}/plan`,
      title: `${name}: course done`, detail: courseLine(cs) });
  }
  const shop = stackShop(meds, d.doses, now, s, orders);
  if (shop?.orderBy !== undefined && shop.orderBy - now < 3 * DAY) {
    const due = shop.items.filter((x) => x.orderBy !== undefined && x.orderBy - now < 3 * DAY).map((x) => x.name);
    out.push({ key: `order:${dayKey(now, s)}`, tone: shop.orderBy < now ? 'watch' : 'info', impact: 72, href: '#/meds',
      title: shop.orderBy < now ? `Order now: ${due.join(', ')}` : `Order ${due.join(', ')} by ${new Date(shop.orderBy).toLocaleDateString('en-AU', { weekday: 'long' })}`,
      detail: `Delivery usually takes ${shop.leadDays} days${shop.learned ? ' (from your orders)' : ''}.` });
  }
  return out;
}

export function courseLine(cs: CourseSummary): string {
  const f = (v: number) => (cs.unit === 'kg a week' ? `${v > 0 ? '+' : ''}${v} kg a week` : `${v} ${cs.unit}`);
  if (cs.before !== undefined && cs.during !== undefined) return `${cs.label}: ${f(cs.before)} before, ${f(cs.during)} by the end${cs.after !== undefined ? `, ${f(cs.after)} since` : ''}.`;
  return `${cs.label}: ${f((cs.during ?? cs.before)!)} ${cs.during !== undefined ? 'by the end' : 'before'}${cs.after !== undefined ? `, ${f(cs.after)} since` : ''}.`;
}
