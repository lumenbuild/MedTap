// Goal forecasts for body measurements (weight, waist): where the trend is, how fast it's moving, and when it
// should reach the goal. Pure and on-device, from the person's own logs. It describes the trend; it doesn't
// recommend a pace.
//
// - Rate: Theil–Sen (the median of the slopes between every pair of days) over the last 4 weeks. One odd
//   weigh-in, or water weight after a salty meal, barely moves it.
// - Level: where that line is today (not the last weigh-in), so the forecast starts from the trend.
// - Range: the rate's uncertainty (from how much the logs scatter around the line) plus how much the rate
//   differed between the first and second half of the window, so the goal date comes as "likely between … and …".
// - The chart's trend line is the same kind of robust line, fitted to the 3 weeks before each day.
import type { BodyEntry, BodyGoal, GoalMetric } from '../db/schema';

export interface Pt { t: number; v: number }

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MAX_DAYS = 3 * 365;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** One point per day (the day's average), oldest first. Days are at local noon. */
export function seriesOf(entries: BodyEntry[], metric: GoalMetric): Pt[] {
  const byDay = new Map<string, number[]>();
  for (const e of entries) {
    // Lean mass: logged, or worked out from weight and body fat % on the same day.
    const v = metric === 'leanKg' && e.leanKg === undefined && typeof e.weightKg === 'number' && typeof e.bodyFatPct === 'number'
      ? Math.round(e.weightKg * (1 - e.bodyFatPct / 100) * 100) / 100 : e[metric];
    if (e.deletedAt || typeof v !== 'number') continue;
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), v]);
  }
  return [...byDay].map(([d, vs]) => ({ t: new Date(`${d}T12:00`).getTime(), v: vs.reduce((a, b) => a + b, 0) / vs.length }))
    .sort((a, b) => a.t - b.t);
}

export interface Fit {
  /** Change per day, and a likely range for it. */
  slope: number; slopeLow: number; slopeHigh: number;
  /** Where the line is at `at`. */
  level: number;
  n: number; spanDays: number;
}

interface Core { slope: number; level: number; se: number }

/** Theil–Sen slope and level at `at`, with the slope's standard error from the robust scatter around the line. */
function core(points: Pt[], at: number): Core | undefined {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = (points[j].t - points[i].t) / DAY;
      if (dt >= 1) slopes.push((points[j].v - points[i].v) / dt);
    }
  }
  if (!slopes.length) return undefined;
  const slope = median(slopes);
  const level = median(points.map((p) => p.v + slope * ((at - p.t) / DAY)));
  const sigma = 1.4826 * median(points.map((p) => Math.abs(p.v - (level - slope * ((at - p.t) / DAY)))));
  const days = points.map((p) => p.t / DAY);
  const mean = days.reduce((x, y) => x + y, 0) / days.length;
  const stt = days.reduce((x, d) => x + (d - mean) ** 2, 0);
  return { slope, level, se: stt > 0 ? sigma / Math.sqrt(stt) : 0 };
}

/** Theil–Sen line through the points, with its level at time `at`. Pairs less than a day apart are skipped.
 *  The likely range for the rate is its uncertainty from the scatter, plus any change in rate between the first
 *  and second half of the window that's bigger than the scatter alone would explain. */
export function robustFit(points: Pt[], at: number): Fit | undefined {
  if (points.length < 2) return undefined;
  const c = core(points, at);
  if (!c) return undefined;
  const mid = (points[0].t + points[points.length - 1].t) / 2;
  const h1 = points.length >= 8 ? core(points.filter((p) => p.t <= mid), at) : undefined;
  const h2 = points.length >= 8 ? core(points.filter((p) => p.t > mid), at) : undefined;
  const change = h1 && h2 ? Math.max(0, Math.abs(h2.slope - h1.slope) - 2 * Math.hypot(h1.se, h2.se)) / 2 : 0;
  const band = 1.5 * c.se + change;
  return {
    slope: c.slope, slopeLow: c.slope - band, slopeHigh: c.slope + band, level: c.level,
    n: points.length, spanDays: (points[points.length - 1].t - points[0].t) / DAY,
  };
}

/** The trend line for charts and milestones: at each log, a robust line through the previous 3 weeks, read at
 *  that day. Unlike a moving average it doesn't lag behind a steady loss. Early on (under 3 logs), the log itself. */
