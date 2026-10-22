// Predictions for peptides (peptide tools): where weight is heading through the plan, what the coming week is likely to
// feel like, how the vial in use will finish, what's needed by a date, patterns across weeks, changes worth a look, what
// late or missed shots did, which shot day fits the person's week, and a weekly summary.
// Pure (`now` and settings passed in) and from the person's own records only. Every result says how much data it rests
// on. Nothing here suggests a dose: plans are the person's own, from their prescriber.
import type { BodyEntry, CheckIn, Dose, Medication, Supply } from '../db/schema';
import { getDayBounds, getSlots, isScheduledDay, plannedAmounts, timeInDay, weekdayOf, type ScheduleSettings } from './schedule';
import { medOn, type Forecast } from './plans';
import { estimatedLevel, SIDE_EFFECT_CHIPS, vialsOf, vialStatus } from './peptide';
import { dayKey, ymdToMs } from './stats';
import { robustFit, seriesOf, type Pt } from './forecast';
import { dayStartOffset, plannedDoses, plannedInjections, stepReport, stockPlan } from './protocol';
import { stockUnitsFor } from './stock';
import { supplyCount } from './peptide';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const r = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const live = (c: CheckIn) => !c.deletedAt;
const tk = (d: Dose) => !d.deletedAt && !d.skipped;
/** Check-in chips counted as side effects. */
export const EFFECT_CHIPS = [...SIDE_EFFECT_CHIPS, 'Headache'];
const hasEffect = (c: CheckIn) => c.chips.some((x) => EFFECT_CHIPS.includes(x));
const sameDose = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** How much data a result rests on, for "Based on …" lines. */
export interface Basis { checkIns?: number; shots?: number; weeks?: number; weighIns?: number; note?: string }

/** Shots of one medication, oldest first. */
const shotsOf = (med: Medication, doses: Dose[]) =>
  doses.filter((d) => d.medicationId === med.id && tk(d)).map((d) => ({ t: Date.parse(d.takenAt), amount: d.amount })).sort((a, b) => a.t - b.t);

