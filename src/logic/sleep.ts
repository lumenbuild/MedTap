// The sleep suite, from the watch's nights: last night with a sleep score (each part shown), consistency of bed and wake
// times, sleep debt against your target, what goes with better or worse sleep in your own records (dose timing,
// caffeine, alcohol, sleep peptides, training, active days), and a bedtime for tonight. Pure.
import type { CheckIn, DailyHealth, Dose, Medication, Workout } from '../db/schema';
import type { ScheduleSettings } from './schedule';
import { zonedParts } from './tz';
import { isStimulant } from './stimulant';
import { guideFor } from './peptideGuide';
import { ALCOHOL } from './lifestyle';
import { CAFFEINE } from './caffeine';

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const ymdAdd = (ymd: string, days: number) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + days)); return t.toISOString().slice(0, 10); };
/** Clock minutes of a time, local. Bedtimes count from noon (11 pm = 660, 1 am = 780) so nights don't wrap at midnight. */
const clockMin = (t: number, s: ScheduleSettings) => { const p = zonedParts(t, s.tz); return p.h * 60 + p.mi; };
export const bedMin = (t: number, s: ScheduleSettings) => (clockMin(t, s) + 12 * 60) % 1440;
export const fmtClock = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
export const fmtHM = (min: number) => { const m = Math.round(Math.abs(min)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

export interface Night {
  /** The morning the night ended (YYYY-MM-DD). */
  date: string;
  asleep: number; deep?: number; rem?: number; light?: number; awake?: number; wakes?: number;
  start?: number; end?: number;
  /** Asleep as a share of the time from falling asleep to waking (0–1). */
  efficiency?: number;
  hrv?: number; rhr?: number;
}

/** The nights with sleep from the watch (or entered), oldest first, within `days`. */
export function nightsOf(daily: DailyHealth[], now: number, days = 90): Night[] {
  // One night a date: where two records share one (an import and a hand entry), the one with the watch's times wins.
  const byDate = new Map<string, DailyHealth>();
  for (const d of daily.filter((d) => !d.deletedAt && d.sleepMin && d.sleepMin > 60 && new Date(`${d.date}T12:00`).getTime() > now - days * DAY && new Date(`${d.date}T00:00`).getTime() <= now)) {
    const had = byDate.get(d.date);
    if (!had || (!had.sleepStart && d.sleepStart) || (!!had.sleepStart === !!d.sleepStart && (d.updatedAt ?? '') > (had.updatedAt ?? ''))) byDate.set(d.date, d);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const light = d.sleepDeepMin !== undefined && d.sleepRemMin !== undefined ? Math.max(0, d.sleepMin! - d.sleepDeepMin - d.sleepRemMin) : undefined;
      const efficiency = d.sleepAwakeMin !== undefined ? d.sleepMin! / (d.sleepMin! + d.sleepAwakeMin) : undefined;
      return { date: d.date, asleep: d.sleepMin!, deep: d.sleepDeepMin, rem: d.sleepRemMin, light, awake: d.sleepAwakeMin, wakes: d.sleepWakes, start: d.sleepStart, end: d.sleepEnd, efficiency, hrv: d.hrvMs, rhr: d.restingHr };
    });
}

export interface Usual { asleep: number; deep?: number; rem?: number; efficiency?: number; hrv?: number; rhr?: number; bed?: number; wake?: number; nights: number }

/** Your usual night: medians over the 30 nights before `beforeDate` (5+ nights). */
export function usualNight(ns: Night[], s: ScheduleSettings, beforeDate?: string): Usual | undefined {
  const pool = ns.filter((n) => !beforeDate || n.date < beforeDate).slice(-30);
  if (pool.length < 5) return undefined;
  const med = (f: (n: Night) => number | undefined) => { const v = pool.map(f).filter((x): x is number => typeof x === 'number'); return v.length >= 3 ? median(v) : undefined; };
  return {
    asleep: median(pool.map((n) => n.asleep)), deep: med((n) => n.deep), rem: med((n) => n.rem), efficiency: med((n) => n.efficiency),
    hrv: med((n) => n.hrv), rhr: med((n) => n.rhr), bed: med((n) => (n.start ? bedMin(n.start, s) : undefined)), wake: med((n) => (n.end ? clockMin(n.end, s) : undefined)), nights: pool.length,
  };
}

export interface ScorePart { key: 'duration' | 'stages' | 'continuity' | 'timing' | 'recovery'; label: string; points: number; max: number; note: string }
export interface SleepScore { score: number; word: 'Great' | 'Good' | 'Fair' | 'Poor'; parts: ScorePart[] }

/** 0–100 from five parts, each shown: how long (40), deep and REM (20), unbroken (20), on your usual timing (10), and
 *  overnight recovery: HRV and resting heart rate against your usual (10). Parts with no data are left out and the rest
 *  scaled to 100. */
export function sleepScore(n: Night, targetMin: number, usual: Usual | undefined, s: ScheduleSettings): SleepScore {
  const parts: ScorePart[] = [];
  parts.push({ key: 'duration', label: 'How long', max: 40, points: 40 * clamp(n.asleep / targetMin), note: `${fmtHM(n.asleep)} of ${fmtHM(targetMin)}` });
  if (n.deep !== undefined && n.rem !== undefined && n.asleep > 0) {
    const d = n.deep / n.asleep, r = n.rem / n.asleep;
    parts.push({ key: 'stages', label: 'Deep and REM', max: 20, points: 10 * clamp(d / 0.15) + 10 * clamp(r / 0.2), note: `${Math.round(d * 100)}% deep, ${Math.round(r * 100)}% REM` });
  }
  if (n.efficiency !== undefined) {
    parts.push({ key: 'continuity', label: 'Unbroken', max: 20, points: 20 * clamp((n.efficiency - 0.75) / 0.15), note: `${Math.round(n.efficiency * 100)}% asleep${n.wakes !== undefined ? `, woke ${n.wakes} time${n.wakes === 1 ? '' : 's'}` : ''}` });
  } else if (n.wakes !== undefined) {
    parts.push({ key: 'continuity', label: 'Unbroken', max: 20, points: 20 * clamp(1 - Math.max(0, n.wakes - 1) / 6), note: `Woke ${n.wakes} time${n.wakes === 1 ? '' : 's'}` });
  }
  if (n.start !== undefined && usual?.bed !== undefined) {
    const off = Math.abs(bedMin(n.start, s) - usual.bed);
    parts.push({ key: 'timing', label: 'Usual timing', max: 10, points: 10 * clamp(1 - (off - 30) / 90), note: off <= 30 ? 'Asleep at your usual time' : `Asleep ${Math.round(off)} min ${bedMin(n.start, s) > usual.bed ? 'later' : 'earlier'} than usual` });
  }
  const rec: number[] = [], recNote: string[] = [];
  if (n.hrv !== undefined && usual?.hrv) { rec.push(clamp((n.hrv / usual.hrv - 0.8) / 0.2)); recNote.push(`HRV ${Math.round(n.hrv)} ms (usual ${Math.round(usual.hrv)})`); }
  if (n.rhr !== undefined && usual?.rhr) { rec.push(clamp(1 - (n.rhr - usual.rhr) / 6)); recNote.push(`resting HR ${Math.round(n.rhr)} (usual ${Math.round(usual.rhr)})`); }
  if (rec.length) parts.push({ key: 'recovery', label: 'Recovery', max: 10, points: 10 * mean(rec), note: recNote.join(', ') });
  const max = parts.reduce((a, p) => a + p.max, 0), got = parts.reduce((a, p) => a + p.points, 0);
  const score = Math.round((got / max) * 100);
  parts.forEach((p) => { p.points = Math.round(p.points * 10) / 10; });
  return { score, word: score >= 85 ? 'Great' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Poor', parts };
}

export interface Consistency {
  /** Spread (standard deviation) of the time you fell asleep and woke, in minutes, over the last 14 nights. */
  bedSd: number; wakeSd: number; usualBed: number; usualWake: number;
  /** Weekend nights against the rest: how far the middle of your sleep moves (minutes, later is positive). */
  socialJetLag?: number;
  word: 'Steady' | 'Varies' | 'Irregular';
  nights: { date: string; bed: number; wake: number }[];
}

/** Bed and wake times over the last 14 nights with both (7+ needed). */
export function consistency(ns: Night[], s: ScheduleSettings): Consistency | null {
  const rows = ns.filter((n) => n.start && n.end).slice(-14).map((n) => ({ date: n.date, bed: bedMin(n.start!, s), wake: clockMin(n.end!, s) }));
  if (rows.length < 7) return null;
  const bedSd = sd(rows.map((r) => r.bed)), wakeSd = sd(rows.map((r) => r.wake));
  // The middle of sleep, from noon: Friday and Saturday nights (Saturday and Sunday mornings) against the rest.
  const mid = (r: { bed: number; wake: number }) => (r.bed + ((r.wake + 12 * 60) % 1440)) / 2;
  const wd = (ymd: string) => new Date(`${ymd}T12:00`).getDay();
  const free = rows.filter((r) => [0, 6].includes(wd(r.date))), work = rows.filter((r) => ![0, 6].includes(wd(r.date)));
  const socialJetLag = free.length >= 2 && work.length >= 3 ? Math.round(mean(free.map(mid)) - mean(work.map(mid))) : undefined;
  const worst = Math.max(bedSd, wakeSd);
  return { bedSd: Math.round(bedSd), wakeSd: Math.round(wakeSd), usualBed: Math.round(median(rows.map((r) => r.bed))), usualWake: Math.round(median(rows.map((r) => r.wake))),
    socialJetLag, word: worst <= 30 ? 'Steady' : worst <= 60 ? 'Varies' : 'Irregular', nights: rows };
}

export interface SleepDebt { minutes: number; nights: number; perNight: { date: string; diff: number }[] }

/** The last 7 nights against your target: positive is behind. Nights with no data aren't counted. */
export function sleepDebt(ns: Night[], targetMin: number, now: number): SleepDebt | null {
  const from = new Date(now - 8 * DAY).toISOString().slice(0, 10);
  const last = ns.filter((n) => n.date > from).slice(-7);
  if (last.length < 3) return null;
  const perNight = last.map((n) => ({ date: n.date, diff: Math.round(targetMin - n.asleep) }));
  return { minutes: perNight.reduce((a, x) => a + x.diff, 0), nights: last.length, perNight };
}

export interface SleepFactor {
  key: string; label: string;
  /** Nights with it and without, and the difference (with minus without). */
  on: number; off: number; scoreDiff: number; asleepDiff: number; deepDiff?: number;
  certainty: 'Early' | 'Likely' | 'Solid';
}

/** What goes with better or worse sleep, in your own records: the day before each night, with against without. Kept
 *  when there are 4+ nights each side and the difference is meaningful (4+ points, 15+ minutes asleep, or 8+ minutes
 *  of deep sleep). Biggest first. */
export function sleepFactors(ns: Night[], d: { doses: Dose[]; meds: Medication[]; checkIns: CheckIn[]; workouts: Workout[]; daily: DailyHealth[] }, targetMin: number, s: ScheduleSettings): SleepFactor[] {
  const scored = ns.map((n) => ({ n, score: sleepScore(n, targetMin, usualNight(ns, s, n.date), s).score }));
  const dayOf = (t: number) => { const p = zonedParts(t, s.tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
  const hourOf = (t: number) => { const p = zonedParts(t, s.tz); return p.h + p.mi / 60; };
  const before = (n: Night) => ymdAdd(n.date, -1);
  const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;
  const out: SleepFactor[] = [];
  const test = (key: string, label: string, has: (day: string) => boolean | undefined) => {
    const on = scored.filter((x) => has(before(x.n)) === true), off = scored.filter((x) => has(before(x.n)) === false);
    if (on.length < 4 || off.length < 4) return;
    const scoreDiff = Math.round(mean(on.map((x) => x.score)) - mean(off.map((x) => x.score)));
    const asleepDiff = Math.round(mean(on.map((x) => x.n.asleep)) - mean(off.map((x) => x.n.asleep)));
    const dOn = on.map((x) => x.n.deep).filter((v): v is number => v !== undefined), dOff = off.map((x) => x.n.deep).filter((v): v is number => v !== undefined);
    const deepDiff = dOn.length >= 3 && dOff.length >= 3 ? Math.round(mean(dOn) - mean(dOff)) : undefined;
    if (Math.abs(scoreDiff) < 4 && Math.abs(asleepDiff) < 15 && Math.abs(deepDiff ?? 0) < 8) return;
    const fewest = Math.min(on.length, off.length);
    out.push({ key, label, on: on.length, off: off.length, scoreDiff, asleepDiff, deepDiff, certainty: fewest >= 15 && Math.abs(scoreDiff) >= 6 ? 'Solid' : fewest >= 8 ? 'Likely' : 'Early' });
  };

  // Stimulants: the last dose of the day after your usual last-dose time.
  const stimIds = new Set(d.meds.filter((m) => isStimulant(m) && !m.peptide).map((m) => m.id));
  const lastStim = new Map<string, number>();
  for (const x of d.doses.filter((x) => live(x) && !x.skipped && stimIds.has(x.medicationId))) {
    const t = Date.parse(x.takenAt), k = dayOf(t);
    lastStim.set(k, Math.max(lastStim.get(k) ?? 0, hourOf(t)));
  }
  if (lastStim.size >= 8) {
    const cut = Math.round(median([...lastStim.values()]) * 2) / 2;
    test('late-stimulant', `Last stimulant dose after ${fmtClock(cut * 60)}`, (k) => (lastStim.has(k) ? lastStim.get(k)! > cut : undefined));
  }
  // Caffeine after 2 pm, and alcohol.
  const cis = d.checkIns.filter(live);
  const cafDays = new Set(cis.filter((c) => c.chips.includes(CAFFEINE)).map((c) => dayOf(Date.parse(c.at))));
  const lateCaf = new Set(cis.filter((c) => c.chips.includes(CAFFEINE) && hourOf(Date.parse(c.at)) >= 14).map((c) => dayOf(Date.parse(c.at))));
  if (cafDays.size >= 8) test('late-caffeine', 'Caffeine after 2 pm', (k) => (cafDays.has(k) ? lateCaf.has(k) : false));
  const alcDays = new Set(cis.filter((c) => c.chips.includes(ALCOHOL)).map((c) => dayOf(Date.parse(c.at))));
  if (alcDays.size >= 4) test('alcohol', 'Alcohol', (k) => alcDays.has(k));
  // Peptides and supplements taken for sleep (DSIP, epitalon, ipamorelin...): dose days against others.
  for (const m of d.meds.filter((m) => !m.archived && guideFor(m.name)?.goals?.includes('sleep'))) {
    const days = new Set(d.doses.filter((x) => live(x) && !x.skipped && x.medicationId === m.id).map((x) => dayOf(Date.parse(x.takenAt))));
    if (days.size >= 4) test(`med-${m.id}`, m.name, (k) => days.has(k));
  }
  // Training, a late workout, and an active day.
  const wDays = new Map<string, number>();
  for (const w of d.workouts.filter(live)) { const t = Date.parse(w.startedAt); const k = dayOf(t); wDays.set(k, Math.max(wDays.get(k) ?? 0, hourOf(t))); }
  if (wDays.size >= 4) {
    test('workout', 'A workout', (k) => wDays.has(k));
    test('late-workout', 'A workout after 7 pm', (k) => (wDays.has(k) ? wDays.get(k)! >= 19 : undefined));
  }
  const steps = new Map(d.daily.filter((x) => live(x) && x.steps).map((x) => [x.date, x.steps!]));
  if (steps.size >= 10) {
    const mid = median([...steps.values()]);
    test('active', `Over ${Math.round(mid / 100) * 100} steps`, (k) => (steps.has(k) ? steps.get(k)! > mid : undefined));
  }
  return out.sort((a, b) => Math.abs(b.scoreDiff) - Math.abs(a.scoreDiff) || Math.abs(b.asleepDiff) - Math.abs(a.asleepDiff));
}

export interface Bedtime { bedtime: number; windDown: number; wake: number; notes: string[] }

/** Tonight: the time to be asleep for your target before your usual wake, 15 minutes to fall asleep, half an hour
 *  earlier with 2+ hours of sleep debt; wind down 45 minutes before. Notes on what could get in the way tonight. */
export function bedtimeTonight(c: { usualWake: number; targetMin: number; debtMin?: number; lateStimulant?: string; caffeineAtBedMg?: number }): Bedtime {
  const extra = (c.debtMin ?? 0) >= 120 ? 30 : 0;
  const bedtime = (((c.usualWake - c.targetMin - 15 - extra) % 1440) + 1440) % 1440;
  const notes: string[] = [];
  if (extra) notes.push(`Half an hour earlier than usual: you’re ${fmtHM(c.debtMin!)} behind this week.`);
  if (c.lateStimulant) notes.push(c.lateStimulant);
  if (c.caffeineAtBedMg !== undefined && c.caffeineAtBedMg >= 50) notes.push(`About ${Math.round(c.caffeineAtBedMg)} mg of caffeine will still be in your system at bedtime.`);
  return { bedtime, windDown: (bedtime - 45 + 1440) % 1440, wake: c.usualWake, notes };
}