export function smoothTrend(points: Pt[], windowDays = 21): Pt[] {
  return points.map((p, i) => {
    const w = points.slice(0, i + 1).filter((q) => q.t > p.t - windowDays * DAY);
    const c = w.length >= 3 && (p.t - w[0].t) / DAY >= 3 ? core(w, p.t) : undefined;
    return { t: p.t, v: r(c ? c.level : p.v, 3) };
  });
}

/** The recent window: the last 4 weeks, widened to 6 if that's too few logs. */
function recent(points: Pt[], now: number): Pt[] {
  const past = points.filter((p) => p.t <= now + DAY / 2);
  for (const weeks of [4, 6]) {
    const w = past.filter((p) => p.t > now - weeks * WEEK);
    if (w.length >= 5 && (w[w.length - 1].t - w[0].t) / DAY >= 7) return w;
  }
  return past.filter((p) => p.t > now - 6 * WEEK);
}

export type ForecastStatus = 'need-data' | 'reached' | 'on-track' | 'behind' | 'flat' | 'away';

export interface Forecast {
  status: ForecastStatus;
  /** Trend level now, and change per week (negative = going down), with the likely range. */
  level?: number; perWeek?: number; perWeekLow?: number; perWeekHigh?: number;
  /** Still to go (signed, towards the target), and the share of the way from start to target done (0–1). */
  remaining?: number; done?: number;
  /** When the goal is likely reached, and the likely range (late is undefined if it could take much longer). */
  eta?: number; etaEarly?: number; etaLate?: number;
  /** With a target date: the pace needed from now (per week), and days the forecast is past it (negative = before). */
  neededPerWeek?: number; daysPastTarget?: number;
  /** The rate has slowed: per week over the previous fortnight and this one. */
  slowing?: { was: number; now: number };
  /** Reached: when the trend first got there, and how far it is from the target now (signed). */
  reachedAt?: number; drift?: number;
  /** Logs in the window and how many days they span (for "need more data"). */
  n: number; spanDays: number;
  /** Unrounded change per day (for milestone dates). */
  perDay?: number;
}

/** How close counts as "there": 0.3% of the target (0.24 kg at 80 kg), at least 0.2 units. */
const tolerance = (g: BodyGoal) => Math.max(0.2, Math.abs(g.target) * 0.003);

/** When the smoothed trend first reached the target (after the goal was set). */
function firstReached(points: Pt[], g: BodyGoal): number | undefined {
  const dir = Math.sign(g.target - g.start) || -1;
  const from = new Date(`${g.startDate}T00:00`).getTime();
  return smoothTrend(points).find((p) => p.t >= from && (p.v - g.target) * dir >= -tolerance(g))?.t;
}

