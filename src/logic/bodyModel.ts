// The weight and body model: the true weight under the day-to-day noise (and why today's reading jumped), where the
// current habits land (the plateau, when the goal arrives, what it would take), how much of the coming loss is likely
// to be muscle (and what changes that), and a landing plan for goal weight. From the person's own weigh-ins, food,
// training and check-ins. Pure.
//
// The energy model is the well-known simplification of Hall's: each kg lighter burns about 22 Cal a day less, and a kg
// of body weight lost stands for about 7,700 Cal, so weight approaches a plateau with a time constant of about a year.
// The muscle share follows Forbes: the more fat there is to lose, the smaller the lean share (10.4 / (10.4 + fat kg)),
// adjusted for strength training, protein and the speed of loss.
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Workout } from '../db/schema';
import { robustFit } from './forecast';
import { inGroup } from './interactions';

const DAY = 86_400_000;
const KCAL_PER_KG = 7700;
const PER_KG = 22; // Cal a day burned per kg of body weight (composite, after adaptation)
const live = (x: { deletedAt?: string }) => !x.deletedAt;
const ms = (ymd: string) => new Date(`${ymd}T12:00`).getTime();
const ymdOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const r1 = (v: number) => Math.round(v * 10) / 10;

// ── The true weight, and today's reading explained ──────────────────────────────────────────────────

export interface WeightTrend {
  latest: number; latestDate: string;
  /** The smoothed weight under the noise. */
  trend: number;
  /** kg a week, from the trend (negative: losing), with a likely range. */
  perWeek: number; perWeekLow: number; perWeekHigh: number;
  /** The latest reading against the trend (kg). */
  off: number;
  /** Likely reasons for a reading well off the trend, most likely first. */
  causes: string[];
  points: { t: number; raw: number; trend: number }[];
}

export interface TrendData { body: BodyEntry[]; foodLogs: FoodLog[]; workouts: Workout[]; checkIns: CheckIn[]; daily: DailyHealth[]; doses: Dose[]; meds: Medication[] }

/** The trend: each day moves a tenth of the way to the reading (more for a gap), as a daily-weighing average does. */
export function weightTrend(d: TrendData, now: number): WeightTrend | null {
  const ws = d.body.filter((b) => live(b) && typeof b.weightKg === 'number' && ms(b.date) <= now + DAY).sort((a, b) => a.date.localeCompare(b.date));
  if (ws.length < 3) return null;
  const points: WeightTrend['points'] = [];
  let tr = ws[0].weightKg!, lastT = ms(ws[0].date);
  for (const b of ws) {
    const t = ms(b.date), gap = Math.max(1, Math.round((t - lastT) / DAY));
    const a = 1 - 0.9 ** gap;
    tr = points.length ? tr + a * (b.weightKg! - tr) : tr;
    points.push({ t, raw: b.weightKg!, trend: r1(tr) });
    lastT = t;
  }
  const recent = points.filter((p) => p.t > now - 28 * DAY);
  const fit = recent.length >= 4 ? robustFit(recent.map((p) => ({ t: p.t, v: p.raw })), now) : undefined;
  const last = points[points.length - 1];
  // The true weight now: the noise-resistant fit of the last 4 weeks (a plain average trails a steady loss by over a
  // kg); the smoothed line where there's too little for a fit.
  const trueKg = fit ? r1(fit.level) : last.trend;
  const off = r1(last.raw - trueKg);
  return {
    latest: last.raw, latestDate: ws[ws.length - 1].date, trend: trueKg, off,
    perWeek: fit ? r1(fit.slope * 7) : 0, perWeekLow: fit ? r1(fit.slopeLow * 7) : 0, perWeekHigh: fit ? r1(fit.slopeHigh * 7) : 0,
    causes: Math.abs(off) >= 0.4 ? causesFor(d, ws[ws.length - 1].date, off) : [], points,
  };
}

