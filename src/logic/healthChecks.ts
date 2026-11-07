// Health checks from everything together (watch, scale, blood pressure, medicines, check-ins): things a watch app on
// its own can't see. A sleep apnoea check to raise with a GP; blood pressure as the weight comes off (and a flag
// for the prescriber when it runs low on BP tablets); fitness age now and at the goal weight; why resting heart rate
// changed; the body clock; each reading against the person's own usual; and visceral fat's path to the healthy
// range. Nudges and things to mention, never a diagnosis or a change to a medicine. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, Medication, Vital } from '../db/schema';
import { inGroup } from './interactions';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const ms = (d: string) => new Date(`${d}T12:00`).getTime();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Least-squares slope and intercept of y on x. */
function fit(pts: { x: number; y: number }[]): { slope: number; icpt: number; r2: number } | null {
  if (pts.length < 3) return null;
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, icpt: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** The weight for each day, carried from the nearest weigh-in within 4 days. */
function weightOn(body: BodyEntry[]) {
  const ws = body.filter((b) => live(b) && typeof b.weightKg === 'number').map((b) => ({ t: ms(b.date), kg: b.weightKg! })).sort((a, b) => a.t - b.t);
  return (t: number) => { let best: { t: number; kg: number } | undefined; for (const w of ws) if (Math.abs(w.t - t) <= 4 * DAY && (!best || Math.abs(w.t - t) < Math.abs(best.t - t))) best = w; return best?.kg; };
}

export interface About { heightCm?: number; birthYear?: number; sex?: 'm' | 'f' }
const ageOf = (a: About, now: number) => (a.birthYear ? new Date(now).getFullYear() - a.birthYear : undefined);

// ── 1. Sleep apnoea check ─────────────────────────────────────────────────────────────────────────────

export interface ApnoeaCheck {
  level: 'low' | 'some' | 'high';
  /** The STOP-BANG items that apply, and the overnight signs from the watch. */
  items: string[]; nightSigns: string[];
  /** Items not known yet (so the score may be higher). */
  unknown: string[];
  score: number;
}

/** STOP-BANG (Snoring, Tired, Observed, Pressure, BMI > 35, Age > 50, Neck > 40 cm, male) from what's recorded,
 *  plus the watch's overnight oxygen: nights with the lowest reading under 88%, or an average under 94%. */
export function apnoeaCheck(x: { daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[]; checkIns: CheckIn[]; meds: Medication[]; about: About }, now: number): ApnoeaCheck | null {
  const nights = x.daily.filter((d) => live(d) && ms(d.date) > now - 30 * DAY && (typeof d.spo2Min === 'number' || typeof d.spo2Avg === 'number'));
  const latest = <K extends keyof BodyEntry>(k: K) => x.body.filter((b) => live(b) && b[k] !== undefined).sort((a, b) => b.date.localeCompare(a.date))[0]?.[k] as number | undefined;
  const kg = latest('weightKg'), neck = latest('neckCm');
  const bmi = kg && x.about.heightCm ? kg / (x.about.heightCm / 100) ** 2 : undefined;
  const age = ageOf(x.about, now);
  const recent = x.checkIns.filter((c) => live(c) && Date.parse(c.at) > now - 30 * DAY);
  const snore = recent.some((c) => c.chips.some((ch) => /snor/i.test(ch)));
  const witnessed = recent.some((c) => c.chips.some((ch) => /stop(ped)? breathing|gasp|choking/i.test(ch)));
  const energies = recent.map((c) => c.energy).filter((v): v is number => typeof v === 'number');
  const tired = energies.length >= 5 && mean(energies) <= 2.5;
  const bps = x.vitals.filter((v) => live(v) && typeof v.systolic === 'number' && Date.parse(v.at) > now - 90 * DAY);
  const highBp = bps.length >= 3 && (median(bps.map((v) => v.systolic!)) >= 140 || median(bps.map((v) => v.diastolic ?? 0)) >= 90);
  const onBp = x.meds.some((m) => !m.archived && isBpMed(m));
  const items: string[] = [], unknown: string[] = [];
  if (snore) items.push('Snoring noted'); else unknown.push('snoring (add a "Snoring" check-in chip if a partner says so)');
  if (tired) items.push('Often tired (check-in energy)');
  if (witnessed) items.push('Stopped breathing or gasping noted');
  if (highBp || onBp) items.push(onBp ? 'On blood pressure tablets' : 'High blood pressure readings');
  if (bmi !== undefined) { if (bmi > 35) items.push(`BMI ${r1(bmi)}`); } else unknown.push('height (for BMI)');
  if (age !== undefined) { if (age > 50) items.push(`Age ${age}`); } else unknown.push('year of birth');
  if (neck !== undefined) { if (neck > 40) items.push(`Neck ${r1(neck)} cm`); } else unknown.push('neck measurement');
  if (x.about.sex === 'm') items.push('Male'); else if (!x.about.sex) unknown.push('sex');
  const nightSigns: string[] = [];
  const lowMin = nights.filter((d) => typeof d.spo2Min === 'number' && d.spo2Min < 88).length;
  const lowAvg = nights.filter((d) => typeof d.spo2Avg === 'number' && d.spo2Avg < 94).length;
  if (nights.length >= 5 && lowMin / nights.length >= 0.3) nightSigns.push(`Blood oxygen dipped under 88% on ${lowMin} of ${nights.length} nights`);
  if (nights.length >= 5 && lowAvg / nights.length >= 0.3) nightSigns.push(`Average overnight blood oxygen under 94% on ${lowAvg} of ${nights.length} nights`);
  const score = items.length;
  if (score === 0 && !nightSigns.length && unknown.length > 4) return null;
  const level = score >= 5 || (score >= 3 && nightSigns.length) ? 'high' : score >= 3 || nightSigns.length ? 'some' : 'low';
  return { level, items, nightSigns, unknown, score };
}

const BP_NAMES = ['amlodipine', 'felodipine', 'lercanidipine', 'nifedipine', 'diltiazem', 'verapamil', 'metoprolol', 'atenolol', 'bisoprolol', 'carvedilol', 'nebivolol',
  'prazosin', 'clonidine', 'moxonidine', 'hydralazine', 'methyldopa', 'spironolactone', 'eplerenone'];
export const isBpMed = (m: Medication) => inGroup(m, 'bp-raas') || inGroup(m, 'diuretic') || BP_NAMES.some((n) => m.name.toLowerCase().includes(n));

// ── 2. Blood pressure as the weight comes off ──────────────────────────────────────────────────────────

export interface BpWeight {
  /** mmHg of systolic per kg (from the person's own readings), and the change since the first 30 days. */
  perKg?: number; sysNow: number; diaNow: number; sysThen?: number; kgLost?: number;
  /** On BP tablets and readings running low (or dizzy check-ins): one for the prescriber. */
  lowOnTablets?: string[];
  /** On BP tablets and falling: when readings are likely to reach about 110 at this rate (worth a review before). */
  reviewBy?: number;
}

export function bpWithWeight(x: { vitals: Vital[]; body: BodyEntry[]; checkIns: CheckIn[]; meds: Medication[] }, now: number): BpWeight | null {
  const bps = x.vitals.filter((v) => live(v) && typeof v.systolic === 'number' && typeof v.diastolic === 'number').sort((a, b) => a.at.localeCompare(b.at));
  const recent = bps.filter((v) => Date.parse(v.at) > now - 14 * DAY);
  if (recent.length < 2) return null;
  const sysNow = Math.round(median(recent.map((v) => v.systolic!))), diaNow = Math.round(median(recent.map((v) => v.diastolic!)));
  const w = weightOn(x.body);
  const pts = bps.filter((v) => Date.parse(v.at) > now - 180 * DAY).map((v) => ({ x: w(Date.parse(v.at)), y: v.systolic! })).filter((p): p is { x: number; y: number } => p.x !== undefined);
  const f = fit(pts);
  const xs = pts.map((p) => p.x);
  const spread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const first = bps.filter((v) => Date.parse(v.at) < Date.parse(bps[0].at) + 30 * DAY);
  const out: BpWeight = { sysNow, diaNow };
  if (f && spread >= 3 && pts.length >= 6 && f.slope > 0) out.perKg = r1(f.slope);
  if (first.length >= 2 && Date.parse(bps[0].at) < now - 45 * DAY) {
    out.sysThen = Math.round(median(first.map((v) => v.systolic!)));
    const k0 = w(Date.parse(first[0].at)), k1 = w(now);
    if (k0 && k1) out.kgLost = r1(k0 - k1);
  }
  const onBp = x.meds.filter((m) => !m.archived && isBpMed(m));
  if (onBp.length) {
    const why: string[] = [];
    if (sysNow < 110) why.push(`blood pressure around ${sysNow}/${diaNow}`);
    if (recent.some((v) => v.systolic! < 100)) why.push('a reading under 100');
    if (x.checkIns.some((c) => live(c) && Date.parse(c.at) > now - 14 * DAY && c.chips.some((ch) => /dizz|lighthead|faint/i.test(ch)))) why.push('dizziness noted');
    if (why.length) out.lowOnTablets = why;
    // Falling at a steady rate: when it's likely to reach about 110, so a review can be booked ahead.
    const pts90 = bps.filter((v) => Date.parse(v.at) > now - 90 * DAY).map((v) => ({ x: Date.parse(v.at), y: v.systolic! }));
    const f90 = fit(pts90);
    if (!why.length && f90 && pts90.length >= 6 && sysNow > 110) {
      const perDay = f90.slope * DAY;
      const days = perDay < -0.03 ? (sysNow - 110) / -perDay : Infinity;
      if (days <= 120) out.reviewBy = now + days * DAY;
    }
  }
  return out;
}

// ── 3. Fitness age, now and at the goal weight ─────────────────────────────────────────────────────────

export interface FitnessAge {
  vo2: number; age?: number; fitnessAge?: number;
  /** VO2 max at the goal weight (the heart and lungs the same, carrying less), and the fitness age then. */
  atGoal?: { kg: number; vo2: number; fitnessAge?: number };
  band?: 'low' | 'fair' | 'good' | 'excellent';
}

/** Average VO2 max by age (HUNT study, roughly): men 61.7 − 0.37 × age, women 48.2 − 0.25 × age. Fitness age is the
 *  age whose average matches yours. */
const avgVo2 = (age: number, sex: 'm' | 'f') => (sex === 'm' ? 61.7 - 0.37 * age : 48.2 - 0.25 * age);
const fitAge = (vo2: number, sex: 'm' | 'f') => Math.round(Math.min(90, Math.max(18, sex === 'm' ? (61.7 - vo2) / 0.37 : (48.2 - vo2) / 0.25)));

export function fitnessAge(daily: DailyHealth[], body: BodyEntry[], about: About, goalKg: number | undefined, now: number): FitnessAge | null {
  const v = daily.filter((d) => live(d) && typeof d.vo2max === 'number' && ms(d.date) > now - 60 * DAY).sort((a, b) => b.date.localeCompare(a.date));
  if (!v.length) return null;
  const vo2 = r1(median(v.slice(0, 7).map((d) => d.vo2max!)));
  const age = ageOf(about, now);
  const out: FitnessAge = { vo2, age };
  if (about.sex) {
    out.fitnessAge = fitAge(vo2, about.sex);
    if (age !== undefined) { const rel = vo2 / avgVo2(age, about.sex); out.band = rel < 0.85 ? 'low' : rel < 1 ? 'fair' : rel < 1.15 ? 'good' : 'excellent'; }
  }
  const kg = weightOn(body)(now);
  if (goalKg && kg && goalKg < kg) {
    const g = r1((vo2 * kg) / goalKg);
    out.atGoal = { kg: goalKg, vo2: g, fitnessAge: about.sex ? fitAge(g, about.sex) : undefined };
  }
  return out;
}

// ── 4. Why resting heart rate changed ──────────────────────────────────────────────────────────────────

export interface RhrExplained { now: number; then: number; change: number; parts: { what: string; bpm: number }[]; other: number }

/** Resting heart rate over the last 14 days against 8 to 12 weeks ago, split into what the person's own days say
 *  each thing does: weight (bpm per kg), a GLP-1 or GIP medicine (bpm on it against off it, or per mg), and how much
 *  they train (bpm per weekly hour). Whatever's left is "other" (sleep, stress, illness, heat). */
export function rhrExplained(x: { daily: DailyHealth[]; body: BodyEntry[]; doses: Dose[]; meds: Medication[]; workoutsPerWeek?: (t: number) => number }, now: number): RhrExplained | null {
  const rows = x.daily.filter((d) => live(d) && typeof d.restingHr === 'number' && ms(d.date) > now - 120 * DAY);
  const recent = rows.filter((d) => ms(d.date) > now - 14 * DAY), before = rows.filter((d) => ms(d.date) < now - 56 * DAY && ms(d.date) > now - 84 * DAY);
  if (recent.length < 7 || before.length < 7) return null;
  const nowV = mean(recent.map((d) => d.restingHr!)), thenV = mean(before.map((d) => d.restingHr!));
  const change = nowV - thenV;
  const w = weightOn(x.body);
  const glp = new Set(x.meds.filter((m) => inGroup(m, 'glp1')).map((m) => m.id));
  const glpDoses = x.doses.filter((d) => live(d) && !d.skipped && glp.has(d.medicationId)).map((d) => ({ t: Date.parse(d.takenAt), mg: d.amount })).sort((a, b) => a.t - b.t);
  // The weekly dose in effect on a day (the last shot in the 10 days before), 0 off it.
  const doseOn = (t: number) => { let v = 0; for (const d of glpDoses) if (d.t <= t && d.t > t - 10 * DAY) v = d.mg; return v; };
  const pts = rows.map((d) => ({ t: ms(d.date), hr: d.restingHr!, kg: w(ms(d.date)), mg: doseOn(ms(d.date)), tr: x.workoutsPerWeek?.(ms(d.date)) ?? 0 })).filter((p) => p.kg !== undefined) as { t: number; hr: number; kg: number; mg: number; tr: number }[];
  if (pts.length < 20) return null;
  // All together (least squares on weight, dose and training at once), so a medicine started while the weight was
  // falling doesn't take the weight's share, or the other way round.
  const keys: ('mg' | 'kg' | 'tr')[] = ([...(glpDoses.length ? ['mg'] : []), 'kg', ...(x.workoutsPerWeek ? ['tr'] : [])] as ('mg' | 'kg' | 'tr')[])
    .filter((k) => new Set(pts.map((p) => Math.round(p[k] * 10))).size >= 2);
  // Each factor's known direction: heart rate goes up with weight and with a GLP-1/GIP dose, down with training. A
  // factor that comes out the wrong way round is tangled with another in this person's data: leave it out and refit.
  const SIGN = { mg: 1, kg: 1, tr: -1 } as const;
  let coef: number[] | null = null;
  for (let i = 0; i < 3 && keys.length; i++) {
    coef = ols(pts.map((p) => keys.map((k) => p[k])), pts.map((p) => p.hr));
    const wrong = coef ? keys.findIndex((k, j) => Math.sign(coef![j]) === -SIGN[k]) : -1;
    if (wrong < 0) break;
    keys.splice(wrong, 1); coef = null;
  }
  if (!keys.length) coef = null;
  const recentP = pts.filter((p) => p.t > now - 14 * DAY), beforeP = pts.filter((p) => p.t < now - 56 * DAY && p.t > now - 84 * DAY);
  const label = { mg: 'Your GLP-1 medicine', kg: 'Weight change', tr: 'Training' } as const;
  const parts: { what: string; bpm: number }[] = [];
  if (coef && recentP.length && beforeP.length) keys.forEach((k, i) => {
    const bpm = coef[i] * (mean(recentP.map((p) => p[k])) - mean(beforeP.map((p) => p[k])));
    if (Math.abs(bpm) >= 0.8) parts.push({ what: label[k], bpm: r1(bpm) });
  });
  const explained = parts.reduce((a, p) => a + p.bpm, 0);
  return { now: Math.round(nowV), then: Math.round(thenV), change: r1(change), parts, other: r1(change - explained) };
}

/** Ordinary least squares with an intercept: the coefficient of each column (intercept dropped), or null. */
function ols(X: number[][], y: number[]): number[] | null {
  const n = X.length, k = (X[0]?.length ?? 0) + 1;
  if (n < k + 5) return null;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < n; r++) {
    const row = [1, ...X[r]];
    for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j]; A[i][k] += row[i] * y[r]; }
  }
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.slice(1).map((row, i) => row[k] / A[i + 1][i + 1]);
}

