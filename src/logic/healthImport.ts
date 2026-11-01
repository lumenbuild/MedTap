// Turning what Health Connect / Apple Health returns into records: one daily row per day (updated by later imports),
// weigh-ins and body composition only where that day has none logged, blood pressure readings not already logged
// within 5 minutes, and workouts from the watch not already there: runs, walks, rides, swims and rows as themselves,
// anything else (HIIT, yoga, a strength session not logged here...) by its name, each with heart rate and calories.
// A strength session that was also logged here gets the watch's heart rate and calories added instead.
// Pure, so it can be tested; src/app/health.ts writes the result.
import type { BodyEntry, CardioActivity, CardioEntry, DailyHealth, Vital, Workout } from '../db/schema';
import type { HealthData } from '../nfc/native';

export interface HealthPlan {
  daily: DailyHealth[]; body: { date: string; kg: number }[]; vitals: { at: string; systolic: number; diastolic: number }[];
  comp: { date: string; bodyFatPct?: number; leanKg?: number }[];
  cardio: { at: string; activity: CardioActivity; durationMin: number; distanceKm?: number; title?: string; avgHr?: number; maxHr?: number; kcal?: number }[];
  /** Workouts already here that the watch adds heart rate and calories to. */
  enrich: { id: string; cardio?: Partial<CardioEntry>; watch?: Workout['watch'] }[];
}

/** What the watch calls each kind of workout the app doesn't track as cardio. */
const LABEL: Record<string, string> = {
  strength: 'Strength training', hiit: 'HIIT', yoga: 'Yoga', pilates: 'Pilates', elliptical: 'Elliptical', stairs: 'Stair climbing',
  dance: 'Dance', boxing: 'Boxing', sport: 'Sport', other: 'Workout',
};

const CARDIO: CardioActivity[] = ['run', 'walk', 'ride', 'swim', 'row'];
const EXTRA = ['spo2Avg', 'spo2Min', 'respRate', 'skinTempDelta', 'vo2max', 'kcalTotal', 'kcalActive', 'floors', 'climbM', 'waterOtherMl', 'foodOtherKcal',
  'foodOtherProteinG', 'foodOtherCarbsG', 'foodOtherFatG', 'mindfulMin', 'glucoseAvg', 'glucoseMin', 'glucoseMax', 'glucoseInRange', 'glucoseByHour'] as const;
/** Walks shorter than this are everyday walking a watch picked up, not a session. */
const MIN_WALK = 10;