/** Why a reading sits above or below the trend: water, mostly. */
function causesFor(d: TrendData, date: string, off: number): string[] {
  const day = ms(date), yest = ymdOf(day - DAY);
  const onDay = (k: string) => d.foodLogs.filter((l) => live(l) && ymdOf(Date.parse(l.at)) === k);
  const sum = (ls: FoodLog[], key: 'sodium' | 'carbs' | 'kcal') => ls.reduce((a, l) => a + (l.nutrients[key] ?? 0), 0);
  const usualOf = (key: 'sodium' | 'carbs' | 'kcal') => {
    const days = new Map<string, number>();
    for (const l of d.foodLogs.filter((x) => live(x) && Date.parse(x.at) > day - 21 * DAY && Date.parse(x.at) < day - DAY)) days.set(ymdOf(Date.parse(l.at)), (days.get(ymdOf(Date.parse(l.at))) ?? 0) + (l.nutrients[key] ?? 0));
    return days.size >= 5 ? median([...days.values()]) : undefined;
  };
  const y = onDay(yest);
  const chipsWithin = (re: RegExp, hours: number) => d.checkIns.some((c) => live(c) && Date.parse(c.at) > day - hours * 3_600_000 && Date.parse(c.at) <= day + 12 * 3_600_000 && c.chips.some((x) => re.test(x)));
  const out: string[] = [];
  if (off > 0) {
    const na = sum(y, 'sodium'), naUsual = usualOf('sodium');
    if (y.length && (na >= 3000 || (naUsual !== undefined && na >= naUsual + 800))) out.push(`a salty day yesterday (${Math.round(na).toLocaleString('en-AU')} mg sodium)`);
    const carbs = sum(y, 'carbs'), cUsual = usualOf('carbs');
    if (y.length && cUsual !== undefined && carbs >= cUsual + 60) out.push(`more carbs than usual yesterday (${Math.round(carbs)} g; carbs hold water)`);
    const lifted = d.workouts.some((w) => live(w) && w.sets.some((s) => s.done) && Date.parse(w.startedAt) > day - 2 * DAY && Date.parse(w.startedAt) <= day + 12 * 3_600_000);
    if (lifted) out.push('a strength session (muscles hold water while they repair)');
    if (chipsWithin(/alcohol|drink/i, 36)) out.push('alcohol yesterday');
    if (chipsWithin(/constipat/i, 72)) out.push('constipation');
    const sleep = d.daily.find((x) => live(x) && x.date === date)?.sleepMin;
    if (sleep !== undefined && sleep < 360) out.push('a short night');
    if (y.length && cUsual === undefined && sum(y, 'kcal') >= 2800) out.push('a bigger day of eating yesterday');
  } else {
    if (chipsWithin(/vomit|diarrh/i, 48)) out.push('fluid lost with vomiting or diarrhoea');
    const water = d.daily.find((x) => live(x) && x.date === yest)?.waterMl;
    if (water !== undefined && water < 1200) out.push('little to drink yesterday');
    const glp = new Set(d.meds.filter((m) => inGroup(m, 'glp1')).map((m) => m.id));
    if (d.doses.some((x) => live(x) && !x.skipped && glp.has(x.medicationId) && Date.parse(x.takenAt) > day - 3 * DAY && Date.parse(x.takenAt) <= day)) out.push('less food and drink in the days after a shot');
    const na = sum(y, 'sodium');
    if (y.length && na > 0 && na < 1200) out.push('a low-salt day yesterday');
    if (!out.length) out.push('less water held than usual');
  }
  return out.slice(0, 3);
}

// ── Where the current habits land ───────────────────────────────────────────────────────────────────

export interface Landing {
  /** What's burned a day now, and what the weight change says is eaten. */
  burn: number; intake: number;
  /** The burn is a rough estimate from weight alone (no food log or watch burn yet). */
  burnEstimated: boolean;
  /** Where the weight levels off on that intake. */
  plateauKg: number;
  /** When the goal arrives on the current path (with a likely range), or that it won't without a change. */
  goal?: { kg: number; date?: number; early?: number; late?: number; reachable: boolean };
  /** What it would take: a day's calories (on average) to reach the goal in the shortest of 18, 24 or 30 months
   *  that keeps to at least 1,400 Cal. */
  plan?: { months: number; kcal: number };
  /** Is the loss slowing as expected (lighter bodies burn less), or slower than the numbers say? */
  pace: 'expected' | 'slower-than-expected' | 'faster-than-expected' | 'unknown';
  /** At the goal: what keeps it there. */
  maintenanceAtGoal?: number;
}

