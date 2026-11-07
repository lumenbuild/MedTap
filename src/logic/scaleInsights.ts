// What a smart scale's full readings say, beyond the numbers themselves: what the loss has been made of (fat against
// lean), fat's pace and when it reaches a healthy range, what the goal weight means for body fat, recomposition when
// the scale stalls, what protects muscle in the person's own weeks, how much of today's reading is water, and where
// metabolic age and visceral fat land at the goal. Scales estimate composition from a small current, so everything
// is from trends over weeks, never one reading. Pure.
import type { BodyEntry, DailyHealth, Workout } from '../db/schema';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const ms = (d: string) => new Date(`${d}T12:00`).getTime();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v: number) => Math.round(v * 10) / 10;

function fit(pts: { x: number; y: number }[]): { slope: number; at: (x: number) => number; r2: number } | null {
  if (pts.length < 3) return null;
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, at: (x) => my + slope * (x - mx), r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** Each reading with weight and body fat as fat and lean kg: lean is that reading's weight minus its fat, so the two
 *  always add up to the weight (another app's separate lean figure, taken at another moment, would not). */
export interface Comp { t: number; date: string; kg: number; fat: number; lean: number; bf: number }
export function comps(body: BodyEntry[]): Comp[] {
  return body.filter((b) => live(b) && typeof b.weightKg === 'number' && typeof b.bodyFatPct === 'number')
    .map((b) => { const fat = (b.weightKg! * b.bodyFatPct!) / 100; return { t: ms(b.date), date: b.date, kg: b.weightKg!, fat, lean: b.weightKg! - fat, bf: b.bodyFatPct! }; })
    .sort((a, b) => a.t - b.t);
}

// ── What the loss has been made of ─────────────────────────────────────────────────────────────────────

export interface LossMix {
  since: string; kgLost: number; fatLost: number; leanLost: number;
  /** Week by week (oldest first): fat and lean change against the week before. */
  weeks: { start: number; fat: number; lean: number }[];
}

/** From the first readings to the latest (the median of the first and last 3, to steady the scale's swings). */
export function lossMix(body: BodyEntry[], now: number, days = 180): LossMix | null {
  const c = comps(body).filter((x) => x.t > now - days * DAY);
  if (c.length < 6) return null;
  const head = c.slice(0, 3), tail = c.slice(-3);
  const m = (xs: Comp[], k: 'kg' | 'fat' | 'lean') => median(xs.map((x) => x[k]));
  const kgLost = r1(m(head, 'kg') - m(tail, 'kg')), fatLost = r1(m(head, 'fat') - m(tail, 'fat')), leanLost = r1(m(head, 'lean') - m(tail, 'lean'));
  if (Math.abs(kgLost) < 1) return null;
  // Weeks (Monday start) over the last 9, each its median.
  const wk = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const by = new Map<number, Comp[]>();
  for (const x of c.filter((x) => x.t > now - 63 * DAY)) by.set(wk(x.t), [...(by.get(wk(x.t)) ?? []), x]);
  const ws = [...by].sort((a, b) => a[0] - b[0]).map(([start, xs]) => ({ start, fat: median(xs.map((x) => x.fat)), lean: median(xs.map((x) => x.lean)) }));
  const weeks = ws.slice(1).map((w, i) => ({ start: w.start, fat: r1(w.fat - ws[i].fat), lean: r1(w.lean - ws[i].lean) }));
  return { since: c[0].date, kgLost, fatLost, leanLost, weeks };
}

// ── Fat: pace, healthy range, and the goal weight ──────────────────────────────────────────────────────

export interface FatForecast {
  bf: number; fatKg: number; leanKg: number;
  /** kg of fat a week (negative: losing), from the last 8 weeks. */
  fatPerWeek?: number;
  /** The top of the healthy range for this person, and when the fat reaches it at this pace (keeping the lean). */
  healthyBf: number; healthyBy?: number; healthyKg: number;
  /** Body fat at the goal weight: keeping all the lean mass, and at the lean share of the loss so far. */
  atGoal?: { kg: number; keepAll: number; atShare: number; share: number; tooLean: boolean; sensibleKg: number;
    /** The goal is below what keeping all the lean mass allows: at least this much lean would have to go. */
    leanMustGo?: number };
}

/** Healthy body fat (upper end): men 25%, women 32%; unknown 28%. The lowest sensible: men 10%, women 18%. */
const TOP = { m: 25, f: 32, x: 28 }, LOW = { m: 10, f: 18, x: 14 };

export function fatForecast(body: BodyEntry[], sex: 'm' | 'f' | undefined, goalKg: number | undefined, now: number): FatForecast | null {
  const c = comps(body);
  const recent = c.filter((x) => x.t > now - 56 * DAY);
  if (recent.length < 4) return null;
  const last = recent.slice(-3);
  const fatKg = median(last.map((x) => x.fat)), leanKg = median(last.map((x) => x.lean)), kg = fatKg + leanKg;
  const bf = r1((fatKg / kg) * 100);
  const f = fit(recent.map((x) => ({ x: x.t, y: x.fat })));
  const fatPerWeek = f && recent[recent.length - 1].t - recent[0].t > 14 * DAY ? r1(f.slope * 7 * DAY) : undefined;
  const k = sex ?? 'x';
  const healthyBf = TOP[k];
  const healthyFat = (leanKg * healthyBf) / (100 - healthyBf);
  const healthyKg = r1(leanKg + healthyFat);
  const healthyBy = fatPerWeek !== undefined && fatPerWeek < -0.05 && fatKg > healthyFat ? now + ((fatKg - healthyFat) / -fatPerWeek) * 7 * DAY : undefined;
  const out: FatForecast = { bf, fatKg: r1(fatKg), leanKg: r1(leanKg), fatPerWeek, healthyBf, healthyBy, healthyKg };
  if (goalKg && goalKg < kg) {
    const mix = lossMix(body, now);
    const share = mix && mix.kgLost > 2 ? Math.max(0, Math.min(0.5, mix.leanLost / mix.kgLost)) : 0.25;
    const keepAll = Math.max(0, ((goalKg - leanKg) / goalKg) * 100);
    const leanAt = leanKg - share * (kg - goalKg);
    const atShare = Math.max(0, ((goalKg - leanAt) / goalKg) * 100);
    const sensibleKg = r1(leanKg / (1 - LOW[k] / 100));
    // Too lean: even at the loss's usual mix, the goal is under the lowest sensible body fat.
    const tooLean = atShare < LOW[k];
    const leanMustGo = keepAll < LOW[k] ? r1(leanKg - goalKg * (1 - LOW[k] / 100)) : undefined;
    out.atGoal = { kg: goalKg, keepAll: r1(keepAll), atShare: r1(atShare), share: Math.round(share * 100) / 100, tooLean, sensibleKg, leanMustGo };
  }
  return out;
}

// ── Recomposition ──────────────────────────────────────────────────────────────────────────────────────

export interface Recomp { weeks: number; kgPerWeek: number; fat: number; lean: number }

/** The scale's weight steady while fat falls and lean rises (over 4 weeks): progress the weight hides. */
export function recomp(body: BodyEntry[], now: number): Recomp | null {
  const c = comps(body).filter((x) => x.t > now - 28 * DAY);
  if (c.length < 5 || c[c.length - 1].t - c[0].t < 18 * DAY) return null;
  const w = fit(c.map((x) => ({ x: x.t, y: x.kg }))), fa = fit(c.map((x) => ({ x: x.t, y: x.fat }))), le = fit(c.map((x) => ({ x: x.t, y: x.lean })));
  if (!w || !fa || !le) return null;
  const wk = 7 * DAY, kgPerWeek = w.slope * wk, fat = fa.slope * 28 * DAY, lean = le.slope * 28 * DAY;
  if (Math.abs(kgPerWeek) > 0.25 || fat > -0.5 || lean < 0.3) return null;
  return { weeks: 4, kgPerWeek: r1(kgPerWeek), fat: r1(fat), lean: r1(lean) };
}

// ── What protects muscle, in the person's own weeks ────────────────────────────────────────────────────

export interface MuscleEvidence { rows: { what: string; with: number; without: number; weeksWith: number; weeksWithout: number }[] }

/** Lean change a week in weeks with a habit against weeks without: protein at 90%+ of target, 2+ strength sessions. */
export function muscleEvidence(x: { body: BodyEntry[]; daily: DailyHealth[]; workouts: Workout[]; proteinTarget: number | null }, now: number): MuscleEvidence | null {
  const c = comps(x.body).filter((y) => y.t > now - 112 * DAY);
  const wk = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const by = new Map<number, number[]>();
  for (const y of c) by.set(wk(y.t), [...(by.get(wk(y.t)) ?? []), y.lean]);
  const ws = [...by].sort((a, b) => a[0] - b[0]).map(([start, l]) => ({ start, lean: median(l) }));
  if (ws.length < 7) return null;
  const weeks = ws.slice(1).map((w, i) => {
    const end = w.start + 7 * DAY;
    const prot = x.daily.filter((d) => live(d) && typeof d.proteinG === 'number' && ms(d.date) >= w.start && ms(d.date) < end).map((d) => d.proteinG!);
    const strength = x.workouts.filter((o) => live(o) && (o.sets?.length ?? 0) > 0 && Date.parse(o.startedAt) >= w.start && Date.parse(o.startedAt) < end).length;
    return { change: w.lean - ws[i].lean, protein: prot.length >= 4 ? mean(prot) : undefined, strength };
  });
  const rows: MuscleEvidence['rows'] = [];
  const compare = (what: string, has: (w: typeof weeks[number]) => boolean | undefined) => {
    const a = weeks.filter((w) => has(w) === true), b = weeks.filter((w) => has(w) === false);
    if (a.length >= 2 && b.length >= 2) rows.push({ what, with: r1(mean(a.map((w) => w.change))), without: r1(mean(b.map((w) => w.change))), weeksWith: a.length, weeksWithout: b.length });
  };
  if (x.proteinTarget) compare(`Protein at ${x.proteinTarget} g`, (w) => (w.protein === undefined ? undefined : w.protein >= x.proteinTarget! * 0.9));
  compare('2+ strength sessions', (w) => w.strength >= 2);
  return rows.length ? { rows } : null;
}

// ── Today's reading, and water ─────────────────────────────────────────────────────────────────────────

export interface TodayWater { kgOff: number; waterOff: number; bfOff?: number; text: string }

const waterKg = (b: BodyEntry) => b.waterKg ?? (typeof b.waterPct === 'number' && b.weightKg ? (b.waterPct * b.weightKg) / 100 : undefined);

/** Today's weight and body fat against the week before, and how much of the difference is body water. */
export function todayWater(body: BodyEntry[], today: string): TodayWater | null {
  const rows = body.filter((b) => live(b) && typeof b.weightKg === 'number');
  const t = rows.find((b) => b.date === today);
  const week = rows.filter((b) => b.date < today && ms(b.date) > ms(today) - 8 * DAY);
  if (!t || week.length < 3 || waterKg(t) === undefined) return null;
  const ws = week.map(waterKg).filter((v): v is number => v !== undefined);
  if (ws.length < 3) return null;
  const kgOff = r1(t.weightKg! - median(week.map((b) => b.weightKg!)));
  const waterOff = r1(waterKg(t)! - median(ws));
  const bfs = week.map((b) => b.bodyFatPct).filter((v): v is number => typeof v === 'number');
  const bfOff = typeof t.bodyFatPct === 'number' && bfs.length >= 3 ? r1(t.bodyFatPct - median(bfs)) : undefined;
  let text = '';
  if (Math.abs(kgOff) >= 0.5 && Math.sign(waterOff) === Math.sign(kgOff) && Math.abs(waterOff) >= 0.3) {
    text = `${Math.abs(waterOff) >= Math.abs(kgOff) ? 'All' : `About ${Math.abs(waterOff)} kg`} of today's ${kgOff > 0 ? '+' : '−'}${Math.abs(kgOff)} kg is body water${kgOff > 0 ? ': salt, carbs, a hard session or a sore muscle hold it' : ''}.`;
  } else if (bfOff !== undefined && bfOff >= 1 && waterOff <= -0.5) {
    text = `Body fat reads ${bfOff} points higher today with less water in you (${waterOff} kg): scales read fat higher when you're dry. Drink, and it comes back.`;
  } else if (bfOff !== undefined && bfOff <= -1 && waterOff >= 0.5) {
    text = `Body fat reads ${Math.abs(bfOff)} points lower today with more water in you: likely the water, not fat gone overnight.`;
  }
  return text ? { kgOff, waterOff, bfOff, text } : null;
}

// ── Metabolic age and visceral fat at the goal ─────────────────────────────────────────────────────────

export interface AtGoal { kg: number; metabolicAge?: { now: number; atGoal: number }; visceral?: { now: number; atGoal: number } }

/** From how the person's own metabolic age and visceral fat have moved with their weight (6+ readings over 3+ kg). */
export function atGoalWeight(body: BodyEntry[], goalKg: number | undefined, now: number): AtGoal | null {
  if (!goalKg) return null;
  const rows = body.filter((b) => live(b) && typeof b.weightKg === 'number' && ms(b.date) > now - 365 * DAY);
  const proj = (k: 'metabolicAge' | 'visceralFat', min: number) => {
    const pts = rows.filter((b) => typeof b[k] === 'number').map((b) => ({ x: b.weightKg!, y: b[k] as number }));
    if (pts.length < 6) return undefined;
    const xs = pts.map((p) => p.x);
    if (Math.max(...xs) - Math.min(...xs) < 3) return undefined;
    const f = fit(pts);
    if (!f || f.slope <= 0) return undefined;
    const latest = rows.filter((b) => typeof b[k] === 'number').sort((a, b) => b.date.localeCompare(a.date))[0];
    return { now: latest[k] as number, atGoal: Math.max(min, Math.round(f.at(goalKg))) };
  };
  const out: AtGoal = { kg: goalKg, metabolicAge: proj('metabolicAge', 18), visceral: proj('visceralFat', 1) };
  return out.metabolicAge || out.visceral ? out : null;
}

// ── Healthy ranges ─────────────────────────────────────────────────────────────────────────────────────

export type Band = 'low' | 'healthy' | 'high' | 'very high';
export function bodyFatBand(bf: number, sex: 'm' | 'f' | undefined): Band {
  const [lo, hi, vhi] = sex === 'f' ? [18, 32, 38] : sex === 'm' ? [10, 25, 30] : [14, 28, 34];
  return bf < lo ? 'low' : bf <= hi ? 'healthy' : bf <= vhi ? 'high' : 'very high';
}
export function waterBand(pct: number, sex: 'm' | 'f' | undefined): Band {
  const [lo, hi] = sex === 'f' ? [45, 60] : sex === 'm' ? [50, 65] : [47, 63];
  return pct < lo ? 'low' : pct <= hi ? 'healthy' : 'high';
}
