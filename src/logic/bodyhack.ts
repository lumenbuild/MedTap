// Biohacking tools, the body side: fluids and electrolytes (more after a GLP-1 shot, on training days and with a
// stimulant), a muscle-protection score while losing weight, gut symptoms and appetite by days since a shot, and the
// year in review. From the person's own records. Pure.
import type { BodyEntry, CheckIn, DailyHealth, Dose, LabResult, Medication, Workout } from '../db/schema';
import { inGroup } from './interactions';
import { isStimulant } from './stimulant';
import { appetiteCurve } from './predict';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { brainScore, brainTests } from './biohack';

const DAY = 86_400_000, WEEK = 7 * DAY;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (n: number) => Math.round(n * 10) / 10;
const live = (x: { deletedAt?: string }) => !x.deletedAt;
const taken = (d: Dose) => !d.deletedAt && !d.skipped;
const glp1 = (m: Medication) => inGroup(m, 'glp1');
const GUT = ['Nausea', 'Constipation', 'Reflux', 'Diarrhoea', 'Vomiting'];
const LOOSE = ['Nausea', 'Diarrhoea', 'Vomiting'];

// ── Fluids and electrolytes ─────────────────────────────────────────────────────────────────────────

export interface Fluids { ml: number; reasons: string[]; electrolytes: boolean; drunk?: number; low: boolean }

/** Today's water: the person's target, which already allows for what's in their stack (a GLP-1, a stimulant), plus
 *  what's only about today: 500 mL on a training day and 250 mL in the 2 days after a GLP-1 shot (never more than
 *  750 mL over the target). With no target, 2 L and the stack's own extras. Electrolytes after a shot, with nausea or
 *  diarrhoea, or training. Low: under 40% of it by 3 pm. */
export function fluids(meds: Medication[], doses: Dose[], workouts: Workout[], checkIns: CheckIn[], daily: DailyHealth[], base: number | null, now: number, s: ScheduleSettings): Fluids {
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const g = new Set(meds.filter((m) => !m.archived && glp1(m)).map((m) => m.id));
  const st = new Set(meds.filter((m) => !m.archived && isStimulant(m)).map((m) => m.id));
  const reasons: string[] = [];
  let ml = base ?? 2000;
  const shot = doses.filter((d) => taken(d) && g.has(d.medicationId) && Date.parse(d.takenAt) <= now && Date.parse(d.takenAt) > start - 2 * DAY).length > 0;
  if (shot) { ml += base === null ? 500 : 250; reasons.push('the days after a shot'); }
  const trained = workouts.some((w) => live(w) && !(w.source === 'health' && w.cardio?.activity === 'walk') && Date.parse(w.startedAt) >= start && Date.parse(w.startedAt) <= now);
  if (trained) { ml += 500; reasons.push('training today'); }
  // A stimulant's extra is already in a worked-out target.
  if (base === null && doses.some((d) => taken(d) && st.has(d.medicationId) && Date.parse(d.takenAt) >= start)) { ml += 250; reasons.push('a stimulant today'); }
  if (base !== null) ml = Math.min(ml, base + 750);
  const gutToday = checkIns.some((c) => live(c) && Date.parse(c.at) >= start && c.chips.some((x) => LOOSE.includes(x)));
  if (gutToday) reasons.push('nausea or an upset stomach');
  const drunk = daily.find((x) => live(x) && x.date === dayKey(now, s))?.waterMl;
  const afternoon = (now - start) / 3_600_000 >= 11; // 3 pm with a 4 am day start
  return { ml: Math.round(ml / 50) * 50, reasons, electrolytes: shot || gutToday || trained, drunk, low: afternoon && (drunk ?? 0) < ml * 0.4 };
}

// ── Muscle protection ───────────────────────────────────────────────────────────────────────────────

export interface MuscleScore { score: number; label: string; parts: { what: string; text: string; points: number; of: number }[] }

/** 0–100 while losing weight: protein against the target (40), strength sessions (30: two a week is full marks) and
 *  the rate of loss (30: up to 1% of body weight a week is full; 2% none), less up to 15 when lean mass is falling
 *  faster than a quarter of the weight lost. */