/** The burn: the watch's usual (7+ days), else what food and weight say, else about 24 Cal per kg. */
export function landing(trend: WeightTrend, burnKnown: number | undefined, goalKg: number | undefined, now: number): Landing {
  const W = trend.trend;
  const burn = Math.round(burnKnown ?? W * 24);
  const deficit = -trend.perWeek * (KCAL_PER_KG / 7);
  const intake = Math.round(burn - deficit);
  const plateau = r1(W - deficit / PER_KG);
  const tau = KCAL_PER_KG / PER_KG; // days
  const out: Landing = { burn, intake, plateauKg: plateau, pace: 'unknown', burnEstimated: burnKnown === undefined };
  if (goalKg && goalKg < W) {
    const when = (p: number) => (goalKg > p ? now - tau * Math.log((goalKg - p) / (W - p)) * DAY : undefined);
    const pFrom = (perWeek: number) => W - (-perWeek * (KCAL_PER_KG / 7)) / PER_KG;
    const date = trend.perWeek < 0 ? when(plateau) : undefined;
    out.goal = { kg: goalKg, reachable: !!date, date, early: trend.perWeekLow < 0 ? when(pFrom(trend.perWeekLow)) : undefined, late: trend.perWeekHigh < 0 ? when(pFrom(trend.perWeekHigh)) : undefined };
    for (const months of [18, 24, 30]) {
      const e = Math.exp(-(months * 30.4) / tau);
      const kcal = Math.round((burn + PER_KG * ((goalKg - W * e) / (1 - e) - W)) / 10) * 10;
      if (kcal >= 1400) { out.plan = { months, kcal }; break; }
    }
    out.maintenanceAtGoal = Math.round((burn + PER_KG * (goalKg - W)) / 10) * 10;
  }
  // Pace: four weeks ago's rate, less what 22 Cal a kg explains, against now.
  const then = trend.points.filter((p) => p.t > now - 56 * DAY && p.t <= now - 28 * DAY);
  if (then.length >= 4 && trend.perWeek < 0) {
    const fit = robustFit(then.map((p) => ({ t: p.t, v: p.raw })), now - 28 * DAY);
    if (fit && fit.slope < 0) {
      const lost = mean(then.map((p) => p.trend)) - W;
      const expected = fit.slope * 7 + (lost * PER_KG * 7) / KCAL_PER_KG; // less negative as weight falls
      const diff = trend.perWeek - expected;
      out.pace = diff > 0.35 ? 'slower-than-expected' : diff < -0.35 ? 'faster-than-expected' : 'expected';
    }
  }
  return out;
}

// ── How much of the loss is muscle ──────────────────────────────────────────────────────────────────

export interface LeanForecast {
  /** Share of the next 10 kg lost likely to be lean mass, now and with the changes. */
  share: number; better?: number;
  fatKg: number;
  /** What's raising it, and what would lower it. */
  raising: string[]; levers: string[];
  /** From the scale or scans over the last 8 weeks, when there's enough. */
  measured?: number;
}