// ── 7. Body clock ──────────────────────────────────────────────────────────────────────────────────────

export interface BodyClock {
  /** Hours between the middle of sleep on free days (Fri and Sat nights) and work nights: "social jet lag". */
  jetLagH: number; midWork: string; midFree: string;
  /** Minutes the night's middle moves from one night to the next, on average. */
  driftMin: number;
  score: number;
  /** Days after a night off your usual timing against days after an on-time night: appetite, cravings, focus. */
  effects: { what: string; off: number; on: number }[];
}

const hm = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

export function bodyClock(daily: DailyHealth[], checkIns: CheckIn[], now: number): BodyClock | null {
  const nights = daily.filter((d) => live(d) && d.sleepStart && d.sleepEnd && ms(d.date) > now - 42 * DAY)
    .map((d) => { const mid = (d.sleepStart! + d.sleepEnd!) / 2; const dt = new Date(mid); let m = dt.getHours() * 60 + dt.getMinutes(); if (m > 12 * 60) m -= 1440; const wake = new Date(d.sleepEnd!); return { date: d.date, mid: m, free: wake.getDay() === 6 || wake.getDay() === 0 }; })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (nights.length < 14) return null;
  const work = nights.filter((n) => !n.free), free = nights.filter((n) => n.free);
  if (work.length < 5 || free.length < 2) return null;
  const mw = median(work.map((n) => n.mid)), mf = median(free.map((n) => n.mid));
  const jetLagH = r1(Math.abs(mf - mw) / 60);
  const steps = nights.slice(1).map((n, i) => Math.abs(n.mid - nights[i].mid));
  const driftMin = Math.round(mean(steps));
  const usual = median(nights.map((n) => n.mid));
  const score = Math.max(0, Math.min(100, Math.round(100 - jetLagH * 25 - Math.max(0, driftMin - 15) * 0.8)));
  const off = new Set(nights.filter((n) => Math.abs(n.mid - usual) >= 60).map((n) => n.date));
  const effects: BodyClock['effects'] = [];
  const day = (c: CheckIn) => { const d = new Date(c.at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (const [k, what] of [['appetite', 'Appetite'], ['focus', 'Focus'], ['energy', 'Energy']] as const) {
    const a = checkIns.filter((c) => live(c) && typeof c[k] === 'number' && off.has(day(c))).map((c) => c[k]!);
    const b = checkIns.filter((c) => live(c) && typeof c[k] === 'number' && !off.has(day(c)) && Date.parse(c.at) > now - 42 * DAY).map((c) => c[k]!);
    if (a.length >= 3 && b.length >= 5 && Math.abs(mean(a) - mean(b)) >= 0.4) effects.push({ what, off: r1(mean(a)), on: r1(mean(b)) });
  }
  const cravingDays = (set: boolean) => { const ds = nights.filter((n) => off.has(n.date) === set).map((n) => n.date); const hits = ds.filter((d) => checkIns.some((c) => live(c) && day(c) === d && c.chips.some((ch) => /crav/i.test(ch)))).length; return ds.length ? hits / ds.length : 0; };
  const cOff = cravingDays(true), cOn = cravingDays(false);
  if (off.size >= 3 && Math.abs(cOff - cOn) >= 0.2) effects.push({ what: 'Days with cravings', off: Math.round(cOff * 100), on: Math.round(cOn * 100) });
  return { jetLagH, midWork: hm(mw), midFree: hm(mf), driftMin, score, effects };
}

// ── 8. Unusual for you ─────────────────────────────────────────────────────────────────────────────────

export interface Band { key: string; label: string; unit: string; value: number; lo: number; hi: number; usual: number; state: 'low' | 'usual' | 'high'; dp: number; higherBetter?: boolean;
  /** The last 8 weeks of readings (one per day where there are several, averaged), for the chart behind the band. */
  recent: { t: number; v: number }[] }

/** Each reading's latest value against the person's own range: the median of the 28 days before ± 2 × the typical
 *  spread (scaled MAD, at least a small floor so a very steady reading isn't flagged for nothing). */
export function usualBands(x: { daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[] }, now: number): Band[] {
  const out: Band[] = [];
  const add = (key: string, label: string, unit: string, dp: number, floor: number, series: { t: number; v: number }[], higherBetter?: boolean) => {
    const s = series.filter((p) => p.t > now - 35 * DAY).sort((a, b) => a.t - b.t);
    const last = s[s.length - 1];
    if (!last || now - last.t > 2 * DAY) return;
    const base = s.filter((p) => p.t < last.t - DAY / 2 && p.t > last.t - 29 * DAY).map((p) => p.v);
    if (base.length < 7) return;
    const m = median(base), mad = median(base.map((v) => Math.abs(v - m))) * 1.4826;
    const half = Math.max(2 * mad, floor);
    const lo = m - half, hi = m + half;
    const k = 10 ** dp, rd = (v: number) => Math.round(v * k) / k;
    // The chart: 8 weeks, one value per day (several readings on a day, e.g. blood pressure, are averaged).
    const byDay = new Map<number, number[]>();
    for (const p of series) if (p.t > now - 56 * DAY && p.t <= now) { const k = Math.floor(p.t / DAY); byDay.set(k, [...(byDay.get(k) ?? []), p.v]); }
    const recent = [...byDay.values()].map((vs) => vs.reduce((a, b) => a + b, 0) / vs.length)
      .map((v, i) => ({ t: [...byDay.keys()][i] * DAY + DAY / 2, v })).sort((a, b) => a.t - b.t);
    out.push({ key, label, unit, dp, value: rd(last.v), usual: rd(m), lo: rd(lo), hi: rd(hi), state: last.v < lo ? 'low' : last.v > hi ? 'high' : 'usual', higherBetter, recent });
  };
  const d = (k: keyof DailyHealth) => x.daily.filter((r) => live(r) && typeof r[k] === 'number').map((r) => ({ t: ms(r.date), v: r[k] as number }));
  add('restingHr', 'Resting heart rate', 'bpm', 0, 3, d('restingHr'), false);
  add('hrvMs', 'HRV', 'ms', 0, 5, d('hrvMs'), true);
  add('sleepMin', 'Sleep', 'h', 1, 0.5, d('sleepMin').map((p) => ({ ...p, v: p.v / 60 })), true);
  add('spo2Avg', 'Blood oxygen', '%', 1, 1, d('spo2Avg'), true);
  add('respRate', 'Breathing rate', '/min', 1, 1, d('respRate'), false);
  add('skinTempDelta', 'Skin temperature', '°C', 1, 0.4, d('skinTempDelta'));
  add('steps', 'Steps', '', 0, 1500, d('steps'), true);
  add('glucoseAvg', 'Glucose', 'mmol/L', 1, 0.5, d('glucoseAvg'));
  const bp = x.vitals.filter((v) => live(v) && typeof v.systolic === 'number').map((v) => ({ t: Date.parse(v.at), v: v.systolic! }));
  add('systolic', 'Blood pressure', 'mmHg', 0, 6, bp, false);
  const water = x.body.filter((b) => live(b) && (typeof b.waterPct === 'number' || (typeof b.waterKg === 'number' && b.weightKg)))
    .map((b) => ({ t: ms(b.date), v: b.waterPct ?? (b.waterKg! / b.weightKg!) * 100 }));
  add('waterPct', 'Body water (scale)', '%', 1, 0.8, water, true);
  return out;
}

// ── Visceral fat's path to the healthy range ───────────────────────────────────────────────────────────

export interface VisceralPath { now: number; perMonth: number; healthyBy?: number; band: 'healthy' | 'high' | 'very high' }

/** On a 1–59 rating (Tanita, Renpho): up to 9 healthy, 10–14 high, 15+ very high. From the last 12 weeks' trend. */
export function visceralPath(body: BodyEntry[], now: number): VisceralPath | null {
  const pts = body.filter((b) => live(b) && typeof b.visceralFat === 'number' && ms(b.date) > now - 84 * DAY).map((b) => ({ x: ms(b.date), y: b.visceralFat! }));
  if (pts.length < 4) return null;
  const f = fit(pts);
  const cur = r1(f ? f.icpt + f.slope * now : pts[pts.length - 1].y);
  const perMonth = f ? r1(f.slope * 30 * DAY) : 0;
  const band = cur <= 9 ? 'healthy' : cur < 15 ? 'high' : 'very high';
  const healthyBy = cur > 9 && perMonth < -0.05 ? now + ((cur - 9) / -perMonth) * 30 * DAY : undefined;
  return { now: cur, perMonth, healthyBy, band };
}

// ── 5. Running dry, from the scale ─────────────────────────────────────────────────────────────────────

/** Body water today against the scale's last two weeks: a drop of 1.5 points or more. */
export function scaleWaterDrop(body: BodyEntry[], today: string): string | null {
  const pct = (b: BodyEntry) => b.waterPct ?? (b.waterKg && b.weightKg ? (b.waterKg / b.weightKg) * 100 : undefined);
  const rows = body.filter((b) => live(b) && pct(b) !== undefined);
  const t = rows.find((b) => b.date === today);
  const base = rows.filter((b) => b.date < today && ms(b.date) > ms(today) - 15 * DAY).map((b) => pct(b)!);
  if (!t || base.length < 4) return null;
  const drop = median(base) - pct(t)!;
  return drop >= 1.5 ? `body water ${r1(pct(t)!)}% on the scale (usually ${r1(median(base))}%)` : null;
}
