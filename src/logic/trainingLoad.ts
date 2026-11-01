// Training load from the watch: time in each heart-rate zone for every workout, a load score for each (minutes in a
// zone × how hard the zone is, the way TRIMP scores do), this week's load against the four weeks before (the acute to
// chronic ratio), cardio fitness (VO2 max) over time, and what kind of day today suits. Pure.
import type { DailyHealth, Workout } from '../db/schema';
import type { Readiness } from './training';
import type { IllnessWatch } from './vitals';

const DAY = 86_400_000;
const live = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

/** Zones as a share of maximum heart rate: 1 easy, 2 steady, 3 moderate, 4 hard, 5 all-out. */
export const ZONES = [
  { n: 1, from: 0.5, label: 'Easy' }, { n: 2, from: 0.6, label: 'Steady' }, { n: 3, from: 0.7, label: 'Moderate' },
  { n: 4, from: 0.8, label: 'Hard' }, { n: 5, from: 0.9, label: 'All-out' },
] as const;

/** The person's maximum heart rate: the highest the watch has seen in a workout over the last 6 months (at least 170,
 *  at most 210), else 190. */
export function maxHeartRate(workouts: Workout[], now: number): number {
  let hi = 0;
  for (const w of workouts.filter(live)) {
    if (now - Date.parse(w.startedAt) > 183 * DAY) continue;
    const s = stats(w);
    if (s?.maxHr) hi = Math.max(hi, s.maxHr);
    for (const v of s?.hrMin ?? []) if (typeof v === 'number') hi = Math.max(hi, v);
  }
  return hi ? Math.min(210, Math.max(170, hi)) : 190;
}

/** The watch's numbers for a workout: a cardio session's own, or those added to a strength workout. */
function stats(w: Workout): { avgHr?: number; maxHr?: number; hrMin?: (number | null)[]; minutes: number } | undefined {
  if (w.cardio) return { ...w.cardio, minutes: w.cardio.durationMin };
  if (w.watch) return { ...w.watch, minutes: w.watch.minutes ?? 0 };
  return undefined;
}

export interface WorkoutLoad { minutesInZone: number[]; load: number; minutes: number; from: 'heart rate' | 'average' | 'estimate' }

/** Time in each zone (minutes, index 0 = zone 1; below zone 1 isn't counted) and the load score. From the minute-by-
 *  minute heart rate where there is one, else the average heart rate for the whole session, else an estimate from the
 *  time (a strength session logged here: moderate, zone 2). */
export function workoutLoad(w: Workout, maxHr: number): WorkoutLoad | null {
  const s = stats(w);
  const zoneOf = (bpm: number) => { let z = 0; for (const x of ZONES) if (bpm >= x.from * maxHr) z = x.n; return z; };
  const mins = [0, 0, 0, 0, 0];
  if (s?.hrMin && s.hrMin.some((x) => typeof x === 'number')) {
    for (const v of s.hrMin) if (typeof v === 'number') { const z = zoneOf(v); if (z) mins[z - 1]++; }
    return finish(mins, s.hrMin.length, 'heart rate');
  }
  if (s?.avgHr && s.minutes) { const z = zoneOf(s.avgHr); if (z) mins[z - 1] = s.minutes; return finish(mins, s.minutes, 'average'); }
  if (!w.cardio && w.sets.length && w.endedAt) {
    const m = Math.min(120, Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60_000));
    if (m >= 5) { mins[1] = m; return finish(mins, m, 'estimate'); }
  }
  if (w.cardio && w.cardio.durationMin) { mins[1] = w.cardio.durationMin; return finish(mins, w.cardio.durationMin, 'estimate'); }
  return null;
}
const finish = (mins: number[], minutes: number, from: WorkoutLoad['from']): WorkoutLoad =>
  ({ minutesInZone: mins, load: Math.round(mins.reduce((a, m, i) => a + m * (i + 1), 0)), minutes, from });

export type LoadStatus = 'Building up' | 'Steady' | 'Spiking' | 'Easing off';
export interface TrainingLoad {
  /** The last 7 days' load, and the average week over the 28 days before them. */
  week: number; usualWeek: number; ratio?: number; status?: LoadStatus;
  /** Load each day for the last 28 days (oldest first). */
  days: { t: number; load: number }[];
  /** Minutes in each zone over the last 7 days. */
  zoneWeek: number[];
  maxHr: number;
}

