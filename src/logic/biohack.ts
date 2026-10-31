// Biohacking tools (behind their own switch): brain test scores, focus by the hour, the evening rebound, tolerance
// (the effect shrinking), dose creep, sensitivity after a break, a readiness score with a plan for the day, an illness
// warning and how long the body takes to recover after a hard day. From the person's own records. Pure.
import type { CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import { usualHours } from './durations';
import { ALCOHOL } from './lifestyle';
import { isStimulant } from './stimulant';
import { brainScore } from './focusReading';
import { dosePeak } from './watchSignals';
import { getDayBounds, type ScheduleSettings } from './schedule';
import { dayKey } from './stats';
import { zonedParts } from './tz';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (n: number) => Math.round(n * 10) / 10;
const live = (x: { deletedAt?: string }) => !x.deletedAt;
const taken = (d: Dose) => !d.deletedAt && !d.skipped;
const hourOf = (t: number, s: ScheduleSettings) => { const p = zonedParts(t, s.tz); return p.h + p.mi / 60; };
const clock = (h: number) => { const hh = Math.floor(h) % 24; return `${hh % 12 || 12}${hh < 12 ? ' am' : ' pm'}`; };

// ── Brain tests ─────────────────────────────────────────────────────────────────────────────────────

export { brainScore };
export const brainTests = (checkIns: CheckIn[]) => checkIns.filter((c) => live(c) && typeof c.rtMs === 'number').sort((a, b) => a.at.localeCompare(b.at));

/** Scoring one run of the reaction part: the median of the taps that came after the signal, lapses (over 500 ms) and
 *  early taps. */
export function scoreReaction(times: (number | 'early')[]): { rtMs: number; rtLapses: number; rtEarly: number } | null {
  const ok = times.filter((t): t is number => typeof t === 'number' && t > 100 && t < 1500);
  if (ok.length < 3) return null;
  return { rtMs: Math.round(median(ok)), rtLapses: ok.filter((t) => t > 500).length, rtEarly: times.filter((t) => t === 'early').length };
}

/** 2-back: each letter, was it the same as the one two before? The share of answers right (taps and holds). */
export function scoreNBack(letters: string[], tapped: boolean[]): number {
  let right = 0, n = 0;
  for (let i = 2; i < letters.length; i++) { n++; if ((letters[i] === letters[i - 2]) === !!tapped[i]) right++; }
  return n ? Math.round((right / n) * 100) : 0;
}

/** A 2-back sequence: `n` letters with about a third matching the one two before. */
export function nBackSequence(n: number, rand: () => number = Math.random): string[] {
  const L = 'BCDFGHJKLMNPRSTV';
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i >= 2 && rand() < 0.33) out.push(out[i - 2]);
    else { let c: string; do { c = L[Math.floor(rand() * L.length)]; } while (i >= 2 && c === out[i - 2]); out.push(c); }
  }
  return out;
}

// ── Focus by the hour ───────────────────────────────────────────────────────────────────────────────

export interface FocusHour { hour: number; focus?: number; brain?: number; n: number; score?: number }

/** Each hour from 6 am to 10 pm over the last 6 weeks: average focus rating and brain test score, put on one scale
 *  (each against its own average), and the best 3 hours in a row. */
export function focusByHour(checkIns: CheckIn[], now: number, s: ScheduleSettings): { hours: FocusHour[]; best?: { from: number; to: number } } | null {
  const cis = checkIns.filter((c) => live(c) && Date.parse(c.at) > now - 42 * DAY && Date.parse(c.at) <= now);
  const hours: FocusHour[] = Array.from({ length: 17 }, (_, i) => ({ hour: 6 + i, n: 0 }));
  const fAll: number[] = [], bAll: number[] = [];
  const f = hours.map(() => [] as number[]), b = hours.map(() => [] as number[]);
  for (const c of cis) {
    const h = Math.floor(hourOf(Date.parse(c.at), s)) - 6;
    if (h < 0 || h >= 17) continue;
    if (typeof c.focus === 'number') { f[h].push(c.focus); fAll.push(c.focus); }
    const bs = brainScore(c);
    if (bs !== undefined) { b[h].push(bs); bAll.push(bs); }
  }
  if (fAll.length + bAll.length < 10) return null;
  const fm = mean(fAll), bm = mean(bAll);
  for (let i = 0; i < 17; i++) {
    const hr = hours[i];
    hr.n = f[i].length + b[i].length;
    if (f[i].length >= 2) hr.focus = r1(mean(f[i]));
    if (b[i].length >= 1) hr.brain = Math.round(mean(b[i]));
    const parts = [hr.focus !== undefined ? (hr.focus - fm) / 1 : null, hr.brain !== undefined && Number.isFinite(bm) ? (hr.brain - bm) / 15 : null].filter((x): x is number => x !== null);
    if (parts.length) hr.score = r1(mean(parts));
  }
  let best: { from: number; to: number } | undefined, top = -Infinity;
  for (let i = 0; i + 2 < 17; i++) {
    const w = hours.slice(i, i + 3).map((x) => x.score).filter((x): x is number => x !== undefined);
    if (w.length >= 2 && mean(w) > top) { top = mean(w); best = { from: 6 + i, to: 9 + i }; }
  }
  return { hours, best: top > 0.15 ? best : undefined };
}