export function muscleScore(body: BodyEntry[], daily: DailyHealth[], workouts: Workout[], proteinTarget: number | null, now: number): MuscleScore | null {
  const weights = body.filter((b) => live(b) && typeof b.weightKg === 'number').map((b) => ({ t: new Date(`${b.date}T12:00`).getTime(), v: b.weightKg! })).sort((a, b) => a.t - b.t);
  const recent = weights.filter((w) => w.t > now - 28 * DAY);
  if (recent.length < 2) return null;
  const kg = recent[recent.length - 1].v;
  const target = proteinTarget ?? Math.round(kg * 1.6);
  const prot = daily.filter((x) => live(x) && x.proteinG && new Date(`${x.date}T12:00`).getTime() > now - 7 * DAY).map((x) => x.proteinG!);
  const parts: MuscleScore['parts'] = [];
  let score = 0, max = 0;
  if (prot.length >= 3) { const p = Math.min(1, mean(prot) / target); score += 40 * p; max += 40; parts.push({ what: 'Protein', text: `${Math.round(mean(prot))} of ${target} g a day`, points: Math.round(40 * p), of: 40 }); }
  const strength = workouts.filter((w) => live(w) && !w.cardio && w.sets.some((x) => x.done) && Date.parse(w.startedAt) > now - 14 * DAY).length;
  { const p = Math.min(1, strength / 4); score += 30 * p; max += 30; parts.push({ what: 'Strength training', text: `${strength} session${strength === 1 ? '' : 's'} in 2 weeks`, points: Math.round(30 * p), of: 30 }); }
  const span = (recent[recent.length - 1].t - recent[0].t) / WEEK;
  if (span >= 1) {
    const pct = ((recent[0].v - kg) / recent[0].v / span) * 100;
    const p = pct <= 1 ? 1 : pct >= 2 ? 0 : 2 - pct;
    score += 30 * p; max += 30; parts.push({ what: 'Rate of loss', text: `${r1(Math.max(0, pct))}% of body weight a week`, points: Math.round(30 * p), of: 30 });
  }
  const lean = body.filter((b) => live(b) && typeof b.leanKg === 'number' && typeof b.weightKg === 'number').sort((a, b) => a.date.localeCompare(b.date));
  if (lean.length >= 2) {
    const a = lean[0], b = lean[lean.length - 1];
    const lost = a.weightKg! - b.weightKg!, leanLost = a.leanKg! - b.leanKg!;
    if (lost > 1 && leanLost / lost > 0.25) { const pen = Math.min(15, Math.round((leanLost / lost - 0.25) * 60)); score -= pen; parts.push({ what: 'Lean mass', text: `${Math.round((leanLost / lost) * 100)}% of the weight lost was lean`, points: -pen, of: 0 }); }
  }
  if (!max) return null;
  const v = Math.round(Math.max(0, Math.min(100, (score / max) * 100)));
  return { score: v, label: v >= 75 ? 'Well protected' : v >= 50 ? 'Partly protected' : 'At risk', parts };
}

// ── Gut and appetite by days since a shot ───────────────────────────────────────────────────────────

export interface GutDay { day: number; checkIns: number; chips: { chip: string; pct: number }[] }

/** Each day after a shot (up to the usual gap): the share of check-ins noting each gut symptom. Needs 10+ check-ins. */
export function gutByShotDay(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number): GutDay[] | null {
  const shots = doses.filter((d) => taken(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 84 * DAY).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  if (shots.length < 3) return null;
  const gaps = shots.slice(1).map((t, i) => Math.round((t - shots[i]) / DAY));
  const gap = Math.max(2, Math.min(7, Math.round(mean(gaps))));
  const rows = Array.from({ length: gap }, (_, day) => ({ day, cis: [] as CheckIn[] }));
  for (const c of checkIns.filter((x) => live(x) && Date.parse(x.at) >= shots[0] && Date.parse(x.at) <= now)) {
    const t = Date.parse(c.at);
    const last = [...shots].reverse().find((s) => s <= t)!;
    const day = Math.floor((t - last) / DAY);
    if (day < gap) rows[day].cis.push(c);
  }
  if (rows.reduce((n, r) => n + r.cis.length, 0) < 10) return null;
  return rows.map((r) => ({ day: r.day, checkIns: r.cis.length,
    chips: GUT.map((chip) => ({ chip, pct: r.cis.length ? Math.round((r.cis.filter((c) => c.chips.includes(chip)).length / r.cis.length) * 100) : 0 })).filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct) }));
}

export interface AppetiteAhead { day: number; at: number; appetite: number; today?: number }

/** When appetite usually comes back after a shot: the first day after today (in this gap) at 60% of the way from the
 *  week's lowest to its highest. */
export function appetiteAhead(med: Medication, doses: Dose[], checkIns: CheckIn[], now: number): AppetiteAhead | null {
  const c = appetiteCurve(med, doses, checkIns, now);
  if (!c || c.today === undefined) return null;
  const known = c.days.filter((d) => d.appetite !== undefined) as { day: number; appetite: number }[];
  if (known.length < 3) return null;
  const lo = Math.min(...known.map((d) => d.appetite)), hi = Math.max(...known.map((d) => d.appetite));
  if (hi - lo < 0.6) return null;
  const line = lo + (hi - lo) * 0.6;
  const back = known.find((d) => d.day > c.today! && d.appetite >= line);
  if (!back) return null;
  const last = doses.filter((d) => taken(d) && d.medicationId === med.id && Date.parse(d.takenAt) <= now).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  return { day: back.day, at: Date.parse(last.takenAt) + back.day * DAY, appetite: back.appetite, today: c.todayAppetite };
}

