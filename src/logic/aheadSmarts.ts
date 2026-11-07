// Looking ahead, from the person's own data: a stall before it shows, tomorrow's weigh-in range, when appetite comes
// back across the shot week, what a short night does to eating, muscle going faster than it should, what each
// habit is worth in days to the goal, and when cravings usually hit. Each is a forecast with its reasons, never a
// change to a medicine. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, FoodLog, Medication, Workout } from '../db/schema';
import { leanOf } from './bodyComp';
import type { WeightTrend } from './bodyModel';
import { inGroup } from './interactions';
import { dayKey } from './stats';
import type { ScheduleSettings } from './schedule';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
const ms = (d: string) => new Date(`${d}T12:00`).getTime();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const KCAL_PER_KG = 7700;

/** Each day's food totals (only days with 2+ logs: a day with one log is a day not logged, not a light day). */
function foodDays(logs: FoodLog[], s: ScheduleSettings) {
  const m = new Map<string, { n: number; kcal: number; sodium: number; carbs: number }>();
  for (const l of logs) {
    if (!live(l)) continue;
    const k = dayKey(Date.parse(l.at), s);
    const d = m.get(k) ?? { n: 0, kcal: 0, sodium: 0, carbs: 0 };
    d.n++; d.kcal += l.nutrients.kcal ?? 0; d.sodium += l.nutrients.sodium ?? 0; d.carbs += l.nutrients.carbs ?? 0;
    m.set(k, d);
  }
  return m;
}
const slopePerDay = (pts: { t: number; v: number }[]) => {
  if (pts.length < 4) return undefined;
  const mt = mean(pts.map((p) => p.t)), mv = mean(pts.map((p) => p.v));
  let a = 0, b = 0; for (const p of pts) { a += (p.t - mt) * (p.v - mv); b += (p.t - mt) ** 2; }
  return b ? (a / b) * DAY : undefined;
};

// ── 1. A plateau before it shows ───────────────────────────────────────────────────────────────────────

export interface PlateauAhead { level: 'rising' | 'high'; reasons: string[]; fixes: string[]; shrinkPct: number }

/** The daily gap that drives loss, against what has eaten into it over the last 2 weeks (compared with the 4 weeks
 *  before): fewer steps, more eaten, and a lighter body burning less. When a third or more of it has gone, a stall
 *  is likely within a week or two, often before the scale shows it. */
export function plateauAhead(x: { trend: WeightTrend | null; daily: DailyHealth[]; foodLogs: FoodLog[] }, now: number, s: ScheduleSettings): PlateauAhead | null {
  const tr = x.trend;
  if (!tr || tr.perWeek > -0.15) return null;
  const gap = (-tr.perWeek / 7) * KCAL_PER_KG; // a day
  const win = (from: number, to: number) => (d: { date: string }) => ms(d.date) > now - to * DAY && ms(d.date) <= now - from * DAY;
  const steps = (from: number, to: number) => x.daily.filter(live).filter(win(from, to)).map((d) => d.steps).filter((v): v is number => typeof v === 'number');
  const sNow = steps(0, 14), sBefore = steps(14, 42);
  const fd = foodDays(x.foodLogs, s);
  const eaten = (from: number, to: number) => [...fd].filter(([k, d]) => d.n >= 2 && win(from, to)({ date: k })).map(([, d]) => d.kcal);
  const eNow = eaten(0, 14), eBefore = eaten(14, 42);
  const reasons: string[] = [], fixes: string[] = [];
  let shrink = 0;
  if (sNow.length >= 7 && sBefore.length >= 10) {
    const drop = mean(sBefore) - mean(sNow);
    if (drop >= 1000) {
      const kcal = drop * tr.trend * 0.0005;
      shrink += kcal;
      reasons.push(`steps down about ${(Math.round(drop / 100) * 100).toLocaleString('en-AU')} a day (${Math.round(kcal)} Cal less burned)`);
      fixes.push(`steps back to about ${(Math.round(mean(sBefore) / 500) * 500).toLocaleString('en-AU')} a day`);
    }
  }
  if (eNow.length >= 5 && eBefore.length >= 8) {
    const rise = mean(eNow) - mean(eBefore);
    if (rise >= 120) { shrink += rise; reasons.push(`eating about ${Math.round(rise / 10) * 10} Cal a day more than a month ago`); fixes.push(`back to about ${(Math.round(mean(eBefore) / 50) * 50).toLocaleString('en-AU')} Cal a day`); }
  }
  // A lighter body burns less: about 22 Cal a day per kg lost over the 6 weeks.
  const pts = tr.points.filter((p) => p.t > now - 42 * DAY);
  if (pts.length >= 10) {
    const lost = pts[0].trend - pts[pts.length - 1].trend;
    if (lost > 1) { const kcal = lost * 22; shrink += kcal; reasons.push(`${r1(lost)} kg lighter, so about ${Math.round(kcal)} Cal less burned a day (expected)`); }
  }
  const pct = gap > 0 ? shrink / gap : 0;
  if (pct < 0.3 || reasons.length < 1 || (reasons.length === 1 && !fixes.length)) return null;
  return { level: pct >= 0.5 ? 'high' : 'rising', reasons, fixes, shrinkPct: Math.round(pct * 100) };
}