export function trainingLoad(workouts: Workout[], now: number): TrainingLoad | null {
  const ws = workouts.filter(live).filter((w) => Date.parse(w.startedAt) > now - 35 * DAY && Date.parse(w.startedAt) <= now);
  if (!ws.length) return null;
  const maxHr = maxHeartRate(workouts, now);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const dayStart = (k: number) => start.getTime() - k * DAY;
  const days = Array.from({ length: 35 }, (_, i) => ({ t: dayStart(34 - i), load: 0 }));
  const zoneWeek = [0, 0, 0, 0, 0];
  for (const w of ws) {
    const l = workoutLoad(w, maxHr);
    if (!l) continue;
    const t = Date.parse(w.startedAt);
    const i = days.findIndex((d) => t >= d.t && t < d.t + DAY);
    if (i >= 0) days[i].load += l.load;
    if (t > now - 7 * DAY) l.minutesInZone.forEach((m, z) => { zoneWeek[z] += m; });
  }
  const week = days.slice(-7).reduce((a, d) => a + d.load, 0);
  const before = days.slice(0, 28);
  const usualWeek = Math.round(before.reduce((a, d) => a + d.load, 0) / 4);
  // The ratio needs a usual to compare with, recorded the same way. When
  // watch workouts have only just started coming in, this week would be compared with weeks the watch never saw.
  const weeksWithAny = [0, 1, 2, 3].filter((k) => before.slice(k * 7, k * 7 + 7).some((d) => d.load > 0)).length;
  const fromWatch = (w: Workout) => w.source === 'health';
  const weekStart = days[days.length - 7].t;
  const newSource = ws.some((w) => fromWatch(w) && Date.parse(w.startedAt) >= weekStart) && !ws.some((w) => fromWatch(w) && Date.parse(w.startedAt) < weekStart);
  // Not compared until training shows up in at least 3 of the 4 weeks before: with less, "your usual" is a few odd
  // sessions and any normal week looks like a spike (starting out, or the watch only just recording workouts).
  const ratio = usualWeek > 0 && weeksWithAny >= 3 && !newSource ? Math.round((week / usualWeek) * 100) / 100 : undefined;
  const status: LoadStatus | undefined = ratio === undefined ? undefined : ratio > 1.5 ? 'Spiking' : ratio > 1.25 ? 'Building up' : ratio < 0.75 ? 'Easing off' : 'Steady';
  return { week, usualWeek, ratio, status, days: days.slice(-28), zoneWeek, maxHr };
}

/** Cardio fitness from the watch: the latest VO2 max and its change over about two months. */
export function vo2Trend(daily: DailyHealth[], now: number): { value: number; change?: number; points: { t: number; v: number }[] } | null {
  const pts = daily.filter(live).filter((d) => typeof d.vo2max === 'number').map((d) => ({ t: new Date(`${d.date}T12:00`).getTime(), v: d.vo2max! }))
    .filter((p) => p.t > now - 180 * DAY).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const old = pts.find((p) => p.t >= last.t - 70 * DAY && p.t <= last.t - 45 * DAY) ?? (pts[0].t <= last.t - 30 * DAY ? pts[0] : undefined);
  return { value: last.v, change: old ? Math.round((last.v - old.v) * 10) / 10 : undefined, points: pts };
}

export interface DaySuggestion { kind: 'rest' | 'easy' | 'normal' | 'push'; title: string; why: string }

/** What today suits, from how recovered you are, how your load is going, and anything off overnight. */
export function daySuggestion(r: Readiness | null, load: TrainingLoad | null, ill: IllnessWatch | null): DaySuggestion | null {
  if (ill) return { kind: 'rest', title: 'Rest or something gentle', why: 'Several overnight readings are off together.' };
  if (!r && !load?.status) return null;
  if ((r && r.score < 55) || load?.status === 'Spiking') {
    return { kind: 'easy', title: 'An easy day', why: [r && r.score < 55 ? `Readiness ${r.score}` : null, load?.status === 'Spiking' ? `this week's load is ${Math.round((load.ratio ?? 0) * 100)}% of your usual` : null].filter(Boolean).join(' and ').replace(/^t/, 'T') + '.' };
  }
  if (r && r.score >= 75 && (!load?.ratio || load.ratio < 1.2)) return { kind: 'push', title: 'A good day to push', why: `Readiness ${r.score}${load?.status ? `, load ${load.status.toLowerCase()}` : ''}.` };
  return { kind: 'normal', title: 'A normal training day', why: [r ? `Readiness ${r.score}` : null, load?.status ? `load ${load.status.toLowerCase()}` : null].filter(Boolean).join(', ') + '.' };
}