const ymdIn = (t: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

export function planHealthImport(data: HealthData, existing: { daily: DailyHealth[]; body: BodyEntry[]; vitals: Vital[]; workouts?: Workout[] }, personId: string | undefined, tz: string, nowIso: string): HealthPlan {
  const mine = <T extends { personId?: string; deletedAt?: string }>(r: T) => (r.personId ?? undefined) === personId && !r.deletedAt;
  const daily: DailyHealth[] = [];
  for (const d of data.days) {
    const old = existing.daily.find((x) => mine(x) && x.date === d.date);
    const row: DailyHealth = {
      ...(old ?? { id: crypto.randomUUID(), date: d.date, createdAt: nowIso, personId }),
      steps: d.steps ?? old?.steps, sleepMin: d.sleepMin ?? old?.sleepMin, restingHr: d.restingHr ?? old?.restingHr,
      exerciseMin: d.exerciseMin ?? old?.exerciseMin, hrvMs: d.hrvMs ?? old?.hrvMs, hrByHour: d.hrByHour ?? old?.hrByHour,
      hr5: d.hr5 ?? old?.hr5, steps5: d.steps5 ?? old?.steps5,
      sleepDeepMin: d.sleepDeepMin ?? old?.sleepDeepMin, sleepRemMin: d.sleepRemMin ?? old?.sleepRemMin, sleepAwakeMin: d.sleepAwakeMin ?? old?.sleepAwakeMin,
      sleepWakes: d.sleepWakes ?? old?.sleepWakes, sleepStart: d.sleepStart ?? old?.sleepStart, sleepEnd: d.sleepEnd ?? old?.sleepEnd, updatedAt: nowIso,
    };
    // Overnight vitals, energy, fitness, other apps' logs and glucose: the newest import wins, else what was there.
    for (const k of EXTRA) if (d[k] !== undefined || old?.[k] !== undefined) (row as unknown as Record<string, unknown>)[k] = d[k] ?? old?.[k];
    daily.push(row);
  }
  // One weigh-in per day: from the person's scale (the app that sends most of their weights, so a second app's copies
  // don't win), the day's first reading (the morning weigh-in, before food and drink). A day already imported is
  // corrected when that changes; a weight typed in by hand is never touched.
  const count = new Map<string, number>();
  for (const w of data.weights) count.set(w.src ?? '', (count.get(w.src ?? '') ?? 0) + 1);
  const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fromScale = data.weights.filter((w) => (w.src ?? '') === main);
  const byDay = new Map<string, { t: number; kg: number }>();
  for (const w of fromScale) { const k = ymdIn(w.t, tz); if (!byDay.has(k) || byDay.get(k)!.t > w.t) byDay.set(k, w); }
  const body = [...byDay].map(([date, w]) => ({ date, kg: Math.round(w.kg * 10) / 10 })).filter(({ date, kg }) => {
    const had = existing.body.find((b) => mine(b) && b.date === date && !b.deletedAt && typeof b.weightKg === 'number');
    return !had || (had.note === 'From Health' && had.weightKg !== kg);
  });
  const vitals = data.bp.filter((r) => !existing.vitals.some((v) => mine(v) && Math.abs(Date.parse(v.at) - r.t) < 5 * 60_000))
    .map((r) => ({ at: new Date(r.t).toISOString(), systolic: r.sys, diastolic: r.dia }));
  // Body fat and lean mass: the latest of each day, only where that day's entry doesn't have one.
  const latest = <T extends { t: number }>(list: T[] | undefined) => {
    const m = new Map<string, T>();
    for (const x of list ?? []) { const k = ymdIn(x.t, tz); if (!m.has(k) || m.get(k)!.t < x.t) m.set(k, x); }
    return m;
  };
  const fat = latest(data.bodyFat), lean = latest(data.lean);
  const comp: HealthPlan['comp'] = [];
  for (const date of new Set([...fat.keys(), ...lean.keys()])) {
    const e = existing.body.find((b) => mine(b) && b.date === date);
    const row: HealthPlan['comp'][number] = { date };
    if (fat.has(date) && e?.bodyFatPct === undefined) row.bodyFatPct = Math.round(fat.get(date)!.pct * 10) / 10;
    if (lean.has(date) && e?.leanKg === undefined) row.leanKg = Math.round(lean.get(date)!.kg * 10) / 10;
    if (row.bodyFatPct !== undefined || row.leanKg !== undefined) comp.push(row);
  }
  // Workouts. Skips any already there within 5 minutes, deleted ones included, so a deleted one stays deleted; one
  // imported before without heart rate gets it now.
  const sameOwner = (r: { personId?: string }) => (r.personId ?? undefined) === personId;
  const all = existing.workouts ?? [];
  const cardio: HealthPlan['cardio'] = [];
  const enrich: HealthPlan['enrich'] = [];
  for (const w of data.workouts ?? []) {
    if (!(w.end > w.t)) continue;
    const durationMin = Math.round((w.end - w.t) / 60_000);
    if (w.type === 'walk' && durationMin < MIN_WALK) continue;
    const stats = {
      ...(w.avgHr && w.avgHr > 0 ? { avgHr: Math.round(w.avgHr) } : {}), ...(w.maxHr && w.maxHr > 0 ? { maxHr: Math.round(w.maxHr) } : {}),
      ...(w.kcal && w.kcal > 0 ? { kcal: Math.round(w.kcal) } : {}),
      ...(w.hrMin && w.hrMin.some((x) => x !== null) ? { hrMin: w.hrMin } : {}),
    };
    const extra = { ...(w.kmh ? { kmh: w.kmh } : {}), ...(w.watts ? { watts: w.watts } : {}), ...(w.climbM ? { climbM: w.climbM } : {}) };
    const hasStats = Object.keys(stats).length > 0;
    // A strength session also logged here (started from 30 minutes before the watch's to its end): add to that one.
    if (w.type === 'strength') {
      const logged = all.find((x) => sameOwner(x) && !x.cardio && Date.parse(x.startedAt) >= w.t - 30 * 60_000 && Date.parse(x.startedAt) <= w.end);
      if (logged) { if (!logged.deletedAt && !logged.watch && hasStats) enrich.push({ id: logged.id, watch: { ...stats, minutes: durationMin } }); continue; }
    }
    const match = all.find((x) => sameOwner(x) && x.cardio && Math.abs(Date.parse(x.startedAt) - w.t) < 5 * 60_000);
    if (match) {
      if (!match.deletedAt && match.source === 'health' && match.cardio!.hrMin === undefined && (stats.hrMin || (match.cardio!.avgHr === undefined && hasStats))) enrich.push({ id: match.id, cardio: { ...stats, ...extra } });
      continue;
    }
    const activity: CardioActivity = CARDIO.includes(w.type as CardioActivity) ? (w.type as CardioActivity) : 'other';
    const title = w.title?.trim() || (activity === 'other' ? LABEL[w.type] ?? 'Workout' : undefined);
    cardio.push({ at: new Date(w.t).toISOString(), activity, durationMin, ...(w.km && w.km > 0.05 ? { distanceKm: Math.round(w.km * 100) / 100 } : {}), ...(title ? { title } : {}), ...stats, ...extra });
  }
  return { daily, body, vitals, comp, cardio, enrich };
}