// ── 2. Tomorrow's weigh-in ─────────────────────────────────────────────────────────────────────────────

export interface NextWeighIn { mid: number; lo: number; hi: number; nudges: string[] }

/** The true weight a day on, plus what today is likely to add as water (salt and carbs above your usual, a strength
 *  session, alcohol, a short night), with the scatter your own weigh-ins usually have around the trend. */
export function nextWeighIn(x: { trend: WeightTrend | null; foodLogs: FoodLog[]; workouts: Workout[]; checkIns: CheckIn[]; daily: DailyHealth[] }, now: number, s: ScheduleSettings): NextWeighIn | null {
  const tr = x.trend;
  if (!tr || tr.points.length < 10) return null;
  const res = tr.points.filter((p) => p.t > now - 35 * DAY).map((p) => p.raw - p.trend);
  const sd = Math.max(0.25, median(res.map(Math.abs)) * 1.4826);
  let mid = tr.trend + tr.perWeek / 7;
  const nudges: string[] = [];
  const today = dayKey(now, s);
  const fd = foodDays(x.foodLogs, s);
  const t = fd.get(today);
  const usual = [...fd].filter(([k, d]) => k !== today && d.n >= 2 && ms(k) > now - 21 * DAY);
  if (t && usual.length >= 5) {
    const na = t.sodium - median(usual.map(([, d]) => d.sodium));
    if (na >= 800) { const kg = Math.min(0.8, (na / 1500) * 0.25); mid += kg; nudges.push(`salty day (+${r1(kg)} kg water)`); }
    const cb = t.carbs - median(usual.map(([, d]) => d.carbs));
    if (cb >= 60) { const kg = Math.min(0.6, (cb / 100) * 0.15); mid += kg; nudges.push(`more carbs than usual (+${r1(kg)} kg)`); }
  }
  const start = new Date(`${today}T00:00`).getTime();
  if (x.workouts.some((w) => live(w) && Date.parse(w.startedAt) >= start && (w.sets?.length ?? 0) > 0)) { mid += 0.3; nudges.push('strength session (+0.3 kg, muscles hold water)'); }
  if (x.checkIns.some((c) => live(c) && Date.parse(c.at) >= start && c.chips.includes('Alcohol'))) { mid += 0.2; nudges.push('alcohol (+0.2 kg)'); }
  return { mid: r1(mid), lo: r1(mid - sd * 1.3), hi: r1(mid + sd * 1.3), nudges };
}

// ── 3. Appetite across the shot week ───────────────────────────────────────────────────────────────────

export interface HungerWeek {
  /** Day 0 is shot day. Appetite (1–5, from check-ins) and calories eaten, where there's enough. */
  byDay: { day: number; appetite?: number; kcal?: number }[];
  peakDays: number[];
  /** The next day appetite is likely back (start of day), and how much more is usually eaten then. */
  nextPeak?: number; extraKcal?: number;
}