export function leanForecast(body: BodyEntry[], workouts: Workout[], daily: DailyHealth[], perWeek: number, proteinTarget: number | null, now: number): LeanForecast | null {
  const comp = body.filter((b) => live(b) && typeof b.bodyFatPct === 'number' && typeof b.weightKg === 'number' && ms(b.date) > now - 45 * DAY).sort((a, b) => a.date.localeCompare(b.date));
  const last = comp[comp.length - 1];
  if (!last) return null;
  const W = last.weightKg!, fatKg = r1((W * last.bodyFatPct!) / 100);
  const base = 10.4 / (10.4 + fatKg);
  const sessions = workouts.filter((w) => live(w) && w.sets.some((s) => s.done) && Date.parse(w.startedAt) > now - 28 * DAY).length / 4;
  const prot = daily.filter((x) => live(x) && x.proteinG && ms(x.date) > now - 14 * DAY).map((x) => x.proteinG!);
  const protPerKg = prot.length >= 4 ? mean(prot) / W : undefined;
  const fast = perWeek < 0 && -perWeek / W > 0.01;
  const raising: string[] = [], levers: string[] = [];
  let m = 1, mBest = 1;
  if (sessions >= 2) { m *= 0.6; mBest *= 0.6; } else { raising.push(sessions ? `${r1(sessions)} strength session${sessions === 1 ? '' : 's'} a week` : 'no strength training'); levers.push('2 strength sessions a week'); mBest *= 0.6; }
  if (protPerKg !== undefined && protPerKg < 1.2) { m *= 1.25; raising.push(`protein about ${Math.round(protPerKg * W)} g a day`); levers.push(`protein up to ${proteinTarget ?? Math.round(W * 1.2)} g a day`); }
  if (fast) { m *= 1.2; mBest *= 1.2; raising.push('losing more than 1% of body weight a week'); }
  const share = Math.min(0.6, base * m), better = levers.length ? Math.min(0.6, base * mBest) : undefined;
  // Measured: lean change against weight change across the readings (needs 2+ kg of change).
  const lean = body.filter((b) => live(b) && typeof b.leanKg === 'number' && typeof b.weightKg === 'number' && ms(b.date) > now - 56 * DAY).sort((a, b) => a.date.localeCompare(b.date));
  let measured: number | undefined;
  if (lean.length >= 4) {
    const k = Math.max(1, Math.floor(lean.length / 3));
    const a = lean.slice(0, k), b = lean.slice(-k);
    const dW = mean(a.map((x) => x.weightKg!)) - mean(b.map((x) => x.weightKg!)), dL = mean(a.map((x) => x.leanKg!)) - mean(b.map((x) => x.leanKg!));
    if (dW >= 2) measured = Math.max(0, Math.min(1, dL / dW));
  }
  return { share: Math.round(share * 100) / 100, better: better !== undefined ? Math.round(better * 100) / 100 : undefined, fatKg, raising, levers, measured: measured !== undefined ? Math.round(measured * 100) / 100 : undefined };
}

// ── Landing at goal ─────────────────────────────────────────────────────────────────────────────────

export interface LandingPlan {
  maintenance: number;
  /** Calories each week from now to maintenance, rising in steps. */
  steps: { week: number; kcal: number }[];
  /** How likely regain is, from the trends that usually come before it. */
  risk: 'low' | 'medium' | 'high'; riskWhy: string[];
}

/** Within 8 kg (or 12 weeks) of the goal: calories up in about 150 Cal steps a week to maintenance, and the regain signs. */
export function landingPlan(trend: WeightTrend, land: Landing, d: { daily: DailyHealth[]; workouts: Workout[]; checkIns: CheckIn[] }, now: number): LandingPlan | null {
  if (!land.goal || land.maintenanceAtGoal === undefined) return null;
  const toGo = trend.trend - land.goal.kg;
  const soon = land.goal.date !== undefined && land.goal.date - now < 84 * DAY;
  if (toGo > 8 && !soon) return null;
  const steps: LandingPlan['steps'] = [];
  for (let k = land.intake, w = 1; k < land.maintenanceAtGoal && w <= 12; w++) { k = Math.min(land.maintenanceAtGoal, k + 150); steps.push({ week: w, kcal: Math.round(k / 10) * 10 }); }
  const why: string[] = [];
  const avg = (from: number, to: number, f: (x: DailyHealth) => number | undefined) => { const xs = d.daily.filter((x) => live(x) && ms(x.date) > now - from * DAY && ms(x.date) <= now - to * DAY).map(f).filter((v): v is number => typeof v === 'number'); return xs.length >= 5 ? mean(xs) : undefined; };
  const sNow = avg(14, 0, (x) => x.steps), sBefore = avg(42, 14, (x) => x.steps);
  if (sNow !== undefined && sBefore !== undefined && sNow < sBefore * 0.85) why.push('steps down');
  const lifts = (from: number, to: number) => d.workouts.filter((w) => live(w) && w.sets.some((s) => s.done) && Date.parse(w.startedAt) > now - from * DAY && Date.parse(w.startedAt) <= now - to * DAY).length;
  if (lifts(28, 0) < lifts(56, 28)) why.push('fewer strength sessions');
  const hunger = (from: number, to: number) => d.checkIns.filter((c) => live(c) && Date.parse(c.at) > now - from * DAY && Date.parse(c.at) <= now - to * DAY && c.chips.some((x) => /hungry|craving|food noise/i.test(x))).length;
  if (hunger(14, 0) > hunger(28, 14) + 2) why.push('more hunger and cravings');
  if (trend.perWeek > 0.1) why.push('the trend turning up');
  return { maintenance: land.maintenanceAtGoal, steps, risk: why.length >= 2 ? 'high' : why.length ? 'medium' : 'low', riskWhy: why };
}