/** Typical days between shots (median). Day-after-shot patterns only make sense for shots 2.5+ days apart. */
function gapDays(shots: { t: number }[]): number | undefined {
  if (shots.length < 2) return undefined;
  const gaps = shots.slice(1).map((s, i) => (s.t - shots[i].t) / DAY).sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

// ── Day after the shot ─────────────────────────────────────────────────────────────────────────────

export interface OffsetStats { day: number; n: number; appetite?: number; effectPct: number; chips: { chip: string; n: number; pct: number }[] }
export interface ShotProfile { days: OffsetStats[]; checkIns: number; shots: number; gap: number; amount?: number }

/** Days after a shot (day 0 = shot day), optionally only after shots of `amount`. Each day after each shot counts once:
 *  a side effect counts for that day if any check-in that day noted it (so several check-ins a day don't dilute it), and
 *  appetite is the day's average. `checkIns` on the result is how many check-ins it rests on. */
export function shotProfile(med: Medication, doses: Dose[], checkIns: CheckIn[], amount?: number): ShotProfile | null {
  const shots = shotsOf(med, doses);
  const gap = gapDays(shots);
  if (gap === undefined || gap < 2.5) return null;
  const span = Math.min(7, Math.round(gap));
  // (shot, day after) → that day's check-ins
  const days = new Map<string, { day: number; cis: CheckIn[] }>();
  const usedShots = new Set<number>();
  let total = 0;
  for (const c of checkIns.filter(live)) {
    const t = Date.parse(c.at);
    const before = shots.filter((s) => s.t <= t).pop();
    if (!before || (amount !== undefined && !sameDose(before.amount, amount))) continue;
    const day = Math.floor((t - before.t) / DAY);
    if (day >= span) continue;
    const k = `${before.t}|${day}`;
    const e = days.get(k) ?? { day, cis: [] };
    e.cis.push(c);
    days.set(k, e);
    usedShots.add(before.t);
    total++;
  }
  if (!total) return null;
  const groups = Array.from({ length: span }, (_, day) => [...days.values()].filter((x) => x.day === day));
  return {
    gap: span, checkIns: total, shots: usedShots.size, amount,
    days: groups.map((g, day) => {
      const apps = g.map((x) => avg(x.cis.map((c) => c.appetite).filter((v): v is number => typeof v === 'number'))).filter((v): v is number => v !== undefined);
      const counts = new Map<string, number>();
      for (const x of g) for (const chip of new Set(x.cis.flatMap((c) => c.chips.filter((ch) => EFFECT_CHIPS.includes(ch))))) counts.set(chip, (counts.get(chip) ?? 0) + 1);
      return {
        day, n: g.length, appetite: apps.length ? r(avg(apps)!, 1) : undefined,
        effectPct: g.length ? Math.round((g.filter((x) => x.cis.some(hasEffect)).length / g.length) * 100) : 0,
        chips: [...counts].map(([chip, n]) => ({ chip, n, pct: Math.round((n / g.length) * 100) })).sort((a, b) => b.n - a.n),
      };
    }),
  };
}

/** The profile for a dose amount if there's enough at it, else across all doses. */
function profileFor(med: Medication, doses: Dose[], checkIns: CheckIn[], amount: number, min = 6): ShotProfile | null {
  const at = shotProfile(med, doses, checkIns, amount);
  if (at && at.checkIns >= min) return at;
  const all = shotProfile(med, doses, checkIns);
  return all && all.checkIns >= min ? all : null;
}

export interface EffectDay { start: number; day: number; amount: number; likely: { chip: string; pct: number }[]; effectPct: number; known: boolean }
export interface EffectForecast { days: EffectDay[]; basis: Basis; atThisDose: boolean }

/** The next 7 days: for each, days since the shot before it (taken or planned) and what usually shows up that day.
 *  A side effect is "likely" when it was noted in at least 40% of check-ins on that day after a shot (2 or more). */
export function sideEffectForecast(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): EffectForecast | null {
  const past = shotsOf(med, doses).filter((x) => x.t <= now);
  const future = plannedDoses(med, doses, now, now + 8 * DAY, s);
  const shots = [...past, ...future.map((p) => ({ t: p.t, amount: p.amount }))];
  const last = past[past.length - 1];
  const base = profileFor(med, doses, checkIns, last?.amount ?? med.defaultAmount);
  if (!base) return null;
  const days: EffectDay[] = [];
  for (let i = 0; i < 7; i++) {
    const start = dayStartOffset(now, i, s);
    const mid = start + 12 * HOUR;
    const shot = shots.filter((x) => x.t <= getDayBounds(start, s.dayStartsAt, s.tz).end - 1).pop();
    if (!shot) continue;
    const dayIdx = Math.min(Math.floor((Math.max(mid, shot.t) - shot.t) / DAY), 6);
    const p = sameDose(shot.amount, base.amount ?? shot.amount) ? base : (profileFor(med, doses, checkIns, shot.amount) ?? base);
    const st = p.days[dayIdx];
    days.push({
      start, day: dayIdx, amount: shot.amount, known: !!st && st.n >= 2,
      effectPct: st?.effectPct ?? 0,
      likely: st && st.n >= 2 ? st.chips.filter((c) => c.pct >= 40 && c.n >= 2).map(({ chip, pct }) => ({ chip, pct })) : [],
    });
  }
  return { days, basis: { checkIns: base.checkIns, shots: base.shots }, atThisDose: base.amount !== undefined };
}

export interface AppetiteCurve { days: { day: number; appetite?: number; n: number }[]; today?: number; todayAppetite?: number; basis: Basis; atThisDose: boolean }

/** Average appetite (1–5) on each day after a shot on the current step, and where today falls. */
export function appetiteCurve(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number): AppetiteCurve | null {
  const past = shotsOf(med, doses).filter((x) => x.t <= now);
  const last = past[past.length - 1];
  if (!last) return null;
  const withApp = checkIns.filter((c) => live(c) && typeof c.appetite === 'number');
  const p = profileFor(med, doses, withApp, last.amount, 5);
  if (!p || p.days.filter((d) => d.appetite !== undefined).length < 3) return null;
  const today = Math.floor((now - last.t) / DAY);
  const days = p.days.map((d) => ({ day: d.day, appetite: d.appetite, n: d.n }));
  return { days, today: today < p.gap ? today : undefined, todayAppetite: today < p.gap ? days[today]?.appetite : undefined, basis: { checkIns: p.checkIns, shots: p.shots }, atThisDose: p.amount !== undefined };
}

// ── Weight path through the plan ───────────────────────────────────────────────────────────────────

export interface PathPoint { t: number; v: number; low: number; high: number }
export interface PathSegment { from: number; to: number; amount: number; perWeek: number; basis: 'this-dose' | 'current' }
export interface WeightPath {
  points: PathPoint[]; segments: PathSegment[];
  level: number; perWeek: number;
  /** When the path (and its range) reaches the goal, if one is set and it's within the horizon. */
  goal?: { target: number; eta?: number; early?: number; late?: number };
  basis: Basis;
}

/** Where weight is heading for the next `weeks` weeks, following the plan's dose changes. Each step uses the person's
 *  own rate on that dose when they've been on it before (4+ weigh-ins over 10+ days), else their current rate. */
export function weightPath(med: Medication, doses: Dose[], body: BodyEntry[], now: number, weeks = 12, goalTarget?: number): WeightPath | null {
  const pts = seriesOf(body, 'weightKg').filter((p) => p.t <= now + DAY / 2);
  let recent: Pt[] = [];
  for (const w of [4, 6]) { recent = pts.filter((p) => p.t > now - w * WEEK); if (recent.length >= 5 && (recent[recent.length - 1].t - recent[0].t) / DAY >= 7) break; }
  const fit = robustFit(recent, now);
  if (!fit || fit.n < 5 || fit.spanDays < 7) return null;
  // The person's own rate at each dose they've had.
  const steps = stepReport(med, doses, [], [], now);
  const rateAt = new Map<number, { slope: number; low: number; high: number }>();
  for (const st of steps) {
    const inStep = pts.filter((p) => p.t >= st.from && p.t <= st.to);
    const f = inStep.length >= 4 && (inStep[inStep.length - 1].t - inStep[0].t) / DAY >= 10 ? robustFit(inStep, st.to) : undefined;
    if (f) rateAt.set(r(st.dose, 4), { slope: f.slope, low: f.slopeLow, high: f.slopeHigh });
  }
  const current = { slope: fit.slope, low: Math.min(fit.slopeLow, fit.slopeHigh), high: Math.max(fit.slopeLow, fit.slopeHigh) };
  const end = now + weeks * WEEK;
  // Dose timeline: today's dose, then each planned change.
  const changes = (med.plannedChanges ?? []).map((c) => ({ t: ymdToMs(c.from), amount: c.defaultAmount })).filter((c) => c.t > now && c.t < end).sort((a, b) => a.t - b.t);
  const lastShot = shotsOf(med, doses).filter((x) => x.t <= now).pop();
  const bounds = [{ t: now, amount: lastShot?.amount ?? med.defaultAmount }, ...changes];
  const segments: PathSegment[] = bounds.map((b, i) => {
    const own = rateAt.get(r(b.amount, 4));
    // The current step uses the current rate (most recent); a later step uses the person's own rate on that dose.
    const useOwn = i > 0 && own;
    const rate = useOwn ? own : current;
    return { from: b.t, to: bounds[i + 1]?.t ?? end, amount: b.amount, perWeek: r(rate.slope * 7), basis: useOwn ? 'this-dose' : 'current', rate } as PathSegment & { rate: typeof current };
  });
  const points: PathPoint[] = [];
  let v = fit.level, lo = fit.level, hi = fit.level, t = now;
  points.push({ t, v: r(v), low: r(lo), high: r(hi) });
  for (let i = 1; i <= weeks; i++) {
    const to = now + i * WEEK;
    for (const seg of segments as (PathSegment & { rate: typeof current })[]) {
      const a = Math.max(t, seg.from), b = Math.min(to, seg.to);
      if (b <= a) continue;
      const days = (b - a) / DAY;
      v += seg.rate.slope * days; lo += seg.rate.low * days; hi += seg.rate.high * days;
    }
    t = to;
    points.push({ t, v: r(v), low: r(Math.min(lo, hi)), high: r(Math.max(lo, hi)) });
  }
  for (const seg of segments as (PathSegment & { rate?: unknown })[]) delete seg.rate;
  let goal: WeightPath['goal'];
  if (goalTarget !== undefined) {
    const dir = Math.sign(goalTarget - fit.level) || -1;
    const cross = (key: 'v' | 'low' | 'high') => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1][key], b = points[i][key];
        if ((goalTarget - a) * dir > 0 && (b - goalTarget) * dir >= 0) return points[i - 1].t + ((goalTarget - a) / (b - a)) * (points[i].t - points[i - 1].t);
      }
      return undefined;
    };
    goal = { target: goalTarget, eta: cross('v'), early: cross(dir < 0 ? 'low' : 'high'), late: cross(dir < 0 ? 'high' : 'low') };
  }
  return { points, segments, level: r(fit.level), perWeek: r(fit.slope * 7), goal, basis: { weighIns: fit.n, weeks: r(fit.spanDays / 7, 1) } };
}