export function hungerWeek(x: { checkIns: CheckIn[]; foodLogs: FoodLog[]; doses: Dose[]; meds: Medication[] }, now: number, s: ScheduleSettings): HungerWeek | null {
  const glp = new Set(x.meds.filter((m) => !m.archived && inGroup(m, 'glp1')).map((m) => m.id));
  const shots = x.doses.filter((d) => live(d) && !d.skipped && glp.has(d.medicationId)).map((d) => Date.parse(d.takenAt)).filter((t) => t <= now).sort((a, b) => a - b);
  if (shots.length < 4) return null;
  const gaps = shots.slice(1).map((t, i) => (t - shots[i]) / DAY);
  if (median(gaps) < 5 || median(gaps) > 9) return null; // weekly only
  const dayIdx = (t: number) => { const last = [...shots].reverse().find((x) => x <= t); return last === undefined ? -1 : Math.floor((t - last) / DAY); };
  const app: number[][] = Array.from({ length: 7 }, () => []), kc: number[][] = Array.from({ length: 7 }, () => []);
  for (const c of x.checkIns) if (live(c) && typeof c.appetite === 'number' && Date.parse(c.at) > now - 70 * DAY) { const i = dayIdx(Date.parse(c.at)); if (i >= 0 && i < 7) app[i].push(c.appetite); }
  for (const [k, d] of foodDays(x.foodLogs, s)) if (d.n >= 2 && ms(k) > now - 70 * DAY && k !== dayKey(now, s)) { const i = dayIdx(ms(k)); if (i >= 0 && i < 7) kc[i].push(d.kcal); }
  const byDay = Array.from({ length: 7 }, (_, i) => ({ day: i, appetite: app[i].length >= 2 ? r1(mean(app[i])) : undefined, kcal: kc[i].length >= 2 ? Math.round(mean(kc[i])) : undefined }));
  const useA = byDay.filter((d) => d.appetite !== undefined).length >= 4, useK = byDay.filter((d) => d.kcal !== undefined).length >= 4;
  if (!useA && !useK) return null;
  const z = (vals: (number | undefined)[]) => { const v = vals.filter((x): x is number => x !== undefined); const m = mean(v), sdv = Math.sqrt(mean(v.map((x) => (x - m) ** 2))) || 1; return vals.map((x) => (x === undefined ? undefined : (x - m) / sdv)); };
  const za = useA ? z(byDay.map((d) => d.appetite)) : [], zk = useK ? z(byDay.map((d) => d.kcal)) : [];
  const score = byDay.map((_, i) => { const p = [za[i], zk[i]].filter((v): v is number => v !== undefined); return p.length ? mean(p) : -Infinity; });
  const top = Math.max(...score);
  if (top < 0.6) return null;
  const peakDays = score.map((v, i) => ({ v, i })).filter((p) => p.v >= top - 0.35 && p.v > 0.3).map((p) => p.i);
  const last = shots[shots.length - 1];
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const next = peakDays.map((d) => { const t = new Date(last + d * DAY); t.setHours(0, 0, 0, 0); let at = t.getTime(); while (at < today0.getTime()) at += 7 * DAY; return at; }).sort((a, b) => a - b)[0];
  const ks = byDay.filter((d) => d.kcal !== undefined);
  const extra = useK ? Math.round(mean(peakDays.map((i) => byDay[i].kcal).filter((v): v is number => v !== undefined)) - Math.min(...ks.map((d) => d.kcal!))) : undefined;
  return { byDay, peakDays, nextPeak: next, extraKcal: extra && extra >= 100 ? extra : undefined };
}

// ── 4. A short night and the day's eating ──────────────────────────────────────────────────────────────

export interface ShortNight { extra: number; lastNightShort: boolean; sleepMin?: number }

