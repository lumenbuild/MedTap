// Turning what Health Connect / Apple Health returns into records: one daily row per day (updated by later imports),
// weigh-ins and body composition only where that day has none logged, blood pressure readings not already logged
// within 5 minutes, and cardio sessions (runs, walks, rides, swims, rows) not already there.
// Pure, so it can be tested; src/app/health.ts writes the result.
import type { BodyEntry, CardioActivity, DailyHealth, Vital, Workout } from '../db/schema';
import type { HealthData } from '../nfc/native';

export interface HealthPlan {
  daily: DailyHealth[]; body: { date: string; kg: number }[]; vitals: { at: string; systolic: number; diastolic: number }[];
  comp: { date: string; bodyFatPct?: number; leanKg?: number }[];
  cardio: { at: string; activity: CardioActivity; durationMin: number; distanceKm?: number }[];
}

const CARDIO: CardioActivity[] = ['run', 'walk', 'ride', 'swim', 'row'];
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
      exerciseMin: d.exerciseMin ?? old?.exerciseMin, hrvMs: d.hrvMs ?? old?.hrvMs, hrByHour: d.hrByHour ?? old?.hrByHour, updatedAt: nowIso,
    };
    daily.push(row);
  }
  // One weigh-in per day (the latest), only where nothing's been logged for that day.
  const byDay = new Map<string, { t: number; kg: number }>();
  for (const w of data.weights) { const k = ymdIn(w.t, tz); if (!byDay.has(k) || byDay.get(k)!.t < w.t) byDay.set(k, w); }
  const body = [...byDay].filter(([date]) => !existing.body.some((b) => mine(b) && b.date === date && typeof b.weightKg === 'number'))
    .map(([date, w]) => ({ date, kg: Math.round(w.kg * 10) / 10 }));
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
  // Cardio sessions. Skips any already there within 5 minutes, deleted ones included, so a deleted one stays deleted.
  const sameOwner = (r: { personId?: string }) => (r.personId ?? undefined) === personId;
  const cardio = (data.workouts ?? [])
    .filter((w) => CARDIO.includes(w.type as CardioActivity) && w.end > w.t)
    .map((w) => ({ at: new Date(w.t).toISOString(), activity: w.type as CardioActivity, durationMin: Math.round((w.end - w.t) / 60_000), ...(w.km && w.km > 0.05 ? { distanceKm: Math.round(w.km * 100) / 100 } : {}) }))
    .filter((w) => !(w.activity === 'walk' && w.durationMin < MIN_WALK))
    .filter((w) => !(existing.workouts ?? []).some((x) => sameOwner(x) && x.cardio && Math.abs(Date.parse(x.startedAt) - Date.parse(w.at)) < 5 * 60_000));
  return { daily, body, vitals, comp, cardio };
}