// ── Rest of the vial ───────────────────────────────────────────────────────────────────────────────

export interface VialRest {
  /** Full doses the plan takes from it, the last one's time, and why it stops. */
  doses: number; lastFullAt?: number;
  ends: 'empty' | 'use-by' | 'no-plan';
  /** Left in it when it stops: not enough for the next dose (empty) or past its use-by. */
  leftover: number;
  useBy?: number;
  /** The next planned dose after it stops (from a new vial). */
  nextAt?: number; nextAmount?: number;
}

/** How the vial or pen in use finishes, following the plan: which shot is its last full one, and what's left over. */
export function vialRest(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): VialRest | null {
  const vs = vialStatus(med, doses, now);
  if (!vs) return null;
  let left = vs.left;
  let n = 0;
  let lastFullAt: number | undefined;
  const plan = plannedDoses(med, doses, now, now + 200 * DAY, s);
  for (const p of plan) {
    if (vs.useBy !== undefined && p.t > vs.useBy) return { doses: n, lastFullAt, ends: 'use-by', leftover: r(left, 4), useBy: vs.useBy, nextAt: p.t, nextAmount: p.amount };
    if (left + 1e-9 < p.amount) return { doses: n, lastFullAt, ends: 'empty', leftover: r(left, 4), useBy: vs.useBy, nextAt: p.t, nextAmount: p.amount };
    left -= p.amount; n++; lastFullAt = p.t;
  }
  return { doses: n, lastFullAt, ends: 'no-plan', leftover: r(left, 4), useBy: vs.useBy };
}