export function shortNightEating(x: { daily: DailyHealth[]; foodLogs: FoodLog[] }, now: number, s: ScheduleSettings): ShortNight | null {
  const fd = foodDays(x.foodLogs, s);
  const today = dayKey(now, s);
  const short: number[] = [], ok: number[] = [];
  for (const d of x.daily) {
    if (!live(d) || typeof d.sleepMin !== 'number' || d.date === today || ms(d.date) < now - 90 * DAY) continue;
    const f = fd.get(d.date);
    if (!f || f.n < 2) continue;
    if (d.sleepMin < 390) short.push(f.kcal); else if (d.sleepMin >= 420) ok.push(f.kcal);
  }
  if (short.length < 4 || ok.length < 6) return null;
  const extra = Math.round((mean(short) - mean(ok)) / 10) * 10;
  if (extra < 120) return null;
  const t = x.daily.find((d) => live(d) && d.date === today);
  return { extra, lastNightShort: typeof t?.sleepMin === 'number' && t.sleepMin < 390, sleepMin: t?.sleepMin };
}

// ── 5. Muscle going faster than it should ──────────────────────────────────────────────────────────────

export interface MuscleWarning { share: number; expected: number; reasons: string[]; fixes: string[]; kgLost: number; leanLost: number }

/** Over the last 5 weeks on the scale: the share of the loss that was lean (or muscle) mass against what's expected
 *  for the fat there is to lose (Forbes). Scales swing with water, so only with 5+ readings and 1.5 kg+ lost. */
export function muscleWarning(x: { body: BodyEntry[]; daily: DailyHealth[]; workouts: Workout[]; proteinTarget: number | null }, now: number): MuscleWarning | null {
  const rows = x.body.filter((b) => live(b) && typeof b.weightKg === 'number' && ms(b.date) > now - 35 * DAY);
  // Only readings with both weight and body fat %, so lean and fat come from the same weigh-in (mixing in another
  // app's lean figure or skeletal muscle made lean look like it fell as fast as weight).
  const comp = rows.filter((b) => typeof b.bodyFatPct === 'number').sort((a, b) => a.date.localeCompare(b.date));
  if (comp.length < 6 || ms(comp[comp.length - 1]?.date ?? '') - ms(comp[0]?.date ?? '') < 21 * DAY) return null;
  const sw = slopePerDay(comp.map((b) => ({ t: ms(b.date), v: b.weightKg! })));
  const sl = slopePerDay(comp.map((b) => ({ t: ms(b.date), v: leanOf(b)! })));
  if (sw === undefined || sl === undefined) return null;
  const kgLost = -sw * 35, leanLost = -sl * 35;
  if (kgLost < 1.5) return null;
  // Lean "lost" faster than weight is the scale's water swings, not muscle: no call.
  if (leanLost > kgLost) return null;
  const share = Math.max(0, leanLost / kgLost);
  const fat = rows.filter((b) => typeof b.bodyFatPct === 'number').sort((a, b) => b.date.localeCompare(a.date))[0];
  const fatKg = fat ? (fat.weightKg! * fat.bodyFatPct!) / 100 : rows[0].weightKg! * 0.3;
  const expected = 10.4 / (10.4 + fatKg);
  if (share < 0.3 || share < expected + 0.15) return null;
  const reasons: string[] = [], fixes: string[] = [];
  const prot = x.daily.filter((d) => live(d) && typeof d.proteinG === 'number' && ms(d.date) > now - 21 * DAY).map((d) => d.proteinG!);
  if (x.proteinTarget && prot.length >= 7 && mean(prot) < x.proteinTarget * 0.85) { reasons.push(`protein averaging ${Math.round(mean(prot))} g (target ${x.proteinTarget})`); fixes.push(`protein up to ${x.proteinTarget} g a day`); }
  const strength = x.workouts.filter((w) => live(w) && (w.sets?.length ?? 0) > 0 && Date.parse(w.startedAt) > now - 28 * DAY).length;
  if (strength < 8) { reasons.push(`${strength ? `${Math.round((strength / 4) * 10) / 10} strength sessions a week` : 'no strength sessions'} in the last 4 weeks`); fixes.push('2 to 3 strength sessions a week'); }
  if (kgLost / 5 > 1.2) { reasons.push(`losing fast (${r1(kgLost / 5)} kg a week)`); fixes.push('a slightly slower pace'); }
  return { share: Math.round(share * 100) / 100, expected: Math.round(expected * 100) / 100, reasons, fixes, kgLost: r1(kgLost), leanLost: r1(leanLost) };
}