// ── The year in review ──────────────────────────────────────────────────────────────────────────────

export interface YearReview {
  from: number; to: number;
  doses: { med: Medication; taken: number; share?: number }[];
  weight?: { from: number; to: number; lowest: number };
  bestMonth?: { label: string; kg: number };
  sleepH?: number; steps?: number; restingHr?: { from: number; to: number };
  focus?: number; brain?: { first: number; last: number; tests: number };
  topChips: { chip: string; n: number }[];
  labs: { name: string; from: string; to: string }[];
  workouts: number; checkIns: number;
}

/** The last 12 months on one page. */
export function yearReview(d: { meds: Medication[]; doses: Dose[]; body: BodyEntry[]; daily: DailyHealth[]; checkIns: CheckIn[]; workouts: Workout[]; labs: LabResult[] }, now: number): YearReview {
  const from = now - 365 * DAY;
  const inYear = (t: number) => t >= from && t <= now;
  const doses = d.meds.filter((m) => !m.archived).map((m) => {
    const mine = d.doses.filter((x) => x.medicationId === m.id && !x.deletedAt && inYear(Date.parse(x.takenAt)));
    const t = mine.filter((x) => !x.skipped).length;
    return { med: m, taken: t, share: m.schedule.type !== 'prn' && mine.length ? Math.round((t / mine.length) * 100) : undefined };
  }).filter((x) => x.taken > 0).sort((a, b) => b.taken - a.taken);
  const w = d.body.filter((b) => live(b) && typeof b.weightKg === 'number' && inYear(new Date(`${b.date}T12:00`).getTime())).sort((a, b) => a.date.localeCompare(b.date));
  const weight = w.length >= 2 ? { from: w[0].weightKg!, to: w[w.length - 1].weightKg!, lowest: Math.min(...w.map((x) => x.weightKg!)) } : undefined;
  let bestMonth: YearReview['bestMonth'];
  const byMonth = new Map<string, number[]>();
  for (const x of w) { const k = x.date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), x.weightKg!]); }
  for (const [k, v] of byMonth) if (v.length >= 2) { const kg = r1(v[0] - v[v.length - 1]); if (kg > 0 && (!bestMonth || kg > bestMonth.kg)) bestMonth = { label: new Date(`${k}-15T12:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }), kg }; }
  const days = d.daily.filter((x) => live(x) && inYear(new Date(`${x.date}T12:00`).getTime())).sort((a, b) => a.date.localeCompare(b.date));
  const sl = days.map((x) => x.sleepMin).filter((x): x is number => !!x), st = days.map((x) => x.steps).filter((x): x is number => !!x);
  const hr = days.filter((x) => x.restingHr);
  const q = (xs: DailyHealth[]) => Math.round(mean(xs.map((x) => x.restingHr!)));
  const cis = d.checkIns.filter((c) => live(c) && inYear(Date.parse(c.at)));
  const fo = cis.map((c) => c.focus).filter((x): x is number => typeof x === 'number');
  const tests = brainTests(cis);
  const chips = new Map<string, number>();
  for (const c of cis) for (const ch of c.chips) chips.set(ch, (chips.get(ch) ?? 0) + 1);
  const labs: YearReview['labs'] = [];
  const byName = new Map<string, LabResult[]>();
  for (const l of d.labs.filter((x) => live(x) && inYear(new Date(`${x.date}T12:00`).getTime()))) byName.set(l.name, [...(byName.get(l.name) ?? []), l]);
  for (const [name, xs] of byName) if (xs.length >= 2) { const o = [...xs].sort((a, b) => a.date.localeCompare(b.date)); labs.push({ name, from: `${o[0].value}${o[0].unit ? ` ${o[0].unit}` : ''}`, to: `${o[o.length - 1].value}${o[o.length - 1].unit ? ` ${o[o.length - 1].unit}` : ''}` }); }
  const first5 = tests.slice(0, 5).map((c) => brainScore(c)!), last5 = tests.slice(-5).map((c) => brainScore(c)!);
  return {
    from, to: now, doses, weight, bestMonth,
    sleepH: sl.length >= 14 ? r1(mean(sl) / 60) : undefined, steps: st.length >= 14 ? Math.round(mean(st)) : undefined,
    restingHr: hr.length >= 28 ? { from: q(hr.slice(0, 14)), to: q(hr.slice(-14)) } : undefined,
    focus: fo.length >= 10 ? r1(mean(fo)) : undefined,
    brain: tests.length >= 10 ? { first: Math.round(mean(first5)), last: Math.round(mean(last5)), tests: tests.length } : undefined,
    topChips: [...chips].map(([chip, n]) => ({ chip, n })).sort((a, b) => b.n - a.n).slice(0, 5),
    labs, workouts: d.workouts.filter((x) => live(x) && inYear(Date.parse(x.startedAt))).length, checkIns: cis.length,
  };
}