// ── What's needed by a date ────────────────────────────────────────────────────────────────────────

export interface NeedRow { have: number; need: number; short: number }
export interface ByDate {
  meds: (NeedRow & { med: Medication; basis: 'plan' | 'recent-use'; vialUseBy?: number })[];
  supplies: (NeedRow & { supply: Supply })[];
}

/** Stock and supplies needed from now until `until` (e.g. the end of a trip), against what's on hand. Medicines with a
 *  plan follow it (planned changes included); as-needed ones use the last 30 days' average. */
export function needsByDate(meds: Medication[], supplies: Supply[], doses: Dose[], now: number, until: number, s: ScheduleSettings): ByDate {
  const days = Math.max(1, Math.ceil((until - now) / DAY));
  const out: ByDate = { meds: [], supplies: [] };
  for (const med of meds.filter((m) => !m.archived && typeof m.stockCount === 'number')) {
    let need = 0;
    let basis: 'plan' | 'recent-use' = 'plan';
    if (med.schedule.type === 'prn' || med.shared) {
      basis = 'recent-use';
      const since = now - 30 * DAY;
      const recent = doses.filter((d) => d.medicationId === med.id && tk(d) && Date.parse(d.takenAt) >= since && Date.parse(d.takenAt) <= now);
      need = (recent.reduce((t, d) => t + stockUnitsFor(med, d.amount), 0) / 30) * days;
    } else {
      need = plannedDoses(med, doses, now, until, s).reduce((t, p) => t + stockUnitsFor(med, p.amount), 0);
    }
    const have = med.stockCount!;
    const vs = med.peptide ? vialStatus(med, doses, now) : undefined;
    out.meds.push({ med, have: r(have, 2), need: r(need, 2), short: r(Math.max(0, need - have), 2), basis, vialUseBy: vs?.useBy && vs.useBy < until ? vs.useBy : undefined });
  }
  const plan = plannedInjections(meds, doses, now, s, days);
  for (const supply of supplies.filter((x) => !x.deletedAt)) {
    const have = supplyCount(supply, meds, doses);
    let need = 0;
    for (const day of plan) {
      if (day.start >= until) break;
      for (const { med, amounts } of day.byMed) {
        const pen = med.peptide?.kind === 'pen';
        if (supply.kind === 'water') { if (!pen && med.strength > 0) need += amounts.reduce((a, b) => a + b, 0) / med.strength * (med.peptide?.waterMl ?? 0); }
        else if (supply.kind === 'swabs' || supply.kind === 'sharps' || (supply.kind === 'syringes' ? !pen : pen)) need += amounts.length;
      }
    }
    const room = supply.kind === 'sharps' ? (supply.capacity ?? Infinity) - have : have;
    out.supplies.push({ supply, have: r(have, 2), need: r(need, 2), short: r(Math.max(0, need - room), 2) });
  }
  return out;
}

// ── Weeks: what goes with the good ones ────────────────────────────────────────────────────────────

export interface WeekRec {
  start: number;
  shots: number; planned: number; missed: boolean;
  shotHour?: number; lot?: string; waterMl?: number; sleepHours?: number;
  checkIns: number; effectPct?: number; appetite?: number;
}

/** The last `weeks` full weeks (Monday to Sunday) for one peptide: what was done and what was recorded. */
export function weekRecords(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings, weeks = 16): WeekRec[] {
  const today = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const back = (weekdayOf(today, s) + 6) % 7;
  const vials = vialsOf(med);
  const mine = doses.filter((d) => d.medicationId === med.id && !d.deletedAt);
  const first = mine.reduce((m, d) => Math.min(m, Date.parse(d.takenAt)), Infinity);
  const out: WeekRec[] = [];
  for (let w = weeks; w >= 1; w--) {
    const start = dayStartOffset(now, -back - 7 * w, s);
    const end = dayStartOffset(now, -back - 7 * (w - 1), s);
    if (end <= first) continue; // before the first shot
    let planned = 0;
    const from = Math.max(start, getDayBounds(first, s.dayStartsAt, s.tz).start);
    for (let i = 0; i < 7; i++) {
      const ds = dayStartOffset(start + 12 * HOUR, i, s);
      if (ds < from) continue;
      const m = medOn(med, dayKey(ds, s));
      if (m.schedule.type !== 'prn') planned += plannedAmounts(m, ds, s).length || (isScheduledDay(m, ds, s) ? 1 : 0);
    }
    const shots = mine.filter((d) => !d.skipped && Date.parse(d.takenAt) >= start && Date.parse(d.takenAt) < end);
    if (!shots.length && !planned) continue;
    const hours = shots.map((d) => { const dt = new Date(d.takenAt); return Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: s.tz }).format(dt)); });
    const vialOf = (d: Dose) => (d.vialId ? vials.find((v) => v.id === d.vialId) : vials.find((v) => v.startedAt && Date.parse(v.startedAt) <= Date.parse(d.takenAt) && (!v.finishedAt || Date.parse(v.finishedAt) > Date.parse(d.takenAt))));
    const vs = shots.map(vialOf).filter(Boolean);
    const cis = checkIns.filter((c) => live(c) && Date.parse(c.at) >= start && Date.parse(c.at) < end);
    const sleep = cis.map((c) => c.sleepHours).filter((x): x is number => typeof x === 'number');
    const app = cis.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
    out.push({
      start, shots: shots.length, planned, missed: shots.length < planned,
      shotHour: hours.length ? avg(hours) : undefined, lot: vs[vs.length - 1]?.lot, waterMl: vs[vs.length - 1]?.waterMl,
      sleepHours: sleep.length ? r(avg(sleep)!, 1) : undefined,
      checkIns: cis.length, effectPct: cis.length ? Math.round((cis.filter(hasEffect).length / cis.length) * 100) : undefined,
      appetite: app.length ? r(avg(app)!, 1) : undefined,
    });
  }
  return out;
}