// ── 7. Personal levers: each habit in days to the goal ─────────────────────────────────────────────────

export interface Lever { what: string; days: number }

/** Each habit kept up for a month, in days closer to the goal at the current pace: 10,000 steps a day (against
 *  your usual steps), eating to your calorie target (against what you usually eat), no 300 Cal snack, a 45-minute
 *  walk. (One day of any of them is a fraction of a day: a month is what shows.) */
export function personalLevers(x: { trend: WeightTrend | null; daily: DailyHealth[]; foodLogs: FoodLog[]; target: number | null }, now: number, s: ScheduleSettings): Lever[] {
  const tr = x.trend;
  if (!tr || tr.perWeek > -0.1) return [];
  const kgPerDay = -tr.perWeek / 7;
  const days = (kcal: number) => Math.round((kcal * 30) / KCAL_PER_KG / kgPerDay);
  const out: Lever[] = [];
  const steps = x.daily.filter((d) => live(d) && typeof d.steps === 'number' && ms(d.date) > now - 28 * DAY).map((d) => d.steps!);
  if (steps.length >= 10) { const extra = 10_000 - median(steps); if (extra >= 1500) out.push({ what: `10,000 steps a day (you usually do ${(Math.round(median(steps) / 100) * 100).toLocaleString('en-AU')})`, days: days(extra * tr.trend * 0.0005) }); }
  const fd = [...foodDays(x.foodLogs, s)].filter(([k, d]) => d.n >= 2 && ms(k) > now - 28 * DAY).map(([, d]) => d.kcal);
  if (x.target && fd.length >= 7 && mean(fd) - x.target >= 150) out.push({ what: `eating to your ${x.target.toLocaleString('en-AU')} Cal target (you average ${(Math.round(mean(fd) / 10) * 10).toLocaleString('en-AU')})`, days: days(mean(fd) - x.target) });
  out.push({ what: 'one 300 Cal snack fewer a day', days: days(300) });
  out.push({ what: 'a 45-minute brisk walk a day', days: days(2.5 * tr.trend * 0.75) });
  return out.filter((l) => l.days >= 1).sort((a, b) => b.days - a.days);
}

// ── 8. When cravings hit ───────────────────────────────────────────────────────────────────────────────

export interface CravingForecast {
  /** The 2-hour window cravings most often start in (any day), its share, and today's if today's weekday has one. */
  usual: { hour: number; share: number };
  today?: { hour: number; count: number };
  events: number;
}

export function cravingForecast(x: { checkIns: CheckIn[]; foodLogs: FoodLog[] }, now: number): CravingForecast | null {
  const ev = [
    ...x.checkIns.filter((c) => live(c) && c.chips.some((ch) => /crav/i.test(ch))).map((c) => Date.parse(c.at)),
    ...x.foodLogs.filter((l) => live(l) && l.why === 'craving').map((l) => Date.parse(l.at)),
  ].filter((t) => t > now - 56 * DAY && t <= now);
  if (ev.length < 5) return null;
  const bin = (t: number) => Math.floor(new Date(t).getHours() / 2) * 2;
  const counts = new Map<number, number>();
  for (const t of ev) counts.set(bin(t), (counts.get(bin(t)) ?? 0) + 1);
  const [hour, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const share = n / ev.length;
  if (share < 0.35) return null;
  const wd = new Date(now).getDay();
  const same = ev.filter((t) => new Date(t).getDay() === wd);
  const byWd = new Map<number, Set<string>>();
  for (const t of same) { const b = bin(t); const set = byWd.get(b) ?? new Set(); set.add(new Date(t).toDateString()); byWd.set(b, set); }
  const todayTop = [...byWd].map(([h, set]) => ({ hour: h, count: set.size })).sort((a, b) => b.count - a.count)[0];
  return { usual: { hour, share: Math.round(share * 100) / 100 }, today: todayTop && todayTop.count >= 2 ? todayTop : undefined, events: ev.length };
}

export const fmtHour = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