// ── The evening rebound ─────────────────────────────────────────────────────────────────────────────

export interface Rebound { day: number; evening: number; offEvening?: number; dipPct: number; tests: number }

/** Reaction time in the evening (4–10 pm) on stimulant days against 1–4 hours after a dose, and against evenings
 *  without one. A dip is a slower evening by 5% or more. Needs 3+ tests on each side. */
export function rebound(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): Rebound | null {
  const ids = new Set(meds.filter((m) => !m.archived && usualHours(m)).map((m) => m.id));
  const ds = doses.filter((d) => taken(d) && ids.has(d.medicationId)).map((d) => Date.parse(d.takenAt));
  if (!ds.length) return null;
  const dosedDays = new Set(ds.map((t) => dayKey(t, s)));
  const tests = brainTests(checkIns).filter((c) => Date.parse(c.at) > now - 60 * DAY);
  const day: number[] = [], eve: number[] = [], off: number[] = [];
  for (const c of tests) {
    const t = Date.parse(c.at), h = hourOf(t, s);
    const since = ds.filter((d) => d <= t).map((d) => t - d);
    const last = since.length ? Math.min(...since) : Infinity;
    if (last >= HOUR && last <= 4 * HOUR) day.push(c.rtMs!);
    else if (h >= 16 && h < 22) (dosedDays.has(dayKey(t, s)) ? eve : off).push(c.rtMs!);
  }
  if (day.length < 3 || eve.length < 3) return null;
  const d = median(day), e = median(eve);
  return { day: Math.round(d), evening: Math.round(e), offEvening: off.length >= 3 ? Math.round(median(off)) : undefined, dipPct: Math.round(((e - d) / d) * 100), tests: day.length + eve.length + off.length };
}

/** On a stimulant day, between the usual wear-off and 3 hours after: a good time for a quick evening test. */
export function eveningTestDue(meds: Medication[], doses: Dose[], checkIns: CheckIn[], now: number, s: ScheduleSettings): boolean {
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const h = hourOf(now, s);
  if (h < 16 || h >= 22) return false;
  const stim = meds.filter((m) => !m.archived && usualHours(m));
  const last = doses.filter((d) => taken(d) && stim.some((m) => m.id === d.medicationId) && Date.parse(d.takenAt) >= start).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  if (!last) return false;
  const u = usualHours(stim.find((m) => m.id === last.medicationId)!)!;
  const since = (now - Date.parse(last.takenAt)) / HOUR;
  if (since < (u.min + u.max) / 2 || since > (u.min + u.max) / 2 + 3) return false;
  return !brainTests(checkIns).some((c) => Date.parse(c.at) >= now - 3 * HOUR);
}

// ── Tolerance, dose creep and breaks ────────────────────────────────────────────────────────────────

export interface EffectWeek { from: number; doses: number; hrRise?: number; focus?: number; brain?: number }
export interface Tolerance { weeks: EffectWeek[]; drops: { what: string; from: string; to: string }[]; amount: number }

/** The effect of the usual dose (the most common amount), week by week for 10 weeks: the heart-rate rise after the first
 *  dose of the day, focus and brain test scores 45 minutes to 4 hours after a dose. A drop is the last 3 weeks against
 *  the first 3: the rise down a quarter, focus down half a point, or brain score down 8. */