export function forecast(points: Pt[], g: BodyGoal, now: number): Forecast {
  const w = recent(points, now);
  const fit = robustFit(w, now);
  const base = { n: w.length, spanDays: fit ? r(fit.spanDays, 1) : 0 };
  if (!fit || fit.n < 5 || fit.spanDays < 7) return { status: 'need-data', ...base };

  const dir = Math.sign(g.target - g.start) || -1; // -1 = going down (most goals)
  const level = fit.level;
  const remaining = g.target - level;
  const total = g.target - g.start;
  const done = total ? Math.max(0, Math.min(1, (level - g.start) / total)) : 1;
  const perWeek = fit.slope * 7;
  const out: Forecast = {
    status: 'on-track', ...base, level: r(level), perWeek: r(perWeek), perDay: fit.slope, remaining: r(remaining), done: r(done, 3),
    perWeekLow: r(Math.min(fit.slopeLow, fit.slopeHigh) * 7), perWeekHigh: r(Math.max(fit.slopeLow, fit.slopeHigh) * 7),
  };

  // Slowing: the last fortnight against the one before (only when moving the right way before).
  const half = (from: number, to: number) => robustFit(points.filter((p) => p.t > from && p.t <= to), to);
  const a = half(now - 4 * WEEK, now - 2 * WEEK), b = half(now - 2 * WEEK, now);
  if (a && b && a.n >= 3 && b.n >= 3 && a.slope * dir > 0 && b.slope * dir < a.slope * dir * 0.6) {
    out.slowing = { was: r(a.slope * 7), now: r(b.slope * 7) };
  }

  if (remaining * dir <= tolerance(g)) {
    out.status = 'reached';
    out.reachedAt = firstReached(points, g);
    out.drift = r(level - g.target);
    return out;
  }

  if (g.targetDate) {
    const days = (new Date(`${g.targetDate}T12:00`).getTime() - now) / DAY;
    if (days > 0) out.neededPerWeek = r((remaining / days) * 7);
  }

  const toward = (s: number) => s * dir > 0;
  const minRate = Math.max(0.01, Math.abs(g.start) * 0.0001); // under ~0.07 kg/week at 100 kg counts as flat
  if (Math.abs(fit.slope) < minRate) { out.status = 'flat'; return out; }
  if (!toward(fit.slope)) { out.status = 'away'; return out; }

  const daysAt = (s: number) => (toward(s) ? remaining / s : Infinity);
  const d = daysAt(fit.slope);
  const steep = dir < 0 ? Math.min(fit.slopeLow, fit.slopeHigh) : Math.max(fit.slopeLow, fit.slopeHigh);
  const shallow = dir < 0 ? Math.max(fit.slopeLow, fit.slopeHigh) : Math.min(fit.slopeLow, fit.slopeHigh);
  if (d > MAX_DAYS) { out.status = 'flat'; return out; }
  out.eta = now + d * DAY;
  out.etaEarly = now + Math.min(d, daysAt(steep)) * DAY;
  const late = daysAt(shallow);
  out.etaLate = late <= MAX_DAYS ? now + Math.max(d, late) * DAY : undefined;
  if (g.targetDate) {
    const target = new Date(`${g.targetDate}T12:00`).getTime();
    out.daysPastTarget = Math.round((out.eta - target) / DAY);
    if (out.daysPastTarget > 0) out.status = 'behind';
  }
  return out;
}

/** The forecast as it stood a week ago (only data up to then), to show how the date has moved. */
export function forecastWeekAgo(points: Pt[], g: BodyGoal, now: number): Forecast {
  const then = now - WEEK;
  return forecast(points.filter((p) => p.t <= then + DAY / 2), g, then);
}

export interface Milestone { label: string; value: number; reachedAt?: number; eta?: number }

/** Steps on the way: 5%, 10%, 15%, 20% of the starting value (when they're before the target), halfway, the goal. */
export function milestones(points: Pt[], g: BodyGoal, f: Forecast, now: number): Milestone[] {
  const dir = Math.sign(g.target - g.start) || -1;
  const list: Milestone[] = [];
  for (const pct of [5, 10, 15, 20]) {
    const v = g.start * (1 + (dir * pct) / 100);
    if ((g.target - v) * dir > tolerance(g)) list.push({ label: `${pct}% ${dir < 0 ? 'down' : 'up'}`, value: r(v) });
  }
  const halfway = (g.start + g.target) / 2;
  if (!list.some((m) => Math.abs(m.value - halfway) < tolerance(g) * 2)) list.push({ label: 'Halfway', value: r(halfway) });
  list.push({ label: 'Goal', value: g.target });
  list.sort((a, b) => (b.value - a.value) * -dir); // in the order they're reached
  const trend = smoothTrend(points);
  const from = new Date(`${g.startDate}T00:00`).getTime();
  const slope = f.perDay;
  return list.map((m) => {
    const hit = trend.find((p) => p.t >= from && (p.v - m.value) * dir >= 0);
    if (hit) return { ...m, reachedAt: hit.t };
    if (m.label === 'Goal' && f.eta) return { ...m, eta: f.eta };
    if (f.level !== undefined && slope && (m.value - f.level) / slope > 0 && f.status !== 'flat' && f.status !== 'away') {
      const days = (m.value - f.level) / slope;
      if (days <= MAX_DAYS) return { ...m, eta: now + days * DAY };
    }
    return m;
  });
}

/** A pace faster than about 1% of body weight a week: worth checking with a doctor. */
export const isFastWeightPace = (perWeek: number | undefined, level: number | undefined) =>
  perWeek !== undefined && level !== undefined && Math.abs(perWeek) > Math.abs(level) * 0.01;

export const GOAL_METRICS: { metric: GoalMetric; label: string }[] = [
  { metric: 'weightKg', label: 'Weight' },
  { metric: 'waistCm', label: 'Waist' },
  { metric: 'bodyFatPct', label: 'Body fat' },
  { metric: 'leanKg', label: 'Lean mass' },
];