export interface GroupStats { label: string; weeks: number; effectPct?: number; appetite?: number }
export interface WeekFinding { factor: 'time' | 'sleep' | 'lot' | 'water' | 'missed'; title: string; a: GroupStats; b: GroupStats; effectDiff?: number; appetiteDiff?: number }

function group(label: string, ws: WeekRec[]): GroupStats {
  const e = ws.map((w) => w.effectPct).filter((x): x is number => x !== undefined);
  const a = ws.map((w) => w.appetite).filter((x): x is number => x !== undefined);
  return { label, weeks: ws.length, effectPct: e.length ? Math.round(avg(e)!) : undefined, appetite: a.length ? r(avg(a)!, 1) : undefined };
}

/** Compares weeks by shot time, sleep, batch, water amount and missed shots, on side effects and appetite. Only weeks
 *  with 2+ check-ins count, each side needs 2+ weeks, and only clear differences are reported (20+ points of
 *  check-ins with side effects, or 0.6+ on appetite). A link in the person's records, not a cause. */
export function weekFindings(recs: WeekRec[]): WeekFinding[] {
  const ws = recs.filter((w) => w.checkIns >= 2);
  const out: WeekFinding[] = [];
  const consider = (factor: WeekFinding['factor'], title: string, a: WeekRec[], la: string, b: WeekRec[], lb: string) => {
    if (a.length < 2 || b.length < 2) return;
    const ga = group(la, a), gb = group(lb, b);
    const effectDiff = ga.effectPct !== undefined && gb.effectPct !== undefined ? ga.effectPct - gb.effectPct : undefined;
    const appetiteDiff = ga.appetite !== undefined && gb.appetite !== undefined ? r(ga.appetite - gb.appetite, 1) : undefined;
    if ((effectDiff !== undefined && Math.abs(effectDiff) >= 20) || (appetiteDiff !== undefined && Math.abs(appetiteDiff) >= 0.6)) {
      out.push({ factor, title, a: ga, b: gb, effectDiff, appetiteDiff });
    }
  };
  const timed = ws.filter((w) => w.shotHour !== undefined);
  consider('time', 'Shot time', timed.filter((w) => w.shotHour! < 12), 'Morning shots', timed.filter((w) => w.shotHour! >= 12), 'Afternoon or evening shots');
  const slept = ws.filter((w) => w.sleepHours !== undefined);
  consider('sleep', 'Sleep', slept.filter((w) => w.sleepHours! >= 7), '7+ hours sleep', slept.filter((w) => w.sleepHours! < 7), 'Under 7 hours');
  const top = (key: 'lot' | 'waterMl') => {
    const counts = new Map<string | number, number>();
    for (const w of ws) if (w[key] !== undefined) counts.set(w[key]!, (counts.get(w[key]!) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  };
  const lots = top('lot');
  if (lots.length === 2) consider('lot', 'Batch', ws.filter((w) => w.lot === lots[0]), `Batch ${lots[0]}`, ws.filter((w) => w.lot === lots[1]), `Batch ${lots[1]}`);
  const waters = top('waterMl');
  if (waters.length === 2) consider('water', 'Water in the vial', ws.filter((w) => w.waterMl === waters[0]), `${waters[0]} mL`, ws.filter((w) => w.waterMl === waters[1]), `${waters[1]} mL`);
  consider('missed', 'Missed shots', ws.filter((w) => !w.missed), 'All shots taken', ws.filter((w) => w.missed), 'A shot missed');
  return out;
}

// ── Changes worth a look ───────────────────────────────────────────────────────────────────────────

export interface ChangeFlag { kind: 'lot-effects' | 'weight-flat' | 'sleep-after-step'; title: string; detail: string; basis: Basis }

/** Shifts beyond the person's usual range: side effects up on the batch in use, weight trend flattening, sleep down
 *  since the last step up. Each says what it's based on. */
export function changeFlags(med: Medication, doses: Dose[], checkIns: CheckIn[], body: BodyEntry[], now: number): ChangeFlag[] {
  const flags: ChangeFlag[] = [];
  const cis = checkIns.filter(live);
  // Side effects on the batch in use vs earlier batches.
  const vials = vialsOf(med).filter((v) => v.startedAt);
  const cur = vials.filter((v) => v.status === 'in-use').sort((a, b) => b.startedAt!.localeCompare(a.startedAt!))[0];
  if (cur?.lot) {
    const inRange = (v: typeof cur, t: number) => t >= Date.parse(v.startedAt!) && t < (v.finishedAt ? Date.parse(v.finishedAt) : now + 1);
    const onCur = cis.filter((c) => vials.some((v) => v.lot === cur.lot && inRange(v, Date.parse(c.at))));
    const before = cis.filter((c) => vials.some((v) => v.lot && v.lot !== cur.lot && inRange(v, Date.parse(c.at))));
    if (onCur.length >= 4 && before.length >= 4) {
      const a = Math.round((onCur.filter(hasEffect).length / onCur.length) * 100);
      const b = Math.round((before.filter(hasEffect).length / before.length) * 100);
      if (a - b >= 25) flags.push({ kind: 'lot-effects', title: `More side effects on batch ${cur.lot}`, detail: `Side effects in ${a}% of check-ins on this batch, ${b}% on earlier ones.`, basis: { checkIns: onCur.length + before.length } });
    }
  }
  // Weight trend flattening: the last 3 weeks against the 3 before.
  const pts = seriesOf(body, 'weightKg');
  const fitIn = (from: number, to: number) => { const w = pts.filter((p) => p.t > from && p.t <= to); return w.length >= 3 ? robustFit(w, to) : undefined; };
  const prev = fitIn(now - 6 * WEEK, now - 3 * WEEK), last = fitIn(now - 3 * WEEK, now);
  if (prev && last && prev.slope * 7 <= -0.2 && last.slope > prev.slope * 0.3) {
    flags.push({ kind: 'weight-flat', title: 'Weight trend flattening', detail: `${r(prev.slope * 7, 1)} kg a week over the 3 weeks before, ${r(last.slope * 7, 1)} kg a week over the last 3.`, basis: { weighIns: prev.n + last.n, weeks: 6 } });
  }
  // Sleep since the last step up (within 6 weeks) against the 3 weeks before it.
  const shots = shotsOf(med, doses);
  let stepAt: number | undefined;
  for (let i = shots.length - 1; i > 0; i--) if (shots[i].amount > shots[i - 1].amount + 1e-9) { stepAt = shots[i].t; break; }
  if (stepAt !== undefined && now - stepAt <= 6 * WEEK) {
    const sleep = (from: number, to: number) => cis.filter((c) => Date.parse(c.at) >= from && Date.parse(c.at) < to);
    const after = sleep(stepAt, now + 1), before = sleep(stepAt - 3 * WEEK, stepAt);
    const hrs = (xs: CheckIn[]) => xs.map((c) => c.sleepHours).filter((x): x is number => typeof x === 'number');
    const q = (xs: CheckIn[]) => xs.map((c) => c.sleepQuality).filter((x): x is number => typeof x === 'number');
    const ha = hrs(after), hb = hrs(before), qa = q(after), qb = q(before);
    if (ha.length >= 4 && hb.length >= 4 && avg(hb)! - avg(ha)! >= 0.7) {
      flags.push({ kind: 'sleep-after-step', title: 'Less sleep since the dose went up', detail: `About ${r(avg(ha)!, 1)} hours a night since, ${r(avg(hb)!, 1)} in the 3 weeks before.`, basis: { checkIns: ha.length + hb.length } });
    } else if (qa.length >= 4 && qb.length >= 4 && avg(qb)! - avg(qa)! >= 0.7) {
      flags.push({ kind: 'sleep-after-step', title: 'Sleep quality down since the dose went up', detail: `Sleep rated ${r(avg(qa)!, 1)} out of 5 since, ${r(avg(qb)!, 1)} in the 3 weeks before.`, basis: { checkIns: qa.length + qb.length } });
    }
  }
  return flags;
}

// ── Late and missed shots ──────────────────────────────────────────────────────────────────────────

export interface LateShot {
  plannedAt: number; takenAt?: number; hoursLate?: number; missed: boolean;
  /** How much lower the estimated level averaged until the next shot, against taking it on time (needs a half-life). */
  levelDropPct?: number;
  /** Check-ins in the 3 days after, against all others. */
  after?: { n: number; appetite?: number; effectPct?: number };
}
export interface LateReport { events: LateShot[]; usual?: { appetite?: number; effectPct?: number }; basis: Basis }

/** Shots 12+ hours late or missed over the last `weeks` weeks (set times only), with what followed. */
export function lateShots(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings, weeks = 12): LateReport | null {
  if (med.schedule.type !== 'fixed') return null;
  const shots = shotsOf(med, doses).filter((x) => x.t > now - (weeks + 1) * WEEK);
  const skips = doses.filter((d) => d.medicationId === med.id && !d.deletedAt && d.skipped).map((d) => Date.parse(d.takenAt));
  const slots: { t: number; amount: number }[] = [];
  // Only since the first shot ever logged (days before someone started aren't missed).
  const first = doses.filter((d) => d.medicationId === med.id && !d.deletedAt).reduce((m, d) => Math.min(m, Date.parse(d.takenAt)), Infinity);
  if (first === Infinity) return null;
  for (let i = -weeks * 7; i <= 0; i++) {
    const start = dayStartOffset(now, i, s);
    if (getDayBounds(start, s.dayStartsAt, s.tz).end <= first) continue;
    const m = medOn(med, dayKey(start, s));
    if (m.schedule.type !== 'fixed' || !isScheduledDay(m, start, s)) continue;
    for (const sl of getSlots(m)) { const t = timeInDay(start, sl.time, s); if (t < now - 2 * HOUR) slots.push({ t, amount: sl.amount ?? m.defaultAmount }); }
  }
  if (!slots.length) return null;
  const gap = Math.min(3 * DAY, slots.length > 1 ? (slots[slots.length - 1].t - slots[0].t) / (slots.length - 1) / 2 : 3 * DAY);
  const used = new Set<number>();
  const h = med.peptide?.halfLifeHours;
  const cis = checkIns.filter(live);
  const events: LateShot[] = [];
  const windows: [number, number][] = [];
  slots.forEach((sl, i) => {
    if (skips.some((t) => Math.abs(t - sl.t) < gap)) return; // skipped on purpose
    const near = shots.filter((x) => !used.has(x.t) && x.t >= sl.t - gap && x.t < sl.t + gap).sort((a, b) => Math.abs(a.t - sl.t) - Math.abs(b.t - sl.t))[0];
    if (near) used.add(near.t);
    const hoursLate = near ? (near.t - sl.t) / HOUR : undefined;
    if (near && hoursLate! < 12) return;
    const ev: LateShot = { plannedAt: sl.t, takenAt: near?.t, hoursLate: hoursLate !== undefined ? r(hoursLate, 1) : undefined, missed: !near };
    const until = slots[i + 1]?.t ?? sl.t + 7 * DAY;
    if (h) {
      const base = doses.filter((d) => d.medicationId === med.id && tk(d) && Date.parse(d.takenAt) < sl.t - gap);
      const asDose = (t: number, a: number) => ({ id: 'x', medicationId: med.id, takenAt: new Date(t).toISOString(), amount: a, source: 'manual' as const, createdAt: '', updatedAt: '' });
      const actual = near ? [...base, asDose(near.t, near.amount)] : base;
      const onTime = [...base, asDose(sl.t, near?.amount ?? sl.amount)];
      const mean = (ds: Dose[]) => avg(estimatedLevel(ds, h, sl.t, until, 60).map((p) => p.v)) ?? 0;
      const a = mean(actual), b = mean(onTime);
      if (b > 0) ev.levelDropPct = Math.round((1 - a / b) * 100);
    }
    const from = near?.t ?? sl.t;
    const after = cis.filter((c) => Date.parse(c.at) >= from && Date.parse(c.at) < from + 3 * DAY);
    windows.push([from, from + 3 * DAY]);
    if (after.length) {
      const app = after.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
      ev.after = { n: after.length, appetite: app.length ? r(avg(app)!, 1) : undefined, effectPct: Math.round((after.filter(hasEffect).length / after.length) * 100) };
    }
    events.push(ev);
  });
  const rest = cis.filter((c) => !windows.some(([a, b]) => Date.parse(c.at) >= a && Date.parse(c.at) < b) && Date.parse(c.at) > now - (weeks + 1) * WEEK);
  const rapp = rest.map((c) => c.appetite).filter((x): x is number => typeof x === 'number');
  return {
    events: events.reverse(),
    usual: rest.length ? { appetite: rapp.length ? r(avg(rapp)!, 1) : undefined, effectPct: Math.round((rest.filter(hasEffect).length / rest.length) * 100) } : undefined,
    basis: { shots: slots.length, weeks, checkIns: cis.length },
  };
}

// ── Best shot day ──────────────────────────────────────────────────────────────────────────────────

export interface ShotDayOption { weekday: number; score: number; hardDays: number[] }
export interface ShotDayResult { current?: number; options: ShotDayOption[]; burden: number[]; basis: Basis }

/** For a once-a-week shot: how each shot day would line up the days that usually bring side effects with the days the
 *  person marked busy. Lower score = fewer busy days on harder days. Timing only; the dose is unchanged. */
export function bestShotDay(med: Medication, doses: Dose[], checkIns: CheckIn[], busy: number[]): ShotDayResult | null {
  const days = med.schedule.days;
  if (med.schedule.type !== 'fixed' || !days || days.length !== 1) return null;
  const p = shotProfile(med, doses, checkIns);
  if (!p || p.checkIns < 6) return null;
  const burden = Array.from({ length: 7 }, (_, k) => (p.days[k] && p.days[k].n >= 2 ? p.days[k].effectPct / 100 : 0));
  const options = Array.from({ length: 7 }, (_, w) => {
    const hardDays = busy.filter((b) => burden[(b - w + 7) % 7] >= 0.4);
    return { weekday: w, score: r(busy.reduce((t, b) => t + burden[(b - w + 7) % 7], 0), 2), hardDays };
  }).sort((a, b) => a.score - b.score || a.weekday - b.weekday);
  return { current: days[0], options, burden: burden.map((b) => Math.round(b * 100)), basis: { checkIns: p.checkIns, shots: p.shots } };
}

// ── Weekly summary ─────────────────────────────────────────────────────────────────────────────────

export interface WeeklySummary {
  from: number; to: number;
  shots: number; planned: number; onTime: number;
  level?: { min: number; max: number };
  weightPerWeek?: number; stepPerWeek?: number;
  effectPct?: number; effectPctBefore?: number; checkIns: number;
  stock?: { runOutAt: number | null; orderBy: number | null; forecast: Forecast | null };
}

/** The last 7 days for one peptide: shots on time, level range, weight rate against the step's average, side effects
 *  against the 3 weeks before, and stock. */
export function weeklySummary(med: Medication, doses: Dose[], checkIns: CheckIn[], body: BodyEntry[], now: number, s: ScheduleSettings): WeeklySummary {
  const from = dayStartOffset(now, -6, s);
  const to = now;
  let planned = 0;
  const slots: number[] = [];
  for (let i = -6; i <= 0; i++) {
    const start = dayStartOffset(now, i, s);
    const m = medOn(med, dayKey(start, s));
    if (m.schedule.type === 'prn' || !isScheduledDay(m, start, s)) continue;
    if (m.schedule.type === 'fixed') for (const sl of getSlots(m)) { const t = timeInDay(start, sl.time, s); if (t <= now) { planned++; slots.push(t); } }
    else planned += plannedAmounts(m, start, s).length;
  }
  const shots = shotsOf(med, doses).filter((x) => x.t >= from && x.t <= now);
  const onTime = slots.filter((t) => shots.some((x) => Math.abs(x.t - t) <= 2 * HOUR)).length + (med.schedule.type === 'fixed' ? 0 : Math.min(shots.length, planned));
  const h = med.peptide?.halfLifeHours;
  const lv = h ? estimatedLevel(doses.filter((d) => d.medicationId === med.id), h, from, to, 80).map((p) => p.v) : [];
  const pts = seriesOf(body, 'weightKg').filter((p) => p.t > now - 3 * WEEK && p.t <= now + DAY / 2);
  const fit = pts.length >= 3 ? robustFit(pts, now) : undefined;
  const steps = stepReport(med, doses, body, [], now);
  const cis = checkIns.filter(live);
  const wk = cis.filter((c) => Date.parse(c.at) >= from && Date.parse(c.at) <= now);
  const before = cis.filter((c) => Date.parse(c.at) >= from - 3 * WEEK && Date.parse(c.at) < from);
  const sp = med.stockCount !== undefined ? stockPlan(med, doses, now, s) : undefined;
  return {
    from, to, shots: shots.length, planned, onTime,
    level: lv.length ? { min: r(Math.min(...lv), 2), max: r(Math.max(...lv), 2) } : undefined,
    weightPerWeek: fit && fit.spanDays >= 7 ? r(fit.slope * 7) : undefined,
    stepPerWeek: steps[steps.length - 1]?.weightPerWeek,
    checkIns: wk.length,
    effectPct: wk.length ? Math.round((wk.filter(hasEffect).length / wk.length) * 100) : undefined,
    effectPctBefore: before.length ? Math.round((before.filter(hasEffect).length / before.length) * 100) : undefined,
    stock: sp ? { runOutAt: sp.forecast?.runOutAt ?? null, orderBy: sp.orderBy, forecast: sp.forecast } : undefined,
  };
}

/** "Based on 9 weeks and 23 check-ins" */
export function basisText(b: Basis): string {
  const parts: string[] = [];
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  if (b.weeks) parts.push(n(Math.round(b.weeks), 'week'));
  if (b.shots) parts.push(n(b.shots, 'shot'));
  if (b.weighIns) parts.push(n(b.weighIns, 'weigh-in'));
  if (b.checkIns) parts.push(n(b.checkIns, 'check-in'));
  return parts.length ? `Based on ${parts.join(', ')}${b.note ? `. ${b.note}` : ''}` : b.note ?? '';
}