export function tolerance(med: Medication, doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings): Tolerance | null {
  if (!isStimulant(med) || med.peptide) return null;
  const mine = doses.filter((d) => taken(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 10 * WEEK).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  if (mine.length < 10) return null;
  const counts = new Map<number, number>();
  for (const d of mine) counts.set(d.amount, (counts.get(d.amount) ?? 0) + 1);
  const amount = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const firstOfDay = new Set<string>();
  const weeks: EffectWeek[] = Array.from({ length: 10 }, (_, i) => ({ from: now - (10 - i) * WEEK, doses: 0 }));
  const acc = weeks.map(() => ({ hr: [] as number[], focus: [] as number[], brain: [] as number[] }));
  for (const d of mine.filter((x) => x.amount === amount)) {
    const t = Date.parse(d.takenAt);
    const w = Math.min(9, Math.floor((t - (now - 10 * WEEK)) / WEEK));
    weeks[w].doses++;
    const k = dayKey(t, s);
    if (!firstOfDay.has(k)) { firstOfDay.add(k); const p = dosePeak(t, daily, s); if (p !== null) acc[w].hr.push(p); }
    for (const c of checkIns.filter((x) => live(x) && Date.parse(x.at) >= t + 45 * MIN && Date.parse(x.at) <= t + 4 * HOUR)) {
      if (typeof c.focus === 'number') acc[w].focus.push(c.focus);
      const b = brainScore(c);
      if (b !== undefined) acc[w].brain.push(b);
    }
  }
  weeks.forEach((w, i) => {
    if (acc[i].hr.length) w.hrRise = r1(mean(acc[i].hr));
    if (acc[i].focus.length) w.focus = r1(mean(acc[i].focus));
    if (acc[i].brain.length) w.brain = Math.round(mean(acc[i].brain));
  });
  const span = (k: 'hrRise' | 'focus' | 'brain', a: number, b: number) => { const v = weeks.slice(a, b).map((w) => w[k]).filter((x): x is number => x !== undefined); return v.length >= 2 ? mean(v) : undefined; };
  const drops: Tolerance['drops'] = [];
  const hrA = span('hrRise', 0, 3), hrB = span('hrRise', 7, 10);
  if (hrA !== undefined && hrB !== undefined && hrA >= 4 && hrB <= hrA * 0.75) drops.push({ what: 'Heart rate rise', from: `+${r1(hrA)} bpm`, to: `+${r1(hrB)} bpm` });
  const fA = span('focus', 0, 3), fB = span('focus', 7, 10);
  if (fA !== undefined && fB !== undefined && fA - fB >= 0.5) drops.push({ what: 'Focus after a dose', from: `${r1(fA)}`, to: `${r1(fB)}` });
  const bA = span('brain', 0, 3), bB = span('brain', 7, 10);
  if (bA !== undefined && bB !== undefined && bA - bB >= 8) drops.push({ what: 'Brain test after a dose', from: `${Math.round(bA)}`, to: `${Math.round(bB)}` });
  return { weeks, drops, amount };
}

export interface DoseCreep { lines: string[] }

/** The last 3 weeks against weeks 5 to 8 ago: more taken a day (20%+), more doses a day (half a dose+), or the first dose
 *  45+ minutes earlier. */
export function doseCreep(med: Medication, doses: Dose[], now: number, s: ScheduleSettings): DoseCreep | null {
  if (!isStimulant(med) || med.peptide) return null;
  const mine = doses.filter((d) => taken(d) && d.medicationId === med.id);
  const stats = (a: number, b: number) => {
    const byDay = new Map<string, { total: number; n: number; first: number }>();
    for (const d of mine.filter((x) => Date.parse(x.takenAt) >= a && Date.parse(x.takenAt) < b)) {
      const t = Date.parse(d.takenAt), k = dayKey(t, s);
      const x = byDay.get(k) ?? { total: 0, n: 0, first: Infinity };
      byDay.set(k, { total: x.total + d.amount, n: x.n + 1, first: Math.min(x.first, hourOf(t, s)) });
    }
    const days = [...byDay.values()];
    return days.length >= 6 ? { total: mean(days.map((x) => x.total)), n: mean(days.map((x) => x.n)), first: mean(days.map((x) => x.first)) } : null;
  };
  const before = stats(now - 8 * WEEK, now - 5 * WEEK), after = stats(now - 3 * WEEK, now);
  if (!before || !after) return null;
  const lines: string[] = [];
  if (after.total >= before.total * 1.2) lines.push(`${r1(before.total)} → ${r1(after.total)} ${med.unit} a day`);
  if (after.n - before.n >= 0.5) lines.push(`${r1(before.n)} → ${r1(after.n)} doses a day`);
  if (before.first - after.first >= 0.75) lines.push(`first dose ${Math.round((before.first - after.first) * 60)} min earlier`);
  return lines.length ? { lines } : null;
}

export interface AfterBreak { breaks: number; firstRise?: number; usualRise?: number; firstFocus?: number; usualFocus?: number; lastGapDays?: number }

/** The first dose after 3+ days off against usual doses: heart-rate rise and focus after it. Needs 2 breaks. */
export function afterBreak(med: Medication, doses: Dose[], checkIns: CheckIn[], daily: DailyHealth[], now: number, s: ScheduleSettings): AfterBreak | null {
  if (!isStimulant(med) || med.peptide) return null;
  const mine = doses.filter((d) => taken(d) && d.medicationId === med.id && Date.parse(d.takenAt) > now - 180 * DAY).map((d) => Date.parse(d.takenAt)).sort((a, b) => a - b);
  const firsts: number[] = [], usual: number[] = [];
  let lastGap: number | undefined;
  mine.forEach((t, i) => {
    if (i > 0 && t - mine[i - 1] >= 3 * DAY) { firsts.push(t); lastGap = Math.round((t - mine[i - 1]) / DAY); }
    else if (i > 0) usual.push(t);
  });
  if (firsts.length < 2) return null;
  const rise = (ts: number[]) => { const v = ts.map((t) => dosePeak(t, daily, s)).filter((x): x is number => x !== null); return v.length >= 2 ? r1(mean(v)) : undefined; };
  const focus = (ts: number[]) => { const v = ts.flatMap((t) => checkIns.filter((c) => live(c) && typeof c.focus === 'number' && Date.parse(c.at) >= t + 45 * MIN && Date.parse(c.at) <= t + 4 * HOUR).map((c) => c.focus!)); return v.length >= 2 ? r1(mean(v)) : undefined; };
  const out: AfterBreak = { breaks: firsts.length, firstRise: rise(firsts), usualRise: rise(usual.slice(-30)), firstFocus: focus(firsts), usualFocus: focus(usual.slice(-30)), lastGapDays: lastGap };
  return out.firstRise !== undefined || out.firstFocus !== undefined ? out : null;
}

// ── Readiness and the day plan ──────────────────────────────────────────────────────────────────────

export interface MindReadiness { score: number; label: string; parts: { what: string; text: string; good: boolean }[]; plan: string[] }

/** Today's readiness for the mind: sleep, resting heart rate and HRV against the last 4 weeks, last night's late
 *  stimulant or alcohol, and this morning's brain test against its usual. With a plan for the day. */
export function mindReadiness(d: { daily: DailyHealth[]; checkIns: CheckIn[]; doses: Dose[]; meds: Medication[]; workouts?: Workout[] }, now: number, s: ScheduleSettings,
  extras: { illness?: boolean; bestHours?: { from: number; to: number }; bedtime?: string } = {}): MindReadiness | null {
  const todayK = dayKey(now, s);
  const rows = d.daily.filter(live).sort((a, b) => a.date.localeCompare(b.date));
  const today = rows.find((x) => x.date === todayK);
  const base = rows.filter((x) => x.date < todayK && new Date(`${x.date}T12:00`).getTime() > now - 29 * DAY);
  const b = (k: 'sleepMin' | 'restingHr' | 'hrvMs' | 'sleepDeepMin') => median(base.map((x) => x[k]).filter((x): x is number => typeof x === 'number'));
  const parts: MindReadiness['parts'] = [];
  let score = 70;
  const sl = today?.sleepMin, bs = b('sleepMin');
  if (sl !== undefined && bs) { const v = (sl - bs) / bs; score += 70 * Math.max(-0.4, Math.min(0.25, v)); parts.push({ what: 'Sleep', text: `${r1(sl / 60)} h (usually ${r1(bs / 60)})`, good: v >= -0.1 }); }
  const dp = today?.sleepDeepMin, bd = b('sleepDeepMin');
  if (dp !== undefined && bd) { const v = (dp - bd) / bd; score += 15 * Math.max(-0.5, Math.min(0.5, v)); parts.push({ what: 'Deep sleep', text: `${dp} min (usually ${Math.round(bd)})`, good: v >= -0.15 }); }
  const hr = today?.restingHr, bh = b('restingHr');
  if (hr !== undefined && bh) { const v = (bh - hr) / bh; score += 150 * Math.max(-0.15, Math.min(0.1, v)); parts.push({ what: 'Resting heart rate', text: `${hr} bpm (usually ${Math.round(bh)})`, good: v >= -0.05 }); }
  const hv = today?.hrvMs, bv = b('hrvMs');
  if (hv !== undefined && bv) { const v = (hv - bv) / bv; score += 40 * Math.max(-0.4, Math.min(0.3, v)); parts.push({ what: 'HRV', text: `${Math.round(hv)} ms (usually ${Math.round(bv)})`, good: v >= -0.1 }); }
  // Last night: a stimulant after 3 pm, alcohol.
  const yStart = getDayBounds(now, s.dayStartsAt, s.tz).start - DAY;
  const stim = new Set(d.meds.filter((m) => !m.archived && isStimulant(m)).map((m) => m.id));
  const late = d.doses.find((x) => taken(x) && stim.has(x.medicationId) && Date.parse(x.takenAt) >= yStart && Date.parse(x.takenAt) < yStart + DAY && hourOf(Date.parse(x.takenAt), s) >= 15);
  if (late) { score -= 6; parts.push({ what: 'Late dose yesterday', text: `at ${new Date(late.takenAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`, good: false }); }
  const drank = d.checkIns.some((c) => live(c) && c.chips.includes(ALCOHOL) && Date.parse(c.at) >= yStart && Date.parse(c.at) < yStart + DAY);
  if (drank) { score -= 8; parts.push({ what: 'Alcohol yesterday', text: 'noted in a check-in', good: false }); }
  // This morning's brain test against its usual (the last 30).
  const tests = brainTests(d.checkIns);
  const todayTest = tests.filter((c) => dayKey(Date.parse(c.at), s) === todayK).pop();
  const prior = tests.filter((c) => dayKey(Date.parse(c.at), s) < todayK).slice(-30).map((c) => brainScore(c)!).filter((x) => x !== undefined);
  if (todayTest && prior.length >= 5) { const v = brainScore(todayTest)! - median(prior); score += Math.max(-12, Math.min(8, v * 0.5)); parts.push({ what: 'Brain test', text: `${brainScore(todayTest)} (usually ${Math.round(median(prior))})`, good: v >= -5 }); }
  if (!parts.length) return null;
  const v = Math.round(Math.max(0, Math.min(100, score)));
  const label = v >= 75 ? 'Sharp' : v >= 55 ? 'Steady' : 'Low';
  const plan: string[] = [];
  if (extras.illness) plan.push('Signs your body is fighting something: rest, extra fluids, and hold any planned dose step-up');
  if (v >= 75) {
    plan.push('A good day for a hard training session');
    plan.push(extras.bestHours ? `Deep work fits best ${clock(extras.bestHours.from)}–${clock(extras.bestHours.to)}` : 'A good day for deep work');
  } else if (v >= 55) {
    plan.push('A normal day: usual training and dose');
  } else {
    plan.push('An easier session (or a walk) fits today better than a hard one');
    if (stim.size) plan.push('A later or smaller first dose is an option on a low day; caffeine adds less than usual when sleep was short');
    plan.push(`An earlier night${extras.bedtime ? `: in bed by about ${extras.bedtime}` : ''}`);
  }
  return { score: v, label, parts, plan };
}

// ── Illness warning ─────────────────────────────────────────────────────────────────────────────────

export interface Illness { days: number; rhr: number; baseRhr: number; hrv?: number; baseHrv?: number }

/** The last 2 days: resting heart rate 4+ bpm over its usual (days 3–30 ago) with HRV 15%+ under its usual, or the heart
 *  rate 6+ bpm over without HRV. Often shows a day or two before feeling unwell. */
export function illnessWarning(daily: DailyHealth[], now: number, s: ScheduleSettings): Illness | null {
  const todayK = dayKey(now, s);
  const rows = daily.filter(live).sort((a, b) => a.date.localeCompare(b.date)).filter((x) => x.date <= todayK);
  const recent = rows.slice(-2);
  if (recent.length < 2 || recent.some((x) => typeof x.restingHr !== 'number')) return null;
  if (new Date(`${recent[0].date}T12:00`).getTime() < now - 3 * DAY) return null;
  const base = rows.filter((x) => { const t = new Date(`${x.date}T12:00`).getTime(); return t < now - 2.5 * DAY && t > now - 31 * DAY; });
  const bh = median(base.map((x) => x.restingHr).filter((x): x is number => typeof x === 'number'));
  const bv = median(base.map((x) => x.hrvMs).filter((x): x is number => typeof x === 'number'));
  if (!Number.isFinite(bh) || base.length < 10) return null;
  const hrUp = recent.every((x) => x.restingHr! >= bh + 4);
  const hasHrv = Number.isFinite(bv) && recent.every((x) => typeof x.hrvMs === 'number');
  const hrvDown = hasHrv && recent.every((x) => x.hrvMs! <= bv * 0.85);
  if (!(hrUp && (hrvDown || (!hasHrv && recent.every((x) => x.restingHr! >= bh + 6))))) return null;
  const last = recent[recent.length - 1];
  return { days: 2, rhr: last.restingHr!, baseRhr: Math.round(bh), hrv: hasHrv ? Math.round(last.hrvMs!) : undefined, baseHrv: hasHrv ? Math.round(bv) : undefined };
}

// ── Recovery after a hard day ───────────────────────────────────────────────────────────────────────

export interface Recovery { kind: string; label: string; days: number; events: number }

/** How many days HRV takes to come back within 5% of its usual after alcohol, a big training session (15+ sets), a
 *  short night (90+ minutes under the usual) or a stimulant after 3 pm. Each needs 2+ times in 90 days. */
export function recoveryTimes(d: { daily: DailyHealth[]; checkIns: CheckIn[]; workouts: Workout[]; doses: Dose[]; meds: Medication[] }, now: number, s: ScheduleSettings): Recovery[] {
  const rows = d.daily.filter((x) => live(x) && typeof x.hrvMs === 'number' && new Date(`${x.date}T12:00`).getTime() > now - 120 * DAY);
  if (rows.length < 30) return [];
  const byDate = new Map(rows.map((x) => [x.date, x]));
  const base = median(rows.map((x) => x.hrvMs!));
  const sleepBase = median(d.daily.filter((x) => live(x) && x.sleepMin).map((x) => x.sleepMin!));
  const next = (k: string, n: number) => { const t = new Date(`${k}T12:00`); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const daysBack = (k: string) => { for (let n = 1; n <= 5; n++) { const r = byDate.get(next(k, n)); if (r && r.hrvMs! >= base * 0.95) return n; } return byDate.has(next(k, 1)) ? 5 : undefined; };
  const stim = new Set(d.meds.filter((m) => isStimulant(m)).map((m) => m.id));
  const events: Record<string, Set<string>> = { alcohol: new Set(), training: new Set(), sleep: new Set(), late: new Set() };
  for (const c of d.checkIns) if (live(c) && c.chips.includes(ALCOHOL) && Date.parse(c.at) > now - 90 * DAY) events.alcohol.add(dayKey(Date.parse(c.at), s));
  for (const w of d.workouts) if (live(w) && w.sets.filter((x) => x.done && !x.warmup).length >= 15 && Date.parse(w.startedAt) > now - 90 * DAY) events.training.add(dayKey(Date.parse(w.startedAt), s));
  for (const x of d.daily) if (live(x) && x.sleepMin && Number.isFinite(sleepBase) && x.sleepMin < sleepBase - 90 && new Date(`${x.date}T12:00`).getTime() > now - 90 * DAY) events.sleep.add(next(x.date, -1));
  for (const x of d.doses) if (taken(x) && stim.has(x.medicationId) && Date.parse(x.takenAt) > now - 90 * DAY && hourOf(Date.parse(x.takenAt), s) >= 15) events.late.add(dayKey(Date.parse(x.takenAt), s));
  const LABEL: Record<string, string> = { alcohol: 'After alcohol', training: 'After a big training session', sleep: 'After a short night', late: 'After a late stimulant dose' };
  const out: Recovery[] = [];
  for (const [kind, set] of Object.entries(events)) {
    const v = [...set].map(daysBack).filter((x): x is number => x !== undefined);
    if (v.length >= 2) out.push({ kind, label: LABEL[kind], days: r1(mean(v)), events: v.length });
  }
  return out.sort((a, b) => b.days - a.days);
}
